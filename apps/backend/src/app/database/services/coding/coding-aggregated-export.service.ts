import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import {
  calculateModalValue, getCurrentCoding, getCurrentManualCoding, getModalTieLabel, mapCodeForExport
} from '../../../utils/coding-utils';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import { AggregatedMostFrequentVariableData } from './coding-export.types';
import {
  createStreamingWorkbookTarget, getStreamingWorkbookBuffer, getCurrentCodingTuplePresenceCondition, getCurrentAutocodingCandidateCondition
} from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';
import { CodingAggregatedRowsExportService } from './coding-aggregated-rows-export.service';
import { CodingAggregatedColumnsExportService } from './coding-aggregated-columns-export.service';

@Injectable()
export class CodingAggregatedExportService {
  private readonly logger = new Logger(CodingAggregatedExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService,
    private readonly rows: CodingAggregatedRowsExportService,
    private readonly columns: CodingAggregatedColumnsExportService
  ) {}

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
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
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId} with method: ${doubleCodingMethod}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ' (including auto-coded)'}`);

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

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.rows.exportAggregatedNewRowPerVariable(
        workspaceId,
        outputCommentsInsteadOfCodes,
        includeReplayUrl,
        anonymizeCoders,
        usePseudoCoders,
        includeComments,
        includeModalValue,
        authToken,
        req,
        excludeAutoCoded,
        checkCancellation,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        serverUrl,
        includeResponseValues,
        outputFilePath
      );
    } if (doubleCodingMethod === 'new-column-per-coder') {
      return this.columns.exportAggregatedNewColumnPerCoder(
        workspaceId,
        outputCommentsInsteadOfCodes,
        anonymizeCoders,
        usePseudoCoders,
        includeComments,
        includeModalValue,
        excludeAutoCoded,
        checkCancellation,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        outputFilePath
      );
    }

    this.logger.log(`Exporting aggregated results with most-frequent method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const isExcluded = await this.query.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const hasScopedJobFilters = !!(
      normalizedJobDefinitionIds.length ||
      normalizedCoderTrainingIds.length ||
      normalizedCoderIds.length
    );

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.query.getManualCodingVariableSet(
        workspaceId,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds
      );
    }

    // 1. Get all variables to define columns
    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableRecordsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.query.applyJobFilters(
      variableRecordsQuery,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds,
      'cju'
    );
    if (normalizedCoderTrainingIds.length === 0) {
      variableRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const variableRecords = await variableRecordsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const variableSet = new Set<string>();
    const variableUnitNames = new Map<string, string>();
    variableRecords.forEach(v => {
      if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
        const compositeKey = `${v.unitName}_${v.variableId}`;
        if (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(v.unitName, v.variableId))) {
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      }
    });

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(getCurrentCodingTuplePresenceCondition('response'));
      applyResolvedExclusionsToQuery(autoVariables, exclusions);
      const autoVariableRows = await autoVariables
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariableRows.forEach(v => {
        if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
          const compositeKey = `${v.unitName}_${v.variableId}`;
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      });
    }

    const variables = Array.from(variableSet).sort();

    // 2. Get all distinct test persons metadata
    const personResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .addSelect('MAX(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (normalizedJobDefinitionIds.length || normalizedCoderTrainingIds.length || normalizedCoderIds.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.query.applyJobFilters(
        personResultsQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        personResultsQuery.andWhere('cj.training_id IS NULL');
      }
    }

    const personResults = await personResultsQuery
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
          'Keine Kodierergebnisse für diesen Workspace gefunden'
      );
    }

    // 3. Setup Streaming Workbook
    const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    if (includeReplayUrl) baseHeaders.push('Replay URL');
    const includeMostFrequentModalMetadata = includeModalValue && !outputCommentsInsteadOfCodes;
    const variableHeaders = variables.flatMap(variable => {
      if (!includeMostFrequentModalMetadata) {
        return [variable];
      }

      return [
        variable,
        this.formatting.getMostFrequentModalTieHeader(variable),
        this.formatting.getMostFrequentModalCandidatesHeader(variable)
      ];
    });
    const headers = [...baseHeaders, ...variableHeaders];

    worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 4. Batch Process Test Persons
    const batchSize = 100;
    for (let i = 0; i < personResults.length; i += batchSize) {
      if (checkCancellation) await checkCancellation();
      const batch = personResults.slice(i, i + batchSize);
      const batchPersonIds = batch.map(p => p.id);

      // Fetch coding results for this batch
      const manualCodingQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('person.id', 'personId')
        .addSelect('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.query.applyJobFilters(
        manualCodingQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        manualCodingQuery.andWhere('cj.training_id IS NULL');
      }

      const manualCoding = await manualCodingQuery.getRawMany();
      if (normalizedCoderTrainingIds.length > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.query.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          responseIds
        );
        const managerRows: Record<string, unknown>[] = [];
        const handledCases = new Set<string>();

        for (const row of manualCoding) {
          const trainingId = parseInt(row.trainingId, 10);
          const responseId = parseInt(row.responseId, 10);
          if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

          const caseKey = `${trainingId}|${responseId}`;
          if (handledCases.has(caseKey)) continue;
          handledCases.add(caseKey);

          const discussionResult = discussionResultMap.get(caseKey);
          if (!discussionResult?.managerUsername) continue;

          managerRows.push({
            ...row,
            username: discussionResult.managerUsername,
            cju_code: discussionResult.code,
            cju_score: discussionResult.score,
            code_v1: null,
            code_v2: null,
            code_v3: null,
            score_v1: null,
            score_v2: null,
            score_v3: null,
            autocoder_invalidated_version: null,
            notes: discussionResult.notes
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.score_v3', 'score_v3')
        .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.score_v2', 'score_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere(getCurrentAutocodingCandidateCondition('resp'))
        .andWhere(getCurrentCodingTuplePresenceCondition('resp'))
        .getRawMany();

      // Group data by person and variable
      const personData = new Map<number, Map<string, AggregatedMostFrequentVariableData>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codings: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const rawCode = getCurrentManualCoding(row, {
          code: row.cju_code
        }).code;
        const mapped = await this.formatting.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          null,
          this.formatting.toIntegerOrNull(row.missingsProfileId)
        );
        const code = mapped.code;
        if (code !== null) {
          d.codings.push({
            code,
            codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
              parseInt(row.coding_issue_option, 10) :
              null
          });
        }
        if (row.notes) {
          const coderName = row.username || `Job ${row.jobId}`;
          d.comments.push(`${coderName}: ${row.notes}`);
        }
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codings: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const rawCode = getCurrentCoding(row).code;
        const code = mapCodeForExport(this.formatting.toIntegerOrNull(rawCode));
        if (code !== null) {
          d.codings.push({ code, codingIssueOption: null });
        }
      });

      // Write rows
      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const row: Record<string, string | number | null> = {
          'Test Person Login': p.login,
          'Test Person Code': p.code,
          'Test Person Group': p.group || ''
        };

        const modalValues = new Map<string, number | null>();
        const varData = personData.get(pid);

        for (const vKey of variables) {
          const data = varData?.get(vKey);
          if (data && data.codings.length > 0) {
            const codes = data.codings.map(coding => coding.code);
            const modalResult = calculateModalValue(codes);
            const codingIssueOptions = this.formatting.getCodingIssueOptionsForModalCode(
              data.codings,
              modalResult.modalValue
            );
            modalValues.set(vKey, modalResult.modalValue);
            row[vKey] = outputCommentsInsteadOfCodes ?
              data.comments.join(' | ') :
              this.formatting.formatCodeWithIssueSuffixes(modalResult.modalValue, codingIssueOptions);
            if (includeMostFrequentModalMetadata) {
              row[this.formatting.getMostFrequentModalTieHeader(vKey)] = getModalTieLabel(modalResult);
              row[this.formatting.getMostFrequentModalCandidatesHeader(vKey)] =
                this.formatting.formatModalCandidatesWithIssueSuffixes(modalResult, data.codings);
            }
          } else {
            row[vKey] = '';
            if (includeMostFrequentModalMetadata) {
              row[this.formatting.getMostFrequentModalTieHeader(vKey)] = '';
              row[this.formatting.getMostFrequentModalCandidatesHeader(vKey)] = '';
            }
          }
        }

        if (includeReplayUrl && (req || serverUrl)) {
          let replayUrl = '';
          for (const vKey of variables) {
            if (modalValues.has(vKey)) {
              const variableId = vKey.split('_').slice(1).join('_');
              const unitName = variableUnitNames.get(vKey) || '';
              replayUrl = await this.replay.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
              break;
            }
          }
          row['Replay URL'] = replayUrl;
        }

        worksheet.addRow(row).commit();
      }

      // Garbage collection hint
      if (global.gc) global.gc();

      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return getStreamingWorkbookBuffer(chunks, outputFilePath);
  }

  async exportCodingResultsAggregatedToFile(
    filePath: string,
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
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
    await this.exportCodingResultsAggregated(
      workspaceId,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      doubleCodingMethod,
      includeComments,
      includeModalValue,
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
