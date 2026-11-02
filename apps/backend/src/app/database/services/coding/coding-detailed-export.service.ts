import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import type { FileHandle } from 'fs/promises';
import { Request } from 'express';
import { getErrorMessage, getErrorStack, toError } from '../../../utils/error.util';
import { EXCLUDED_STATUSES } from '../../utils/response-status-converter';
import { buildCoderNameMapping, mapCodeForExport } from '../../../utils/coding-utils';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import { DetailedCodingResultRawRow, TrainingDiscussionExportResult } from './coding-export.types';
import { yieldToEventLoop, isExportCancellationError } from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';

@Injectable()
export class CodingDetailedExportService {
  private readonly logger = new Logger(CodingDetailedExportService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService
  ) {}

  async exportCodingResultsDetailed(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false,
    outputFilePath?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.replay.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.query.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.query.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    if (checkCancellation) await checkCancellation();

    let outputFile: FileHandle | undefined;
    try {
      let manualCodingVariableSet: Set<string> | null = null;
      if (excludeAutoCoded) {
        manualCodingVariableSet = await this.query.getManualCodingVariableSet(
          workspaceId,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds
        );
      }

      const isExcluded = await this.query.getExclusionChecker(workspaceId);

      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders && !usePseudoCoders) {
        const codersQuery = this.codingJobRepository.createQueryBuilder('cj')
          .innerJoin('cj.codingJobCoders', 'cjc')
          .innerJoin('cjc.user', 'user')
          .select('user.username', 'username')
          .where('cj.workspace_id = :workspaceId', { workspaceId });

        this.query.applyJobFilters(
          codersQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds
        );

        const coders = await codersQuery
          .groupBy('user.username')
          .getRawMany();
        coderNameMapping = buildCoderNameMapping(coders.map(c => c.username), false);
      }

      const totalCountQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .leftJoin('cju.response', 'countResp')
        .where('cj.workspace_id = :workspaceId', { workspaceId });
      totalCountQuery.andWhere(
        '(countResp.status_v1 IS NULL OR countResp.status_v1 NOT IN (:...excludedStatuses))',
        { excludedStatuses: EXCLUDED_STATUSES }
      );

      this.query.applyJobFilters(
        totalCountQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        totalCountQuery.andWhere('cj.training_id IS NULL');
      }
      const totalCount = await totalCountQuery.getCount();

      const chunks: Buffer[] = [];
      const includeDiscussionResult = normalizedCoderTrainingIds.length > 0;

      const headerColumns = ['"Person Login"', '"Person Code"', '"Person Group"', '"Kodierer"', '"Unit"', '"Variable"'];
      if (includeResponseValues) headerColumns.push('"value"');
      headerColumns.push('"Kommentar"', '"Kodierzeitpunkt"', '"Code"', '"Code-Hinweis"');
      if (includeReplayUrl) headerColumns.push('"Replay URL"');
      const headerCsv = `${headerColumns.join(';')}\n`;
      if (outputFilePath) {
        // Create a private new file and keep its identity through every batch.
        // The worker later publishes it outside its private working directory.
        outputFile = await fs.promises.open(outputFilePath, 'wx', 0o600);
        await outputFile.writeFile(headerCsv, 'utf-8');
      } else {
        chunks.push(Buffer.from(headerCsv, 'utf-8'));
      }

      if (totalCount === 0 && hasScopedJobFilters) {
        throw new Error(this.query.getNoCodingResultsMessage(true));
      }

      const batchSize = 500;
      const pseudoCoderMappings = new Map<string, Map<string, string>>();
      const escapeCsvField = (field: string): string => `"${field?.toString().replace(/"/g, '""') || ''}"`;
      let exportedRowCount = 0;
      let batchCsv = '';
      const discussionResultMap = new Map<string, TrainingDiscussionExportResult>();
      let currentCaseKey: string | null = null;
      let currentCaseRepresentative: DetailedCodingResultRawRow | null = null;
      let emittedManagerForCurrentCase = false;
      const emittedManagerCaseKeys = new Set<string>();

      const flushManagerRowIfNeeded = async (): Promise<boolean> => {
        if (!includeDiscussionResult) return false;
        if (!currentCaseRepresentative) return false;
        if (emittedManagerForCurrentCase) return false;

        const trainingId = this.formatting.toIntegerOrNull(currentCaseRepresentative.trainingId);
        const responseId = this.formatting.toIntegerOrNull(currentCaseRepresentative.responseId);
        if (!trainingId || !responseId) return false;

        const caseKey = `${trainingId}|${responseId}`;
        if (emittedManagerCaseKeys.has(caseKey)) return false;

        const discussion = discussionResultMap.get(caseKey);
        if (!discussion) return false;
        if (!discussion.managerUsername) return false;

        const personLogin = currentCaseRepresentative.personLogin || '';
        const personCode = currentCaseRepresentative.personCode || '';
        const personGroup = currentCaseRepresentative.personGroup || '';
        const unitName = currentCaseRepresentative.unitName || currentCaseRepresentative.responseUnitName || '';
        const managerDisplayName = discussion.managerUsername;
        const discussionTimestamp = discussion.updatedAt ? new Date(discussion.updatedAt).toLocaleString('de-DE').replace(',', '') : '';
        const mappedDiscussionCode = mapCodeForExport(discussion.code);
        const discussionCodeValue = mappedDiscussionCode === null ? '' : mappedDiscussionCode.toString();
        const discussionNoteValue = discussion.notes || '';

        const discussionRowFields = [
          escapeCsvField(personLogin),
          escapeCsvField(personCode),
          escapeCsvField(personGroup),
          escapeCsvField(managerDisplayName),
          escapeCsvField(unitName),
          escapeCsvField(currentCaseRepresentative.variableId)
        ];
        if (includeResponseValues) {
          discussionRowFields.push(escapeCsvField(currentCaseRepresentative.responseValue || ''));
        }
        discussionRowFields.push(
          escapeCsvField(discussionNoteValue),
          escapeCsvField(discussionTimestamp),
          escapeCsvField(discussionCodeValue),
          escapeCsvField('')
        );

        if (includeReplayUrl && (req || serverUrl)) {
          const bookletName = currentCaseRepresentative.bookletName || '';
          const replayUnitName = currentCaseRepresentative.responseUnitName || unitName;
          const replayUrl = await this.replay.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, currentCaseRepresentative.variableId, workspaceId, authToken, serverUrl);
          discussionRowFields.push(escapeCsvField(replayUrl));
        }

        batchCsv += `${discussionRowFields.join(';')}\n`;
        emittedManagerForCurrentCase = true;
        emittedManagerCaseKeys.add(caseKey);
        return true;
      };

