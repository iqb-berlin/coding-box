import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class CodingAggregatedColumnsExportService {
  private readonly logger = new Logger(CodingAggregatedColumnsExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService
  ) {}

  async exportAggregatedNewColumnPerCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    outputFilePath?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-column-per-coder method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const COMMENTS_HEADER = 'Kommentare';

    const isExcluded = await this.query.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.query.getManualCodingVariableSet(
        workspaceId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds
      );
    }

    // 1. Get all coders to build mapping
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
    const allCoderNamesList = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.query.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerUsernames.forEach(managerUsername => {
        if (!allCoderNamesList.includes(managerUsername)) {
          allCoderNamesList.push(managerUsername);
        }
      });
      allCoderNamesList.sort();
    }
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNamesList.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 2. Get all variable-coder pairs for columns
    const variableCoderPairsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableCoderPairsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.query.applyJobFilters(variableCoderPairsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
    if (!coderTrainingIds?.length) {
      variableCoderPairsQuery.andWhere('cj.training_id IS NULL');
    }

    const variableCoderPairs = await variableCoderPairsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .addGroupBy('user.username')
      .getRawMany();

    const colSet = new Set<string>();
    variableCoderPairs.forEach(v => {
      if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
        if (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(v.unitName, v.variableId))) {
          const cName = anonymizeCoders ? coderMapping.get(v.userName)! : v.userName;
          colSet.add(`${v.unitName}_${v.variableId}_${cName}`);
        }
      }
    });

    if ((coderTrainingIds?.length || 0) > 0) {
      const managerVariablePairs = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
        .select('unit.name', 'unitName')
        .addSelect('bookletinfo.name', 'bookletName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('ctdr.training_id', 'trainingId')
        .addSelect('ctdr.response_id', 'responseId')
        .where('ctdr.workspace_id = :workspaceId', { workspaceId })
        .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds });
      applyResolvedExclusionsToQuery(managerVariablePairs, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo'
      });
      const managerVariablePairRows = await managerVariablePairs
        .getRawMany();

      const managerDiscussionMap = await this.query.getTrainingDiscussionResultsMap(
        workspaceId,
        coderTrainingIds,
        Array.from(new Set(
          managerVariablePairRows
            .map(pair => parseInt(pair.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ))
      );

      managerVariablePairRows.forEach(pair => {
        if (!pair.unitName || isExcluded(pair.bookletName || '', pair.unitName)) return;
        if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(pair.unitName, pair.variableId))) return;

        const caseKey = `${parseInt(pair.trainingId, 10)}|${parseInt(pair.responseId, 10)}`;
        const discussion = managerDiscussionMap.get(caseKey);
        if (!discussion?.managerUsername) return;

        const displayCoderName = anonymizeCoders ?
          (coderMapping.get(discussion.managerUsername) || discussion.managerUsername) :
          discussion.managerUsername;
        colSet.add(`${pair.unitName}_${pair.variableId}_${displayCoderName}`);
      });
    }

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
          colSet.add(`${v.unitName}_${v.variableId}_Autocoder`);
        }
      });
    }

    const sortedColumns = Array.from(colSet).sort();

    // 3. Get all persons
    const personResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
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
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
          'Keine Kodierergebnisse für diesen Workspace gefunden'
      );
    }

    // 4. Setup Streaming Workbook
    const { workbook, chunks } = createStreamingWorkbookTarget(outputFilePath);
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    const headers = [...baseHeaders, ...sortedColumns];
    if (includeModalValue) {
      headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
    }
    if (includeComments) headers.push(COMMENTS_HEADER);

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 25 }));
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // 5. Batch Process Test Persons
    const batchSize = 100;
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
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
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

      const personData = new Map<number, Map<string, {
        code: number | null,
        comment: string | null,
        codingIssueOption: number | null
      }>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const coderName = row.username || `Job ${row.jobId}`;
        const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
        const columnKey = `${row.unitName}_${row.variableId}_${displayName}`;

        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;

        const rawCode = getCurrentManualCoding(row, {
          code: row.cju_code
        }).code;
        const mapped = await this.formatting.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          null,
          this.formatting.toIntegerOrNull(row.missingsProfileId)
        );
        dataMapForPerson.set(columnKey, {
          code: mapped.code,
          comment: row.notes,
          codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
            parseInt(row.coding_issue_option, 10) :
            null
        });
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const columnKey = `${row.unitName}_${row.variableId}_Autocoder`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;
        const rawCode = getCurrentCoding(row).code;
        dataMapForPerson.set(columnKey, {
          code: mapCodeForExport(this.formatting.toIntegerOrNull(rawCode)),
          comment: null,
          codingIssueOption: null
        });
      });

      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const dataMapForPerson = personData.get(pid);
        const row: Record<string, unknown> = {
          'Test Person Login': p.login,
          'Test Person Code': p.code,
          'Test Person Group': p.group || ''
        };

        const codes: number[] = [];
        const comments: string[] = [];

        for (const col of sortedColumns) {
          const data = dataMapForPerson?.get(col);
          row[col] = outputCommentsInsteadOfCodes ?
            data?.comment || '' :
            this.formatting.formatCodeWithIssueSuffix(data?.code ?? null, data?.codingIssueOption ?? null);
          if (data?.code !== null && data?.code !== undefined) codes.push(data.code);
          if (data?.comment) {
            const coderName = col.split('_').pop();
            comments.push(`${coderName}: ${data.comment}`);
          }
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

        worksheet.addRow(row).commit();
      }

      if (global.gc) global.gc();
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return getStreamingWorkbookBuffer(chunks, outputFilePath);
  }
}
