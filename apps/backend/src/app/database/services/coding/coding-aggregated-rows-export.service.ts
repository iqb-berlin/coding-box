import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import {
  calculateModalValue, formatModalCandidates, getCurrentCoding, getCurrentManualCoding, getModalTieLabel, mapCodeForExport
} from '../../../utils/coding-utils';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import {
  createStreamingWorkbookTarget, getStreamingWorkbookBuffer, getCurrentCodingTuplePresenceCondition, getCurrentAutocodingCandidateCondition
} from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';

@Injectable()
export class CodingAggregatedRowsExportService {
  private readonly logger = new Logger(CodingAggregatedRowsExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService
  ) {}

  async exportAggregatedNewRowPerVariable(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    includeReplayUrl: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    authToken: string,
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
    this.logger.log(`Exporting aggregated results with new-row-per-variable method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    const isExcluded = await this.query.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.query.getManualCodingVariableSet(
        workspaceId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      );
    }

    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableRecordsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.query.applyJobFilters(variableRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
    if (!coderTrainingIds?.length) {
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

    const sortedVariables = Array.from(variableSet).sort();

    const coderRecordsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.query.applyJobFilters(coderRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
    if (!coderTrainingIds?.length) {
      coderRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const coderRecords = await coderRecordsQuery
      .groupBy('user.username')
      .getRawMany();

    const allCoderNames = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.query.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerUsernames.forEach(managerUsername => {
        if (!allCoderNames.includes(managerUsername)) {
          allCoderNames.push(managerUsername);
        }
      });
      allCoderNames.sort();
    }
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNames.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 3. Get all persons
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

    if (jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.query.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
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
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter nach Anwendung der Exportregeln gefunden' :
          'Keine Kodierergebnisse für diesen Workspace nach Anwendung der Exportregeln gefunden'
      );
    }

    // 4. Setup Streaming Workbook
    const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group', 'Unit', 'Variable'];
    if (includeResponseValues) baseHeaders.push('value');
    if (includeReplayUrl) baseHeaders.push('Replay URL');

    const coderHeaderNames: string[] = [];
    allCoderNames.forEach(name => {
      const displayName = anonymizeCoders ? coderMapping.get(name)! : name;
      coderHeaderNames.push(`${displayName} Code`, `${displayName} Score`);
      if (includeComments) coderHeaderNames.push(`${displayName} Note`);
    });

    const headers = [...baseHeaders, ...coderHeaderNames];
    if (includeModalValue) {
      headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
    }
    if (includeComments) headers.push(COMMENTS_HEADER);

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // 5. Batch Process Test Persons
    const batchSize = 50;
    for (let i = 0; i < personResults.length; i += batchSize) {
      if (checkCancellation) await checkCancellation();
      const batch = personResults.slice(i, i + batchSize);
      const batchPersonIds = batch.map(p => p.id);

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
        .addSelect('cju.score', 'cju_score')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
        .addSelect('resp.score_v3', 'score_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.score_v2', 'score_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .addSelect(includeResponseValues ? 'resp.value' : "''", 'responseValue')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.query.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
        manualCodingQuery.andWhere('cj.training_id IS NULL');
      }

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.query.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
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
        .addSelect(includeResponseValues ? 'resp.value' : "''", 'responseValue')
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
      const personData = new Map<number, Map<string, Map<string, {
        code: number | null,
        score: number | null,
        comment: string | null,
        codingIssueOption: number | null
      }>>>();
      const responseValues = new Map<number, Map<string, string>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (includeResponseValues) {
          if (!responseValues.has(pid)) responseValues.set(pid, new Map());
          const personResponseValues = responseValues.get(pid)!;
          if (!personResponseValues.has(compositeKey)) {
            personResponseValues.set(compositeKey, row.responseValue ?? '');
          }
        }
        const coderName = row.username || `Job ${row.jobId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;

        const currentCoding = getCurrentManualCoding(row, {
          code: row.cju_code,
          score: row.cju_score
        });
        const rawCode = currentCoding.code;
        const rawScore = currentCoding.score;
        const mapped = await this.formatting.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          rawScore !== null && rawScore !== undefined ? parseInt(rawScore, 10) : null,
          this.formatting.toIntegerOrNull(row.missingsProfileId)
        );
        coderMap.set(coderName, {
          code: mapped.code,
          score: mapped.score,
          comment: row.notes,
          codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
            parseInt(row.coding_issue_option, 10) :
            null
        });
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (includeResponseValues) {
          if (!responseValues.has(pid)) responseValues.set(pid, new Map());
          const personResponseValues = responseValues.get(pid)!;
          if (!personResponseValues.has(compositeKey)) {
            personResponseValues.set(compositeKey, row.responseValue ?? '');
          }
        }
        const coderName = 'AUTO';
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;
        const currentCoding = getCurrentCoding(row);
        const rawCode = currentCoding.code;
        const rawScore = currentCoding.score;
        coderMap.set(coderName, {
          code: mapCodeForExport(this.formatting.toIntegerOrNull(rawCode)),
          score: this.formatting.toIntegerOrNull(rawScore),
          comment: null,
          codingIssueOption: null
        });
      });

      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const varMap = personData.get(pid);

        for (const vKey of sortedVariables) {
          const coderDataMap = varMap?.get(vKey);
          if (!coderDataMap && excludeAutoCoded) continue;

          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || '',
            Unit: variableUnitNames.get(vKey) || '',
            Variable: vKey.split('_').slice(1).join('_')
          };
          if (includeResponseValues) {
            row.value = responseValues.get(pid)?.get(vKey) ?? '';
          }

          const codes: number[] = [];
          const comments: string[] = [];

          allCoderNames.forEach(coderName => {
            const data = coderDataMap?.get(coderName);
            const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
            row[`${displayName} Code`] = outputCommentsInsteadOfCodes ?
              (data?.comment ?? '') :
              this.formatting.formatCodeWithIssueSuffix(data?.code ?? null, data?.codingIssueOption ?? null);
            row[`${displayName} Score`] = outputCommentsInsteadOfCodes ?
              '' :
              this.formatting.formatScoreForExport(data?.code ?? null, data?.score ?? null);
            if (includeComments) row[`${displayName} Note`] = data?.comment ?? '';
            if (data?.code !== null && data?.code !== undefined) codes.push(data.code);
            if (data?.comment) comments.push(`${displayName}: ${data.comment}`);
          });

          // Add AUTO if present
          if (coderDataMap?.has('AUTO')) {
            const data = coderDataMap.get('AUTO')!;
            if (data.code !== null && data.code !== undefined) codes.push(data.code);
          }

          if (includeModalValue && codes.length > 0) {
            const modalResult = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = mapCodeForExport(modalResult.modalValue) ?? '';
            row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
            row[MODAL_TIE_HEADER] = getModalTieLabel(modalResult);
            row[MODAL_CANDIDATES_HEADER] = formatModalCandidates(modalResult, code => mapCodeForExport(code));
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
            row[MODAL_TIE_HEADER] = '';
            row[MODAL_CANDIDATES_HEADER] = '';
          }

          if (includeComments) {
            row[COMMENTS_HEADER] = comments.join(' | ');
          }

          if (includeReplayUrl && (req || serverUrl)) {
            const unitName = variableUnitNames.get(vKey) || '';
            const variableId = vKey.split('_').slice(1).join('_');
            row['Replay URL'] = await this.replay.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          worksheet.addRow(row).commit();
        }
      }

      if (global.gc) global.gc();
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return getStreamingWorkbookBuffer(chunks, outputFilePath);
  }
}