      for (let i = 0; i < totalCount; i += batchSize) {
        if (checkCancellation) await checkCancellation();

        const unitIdsBatchQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
          .innerJoin('cju.coding_job', 'cj')
          .select('cju.id', 'id')
          .leftJoin('cju.response', 'resp')
          .where('cj.workspace_id = :workspaceId', { workspaceId });

        if (includeDiscussionResult) {
          unitIdsBatchQuery
            .orderBy('cj.training_id', 'ASC')
            .addOrderBy('cju.response_id', 'ASC')
            .addOrderBy('cju.variable_id', 'ASC')
            .addOrderBy('cju.updated_at', 'ASC')
            .addOrderBy('cju.id', 'ASC');
        } else {
          unitIdsBatchQuery
            .orderBy('cju.created_at', 'ASC')
            .addOrderBy('cju.id', 'ASC');
        }
        unitIdsBatchQuery
          .offset(i)
          .limit(batchSize);

        this.query.applyJobFilters(
          unitIdsBatchQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          unitIdsBatchQuery.andWhere('cj.training_id IS NULL');
        }
        unitIdsBatchQuery.andWhere(
          '(resp.status_v1 IS NULL OR resp.status_v1 NOT IN (:...excludedStatuses))',
          { excludedStatuses: EXCLUDED_STATUSES }
        );

        const unitIdRows = await unitIdsBatchQuery.getRawMany<{ id: number | string }>();
        const batchIds = unitIdRows
          .map(row => this.formatting.toIntegerOrNull(row.id))
          .filter((id): id is number => id !== null);
        if (batchIds.length === 0) break;

        const unitsBatchQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
          .innerJoin('cju.coding_job', 'cj')
          .leftJoin('cj.codingJobCoders', 'cjc')
          .leftJoin('cjc.user', 'user')
          .leftJoin('cju.response', 'resp')
          .leftJoin('resp.unit', 'unit')
          .leftJoin('unit.booklet', 'booklet')
          .leftJoin('booklet.person', 'person')
          .leftJoin('booklet.bookletinfo', 'bookletinfo') // bookletinfo is used for replay URL
          .select('cju.id', 'id')
          .addSelect('cju.created_at', 'createdAt')
          .addSelect('cj.training_id', 'trainingId')
          .addSelect('cj.missings_profile_id', 'missingsProfileId')
          .addSelect('cju.response_id', 'responseId')
          .addSelect('cju.unit_name', 'unitName')
          .addSelect('unit.name', 'responseUnitName')
          .addSelect('cju.variable_id', 'variableId')
          .addSelect('cju.code', 'code')
          .addSelect('cju.notes', 'notes')
          .addSelect('cju.coding_issue_option', 'codingIssueOption')
          .addSelect('cju.updated_at', 'updatedAt')
          .addSelect('user.username', 'coderName')
          .addSelect('resp.status_v1', 'statusV1')
          .addSelect('bookletinfo.name', 'bookletName')
          .addSelect('person.login', 'personLogin')
          .addSelect('person.code', 'personCode')
          .addSelect('person.group', 'personGroup')
          .addSelect(includeResponseValues ? 'resp.value' : "''", 'responseValue')
          .where('cj.workspace_id = :workspaceId', { workspaceId })
          .andWhere('cju.id IN (:...batchIds)', { batchIds });

        if (includeDiscussionResult) {
          unitsBatchQuery
            .orderBy('cj.training_id', 'ASC')
            .addOrderBy('cju.response_id', 'ASC')
            .addOrderBy('cju.variable_id', 'ASC')
            .addOrderBy('cju.updated_at', 'ASC')
            .addOrderBy('cju.id', 'ASC')
            .addOrderBy('cjc.id', 'ASC');
        } else {
          unitsBatchQuery
            .orderBy('cju.created_at', 'ASC')
            .addOrderBy('cju.id', 'ASC')
            .addOrderBy('cjc.id', 'ASC');
        }

        this.query.applyJobFilters(
          unitsBatchQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          unitsBatchQuery.andWhere('cj.training_id IS NULL');
        }
        unitsBatchQuery.andWhere(
          '(resp.status_v1 IS NULL OR resp.status_v1 NOT IN (:...excludedStatuses))',
          { excludedStatuses: EXCLUDED_STATUSES }
        );
        const unitsBatch = await unitsBatchQuery.getRawMany<DetailedCodingResultRawRow>();
        await checkCancellation?.();

        if (includeDiscussionResult && unitsBatch.length > 0) {
          const trainingIdSet = new Set<number>();
          const responseIdSet = new Set<number>();
          for (const unit of unitsBatch) {
            const tId = this.formatting.toIntegerOrNull(unit.trainingId);
            const responseId = this.formatting.toIntegerOrNull(unit.responseId);
            if (tId) trainingIdSet.add(tId);
            if (responseId) responseIdSet.add(responseId);
          }

          if (trainingIdSet.size > 0 && responseIdSet.size > 0) {
            const batchDiscussionResultMap = await this.query.getTrainingDiscussionResultsMap(
              workspaceId,
              Array.from(trainingIdSet),
              Array.from(responseIdSet)
            );
            batchDiscussionResultMap.forEach((discussion, key) => {
              discussionResultMap.set(key, discussion);
            });
            await checkCancellation?.();
          }
        }

        batchCsv = '';

        // Ensure that all coder rows for the same case (training_id + response_id) are emitted first,
        // then a single coding manager row at the end of that case.
        const sortedUnitsBatch = [...unitsBatch].sort((a, b) => {
          const aTrainingId = this.formatting.toIntegerOrNull(a.trainingId) ?? 0;
          const bTrainingId = this.formatting.toIntegerOrNull(b.trainingId) ?? 0;
          if (aTrainingId !== bTrainingId) return aTrainingId - bTrainingId;
          const aResponseId = this.formatting.toIntegerOrNull(a.responseId) ?? 0;
          const bResponseId = this.formatting.toIntegerOrNull(b.responseId) ?? 0;
          if (aResponseId !== bResponseId) return aResponseId - bResponseId;
          if (a.variableId !== b.variableId) return a.variableId.localeCompare(b.variableId);
          const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return aUpdated - bUpdated;
        });

        for (let rowIndex = 0; rowIndex < sortedUnitsBatch.length; rowIndex += 1) {
          if (rowIndex > 0 && rowIndex % 100 === 0) {
            await checkCancellation?.();
            await yieldToEventLoop();
          }

          const unit = sortedUnitsBatch[rowIndex];
          const unitName = unit.unitName || unit.responseUnitName || '';
          const bookletName = unit.bookletName || '';
          if (unitName && isExcluded(bookletName, unitName)) continue;
          if (
            manualCodingVariableSet &&
            !manualCodingVariableSet.has(toManualCodingVariablePairKey(unitName, unit.variableId))
          ) continue;
          const statusV1 = this.formatting.toIntegerOrNull(unit.statusV1);
          if (statusV1 !== null && EXCLUDED_STATUSES.includes(statusV1)) continue;

          const trainingId = this.formatting.toIntegerOrNull(unit.trainingId) ?? 0;
          const responseId = this.formatting.toIntegerOrNull(unit.responseId) ?? 0;
          const caseKey = `${trainingId}|${responseId}`;

          if (currentCaseKey !== null && caseKey !== currentCaseKey) {
            if (await flushManagerRowIfNeeded()) exportedRowCount += 1;
            currentCaseRepresentative = null;
            emittedManagerForCurrentCase = false;
          }

          currentCaseKey = caseKey;
          if (!currentCaseRepresentative) currentCaseRepresentative = unit;

          const rawCode = this.formatting.toIntegerOrNull(unit.code);
          if (rawCode === null) continue;

          const personLogin = unit.personLogin || '';
          const personCode = unit.personCode || '';
          const personGroup = unit.personGroup || '';
          let coder = unit.coderName || '';

          if (anonymizeCoders && coder) {
            if (usePseudoCoders) {
              const varPersonKey = `${unit.variableId}_${personLogin}_${personCode}`;
              if (!pseudoCoderMappings.has(varPersonKey)) {
                pseudoCoderMappings.set(varPersonKey, new Map<string, string>());
              }
              const varPersonMap = pseudoCoderMappings.get(varPersonKey)!;
              if (!varPersonMap.has(coder)) {
                varPersonMap.set(coder, `K${varPersonMap.size + 1}`);
              }
              coder = varPersonMap.get(coder)!;
            } else {
              coder = coderNameMapping?.get(coder) || coder;
            }
          }

          const timestamp = unit.updatedAt ? new Date(unit.updatedAt).toLocaleString('de-DE').replace(',', '') : '';
          const mapped = await this.formatting.mapCodeAndScoreForExport(
            workspaceId,
            rawCode,
            null,
            this.formatting.toIntegerOrNull(unit.missingsProfileId)
          );
          const codeValue = mapped.code === null ? '' : mapped.code.toString();

          const commentValue = unit.notes || '';
          const codingIssueOption = this.formatting.toIntegerOrNull(unit.codingIssueOption);
          const codeIssueValue = this.formatting.getCodingIssueText(codingIssueOption);

          const rowFields = [
            escapeCsvField(personLogin),
            escapeCsvField(personCode),
            escapeCsvField(personGroup),
            escapeCsvField(coder),
            escapeCsvField(unitName),
            escapeCsvField(unit.variableId)
          ];
          if (includeResponseValues) {
            rowFields.push(escapeCsvField(unit.responseValue || ''));
          }
          rowFields.push(
            escapeCsvField(commentValue),
            escapeCsvField(timestamp),
            escapeCsvField(codeValue),
            escapeCsvField(codeIssueValue)
          );

          if (includeReplayUrl && (req || serverUrl)) {
            const replayUnitName = unit.responseUnitName || unitName;
            const replayUrl = await this.replay.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, unit.variableId, workspaceId, authToken, serverUrl);
            rowFields.push(escapeCsvField(replayUrl));
          }

          batchCsv += `${rowFields.join(';')}\n`;
          exportedRowCount += 1;
        }

