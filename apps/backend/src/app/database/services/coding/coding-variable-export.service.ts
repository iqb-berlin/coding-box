import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import {
  calculateModalValue, formatModalCandidates, getCurrentManualCoding, getModalTieLabel, buildCoderNameMapping, mapCodeForExport
} from '../../../utils/coding-utils';
import { generateUniqueWorksheetName } from '../../../utils/excel-utils';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { ByVariableExportEstimate, TrainingDiscussionExportResult } from './coding-export.types';
import { createStreamingWorkbookTarget, getStreamingWorkbookBuffer, getByVariableWorksheetLimit } from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';

@Injectable()
export class CodingVariableExportService {
  private readonly logger = new Logger(CodingVariableExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService
  ) {}

  async estimateCodingResultsByVariableExport(
    workspaceId: number,
    exportType: 'by-variable' | 'by-variable-compact' = 'by-variable',
    excludeAutoCoded = false,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<ByVariableExportEstimate> {
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.query.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const combinations = await this.query.getByVariableCombinations(
      workspaceId,
      excludeAutoCoded,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    const worksheetLimit = getByVariableWorksheetLimit();

    return {
      exportType,
      unitVariableCount: combinations.length,
      worksheetLimit: exportType === 'by-variable' ? worksheetLimit : null,
      exceedsWorksheetLimit: exportType === 'by-variable' && combinations.length > worksheetLimit
    };
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
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
    outputFilePath?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (manual coding only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

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
    const MAX_WORKSHEETS = getByVariableWorksheetLimit();

    const BATCH_SIZE = 100;

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(
      normalizedJobDefinitionIds.length ||
      normalizedCoderTrainingIds.length ||
      normalizedCoderIds.length
    );

    if (checkCancellation) await checkCancellation();

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const filteredCombinations = await this.query.getByVariableCombinations(
      workspaceId,
      excludeAutoCoded,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    if (filteredCombinations.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Antworten für den gewählten Job-/Training-/Kodierer-Filter in diesem Export gefunden' :
          'Keine Antworten für den angeforderten Export gefunden'
      );
    }

    if (filteredCombinations.length > MAX_WORKSHEETS) {
      throw new Error(
        `Der Export enthaelt ${filteredCombinations.length} Unit-Variable-Kombinationen ` +
        `und ueberschreitet das konfigurierte Limit von ${MAX_WORKSHEETS} Tabellenblaettern. ` +
        'Bitte die Auswahl einschraenken oder den kompakten Nach-Variable-Export verwenden.'
      );
    }

    const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);

    for (const { unitName, variableId } of filteredCombinations) {
      if (checkCancellation) await checkCancellation();
      const worksheetName = generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
      const worksheet = workbook.addWorksheet(worksheetName);

      // Get all coders for this variable
      const personIdsQuery = this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('person.id', 'pId')
        .where('unit.name = :unitName', { unitName })
        .andWhere('resp.variableid = :variableId', { variableId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .groupBy('person.id');
      applyResolvedExclusionsToQuery(personIdsQuery, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo',
        parameterPrefix: 'variableExportPersons'
      });
      const personIdsRaw = await personIdsQuery.getRawMany();

      const pIds = personIdsRaw.map(r => r.pId);
      if (pIds.length === 0) {
        await worksheet.commit();
        continue;
      }

      // Find coders involved
      const coderQueryBuilder = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cj.codingJobCoders', 'cjc')
        .innerJoin('cjc.user', 'user')
        .select('user.username', 'username')
        .where('cju.unit_name = :unitName', { unitName })
        .andWhere('cju.variable_id = :variableId', { variableId })
        .andWhere('cj.workspace_id = :workspaceId', { workspaceId });

      this.query.applyJobFilters(
        coderQueryBuilder,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        coderQueryBuilder.andWhere('cj.training_id IS NULL');
      }

      const coderQuery = await coderQueryBuilder
        .groupBy('user.username')
        .getRawMany();

      const coderNames = coderQuery.map(c => c.username).sort();
      let discussionResultMap = new Map<string, TrainingDiscussionExportResult>();
      if (normalizedCoderTrainingIds.length > 0) {
        const managerCasesQuery = this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('booklet.person', 'person')
          .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
          .select('ctdr.training_id', 'trainingId')
          .addSelect('ctdr.response_id', 'responseId')
          .where('person.id IN (:...pIds)', { pIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .andWhere('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
          .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds: normalizedCoderTrainingIds });
        applyResolvedExclusionsToQuery(managerCasesQuery, exclusions, {
          unitAlias: 'unit',
          bookletInfoAlias: 'bookletinfo',
          parameterPrefix: 'variableExportManagerCases'
        });
        const managerCases = await managerCasesQuery.getRawMany();

        discussionResultMap = await this.query.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          Array.from(new Set(
            managerCases
              .map(item => parseInt(item.responseId, 10))
              .filter(responseId => !Number.isNaN(responseId))
          ))
        );

        managerCases.forEach(item => {
          const caseKey = `${parseInt(item.trainingId, 10)}|${parseInt(item.responseId, 10)}`;
          const discussion = discussionResultMap.get(caseKey);
          if (discussion?.managerUsername && !coderNames.includes(discussion.managerUsername)) {
            coderNames.push(discussion.managerUsername);
          }
        });
        coderNames.sort();
      }
      const coderMapping = anonymizeCoders ? buildCoderNameMapping(coderNames, usePseudoCoders) : null;
      const displayCoders = coderNames.map(c => coderMapping?.get(c) || c);

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      baseHeaders.push(...displayCoders);
      if (includeModalValue) {
        baseHeaders.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
      }
      if (includeDoubleCoded) baseHeaders.push(DOUBLE_CODED_HEADER);
      if (includeComments) baseHeaders.push(...displayCoders.map(c => `${COMMENTS_HEADER} (${c})`));

      worksheet.columns = baseHeaders.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      for (let i = 0; i < pIds.length; i += BATCH_SIZE) {
        const batchIds = pIds.slice(i, i + BATCH_SIZE);
        const dataQueryBuilder = this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .leftJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
          .innerJoin('cju.coding_job', 'cj')
          .leftJoin('cj.codingJobCoders', 'cjc')
          .leftJoin('cjc.user', 'user')
          .select('person.login', 'login')
          .addSelect('person.code', 'code')
          .addSelect('person.group', 'group')
          .addSelect('bookletinfo.name', 'bookletName')
          .addSelect('cju.code', 'cju_code')
          .addSelect('cju.coding_issue_option', 'coding_issue_option')
          .addSelect('resp.code_v1', 'code_v1')
          .addSelect('resp.code_v2', 'code_v2')
          .addSelect('resp.code_v3', 'code_v3')
          .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
          .addSelect('resp.status_v1', 'status_v1')
          .addSelect('user.username', 'username')
          .addSelect('cju.notes', 'notes')
          .addSelect('person.id', 'pId')
          .addSelect('cj.training_id', 'trainingId')
          .addSelect('cj.missings_profile_id', 'missingsProfileId')
          .addSelect('cju.response_id', 'responseId')
          .where('person.id IN (:...batchIds)', { batchIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .andWhere('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('cj.workspace_id = :workspaceId', { workspaceId });
        applyResolvedExclusionsToQuery(dataQueryBuilder, exclusions, {
          unitAlias: 'unit',
          bookletInfoAlias: 'bookletinfo'
        });

        this.query.applyJobFilters(
          dataQueryBuilder,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          dataQueryBuilder.andWhere('cj.training_id IS NULL');
        }

        const dataQuery = await dataQueryBuilder.getRawMany();

        const personGroup = new Map<number, {
          login: string,
          code: string,
          group: string,
          bookletName: string,
          codings: Record<string, { code: number | null, notes: string | null, status: number | null, codingIssueOption: number | null }>,
          metadata: Record<string, unknown>
        }>();
        for (const d of dataQuery) {
          const pid = parseInt(d.pId, 10);
          if (!personGroup.has(pid)) {
            personGroup.set(pid, {
              login: d.login, code: d.code, group: d.group, bookletName: d.bookletName, codings: {}, metadata: d
            });
          }
          const p = personGroup.get(pid)!;
          if (d.username) {
            const rawCode = getCurrentManualCoding(d, {
              code: d.cju_code
            }).code;
            const mapped = await this.formatting.mapCodeAndScoreForExport(
              workspaceId,
              rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
              null,
              this.formatting.toIntegerOrNull(d.missingsProfileId)
            );
            p.codings[d.username] = {
              code: mapped.code,
              notes: d.notes,
              status: d.status_v1,
              codingIssueOption: d.coding_issue_option !== null && d.coding_issue_option !== undefined ?
                parseInt(d.coding_issue_option, 10) :
                null
            };
          }

          if (normalizedCoderTrainingIds.length > 0) {
            const trainingId = parseInt(d.trainingId, 10);
            const responseId = parseInt(d.responseId, 10);
            if (!Number.isNaN(trainingId) && !Number.isNaN(responseId)) {
              const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
              if (discussion?.managerUsername && !p.codings[discussion.managerUsername]) {
                p.codings[discussion.managerUsername] = {
                  code: mapCodeForExport(discussion.code),
                  notes: discussion.notes,
                  status: d.status_v1,
                  codingIssueOption: null
                };
              }
            }
          }
        }

        for (const [, p] of personGroup) {
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };

          if (includeReplayUrl && (req || serverUrl)) {
            row['Replay URL'] = await this.replay.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          const codes: number[] = [];
          for (const cName of coderNames) {
            const cData = p.codings[cName];
            const dName = coderMapping?.get(cName) || cName;
            row[dName] = outputCommentsInsteadOfCodes ?
              cData?.notes || '' :
              this.formatting.formatCodeWithIssueSuffix(cData?.code ?? null, cData?.codingIssueOption ?? null);
            if (cData?.code !== null && cData?.code !== undefined) {
              codes.push(cData.code);
            }
          }

          if (includeModalValue && codes.length > 0) {
            const modal = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = modal.modalValue ?? '';
            row[DEVIATION_COUNT_HEADER] = modal.deviationCount;
            row[MODAL_TIE_HEADER] = getModalTieLabel(modal);
            row[MODAL_CANDIDATES_HEADER] = formatModalCandidates(modal);
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
            row[MODAL_TIE_HEADER] = '';
            row[MODAL_CANDIDATES_HEADER] = '';
          }

          if (includeDoubleCoded) {
            row[DOUBLE_CODED_HEADER] = codes.length > 1 ? 'Ja' : 'Nein';
          }

          if (includeComments) {
            for (const cName of coderNames) {
              const cData = p.codings[cName];
              const dName = coderMapping?.get(cName) || cName;
              row[`${COMMENTS_HEADER} (${dName})`] = cData?.notes || '';
            }
          }

          worksheet.addRow(row).commit();
        }
      }
      await worksheet.commit();
    }

    await workbook.commit();
    return getStreamingWorkbookBuffer(chunks, outputFilePath);
  }

  async exportCodingResultsByVariableToFile(
    filePath: string,
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
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
    serverUrl?: string
  ): Promise<void> {
    await this.exportCodingResultsByVariable(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
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
      filePath
    );
  }
}