        if (outputFile) {
          await outputFile.writeFile(batchCsv, 'utf-8');
        } else {
          chunks.push(Buffer.from(batchCsv, 'utf-8'));
        }
        await checkCancellation?.();
        await yieldToEventLoop();
      }

      batchCsv = '';
      if (await flushManagerRowIfNeeded()) exportedRowCount += 1;
      if (batchCsv) {
        if (outputFile) {
          await outputFile.writeFile(batchCsv, 'utf-8');
        } else {
          chunks.push(Buffer.from(batchCsv, 'utf-8'));
        }
      }

      if (exportedRowCount === 0 && hasScopedJobFilters) {
        throw new Error(this.query.getNoCodingResultsMessage(true));
      }

      this.logger.log(`Exported detailed results for workspace ${workspaceId}`);
      await checkCancellation?.();
      return outputFilePath ? Buffer.alloc(0) : Buffer.concat(chunks);
    } catch (error) {
      if (isExportCancellationError(toError(error))) {
        throw error;
      }
      this.logger.error(`Error exporting detailed coding results: ${getErrorMessage(error)}`, getErrorStack(error));
      throw new Error(`Could not export detailed coding results: ${getErrorMessage(error)}`);
    } finally {
      await outputFile?.close();
    }
  }

  async exportCodingResultsDetailedToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string,
    includeResponseValues = false
  ): Promise<void> {
    await this.exportCodingResultsDetailed(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl,
      includeResponseValues,
      filePath
    );
  }
}
