import { Injectable, Logger } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, Repository, SelectQueryBuilder, Brackets, FindOperator
} from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request, Response } from 'express';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { generateReplayUrl, generateReplayUrlFromRequest } from '../../../utils/replay-url.util';
import {
  calculateModalValue, getLatestCode, buildCoderNameMapping, mapCodeForExport
} from '../../../utils/coding-utils';
import { generateUniqueWorksheetName } from '../../../utils/excel-utils';
import { CodingListService, CodingItem } from './coding-list.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';

@Injectable()
export class CodingExportService {
  private readonly logger = new Logger(CodingExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private codingListService: CodingListService,
    private workspaceCoreService: WorkspaceCoreService
  ) { }

  private variablePageMapsCache = new Map<string, Map<string, string>>();
  private currentWorkspaceId: number | null = null;

  private clearPageMapsCache(): void {
    this.variablePageMapsCache.clear();
    this.currentWorkspaceId = null;
  }

  private async getVariablePage(unitName: string, variableId: string, workspaceId: number): Promise<string> {
    if (this.currentWorkspaceId !== workspaceId) {
      this.clearPageMapsCache();
      this.currentWorkspaceId = workspaceId;
    }

    if (!this.variablePageMapsCache.has(unitName)) {
      const pageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
      this.variablePageMapsCache.set(unitName, pageMap);
    }

    return this.variablePageMapsCache.get(unitName)?.get(variableId) || '0';
  }

  async exportCodingListAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const csvStream = await this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
    csvStream.pipe(res);
  }

  async exportCodingListAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );

    res.send(excelData);
  }

  async exportCodingListAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('[');
    const stream = await this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    let first = true;
    stream.on('data', (item: CodingItem) => {
      if (!first) {
        res.write(',');
      } else {
        first = false;
      }
      res.write(JSON.stringify(item));

      if (global.gc) {
        global.gc();
      }
    });

    stream.on('end', () => {
      res.write(']');
      res.end();
    });

    stream.on('error', (error: Error) => {
      this.logger.error(`Error during JSON export: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else {
        res.end();
      }
    });
  }

  async exportCodingListForJobAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>
  ): Promise<Readable> {
    return this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback
    );
  }

  async exportCodingListForJobAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>
  ): Promise<Buffer> {
    return this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback
    );
  }

  async exportCodingListForJobAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>
  ): Promise<Readable> {
    const stream = this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback
    );

    const passThrough = new PassThrough();
    passThrough.write('[');
    let first = true;

    stream.on('data', (item: CodingItem) => {
      if (!first) {
        passThrough.write(',');
      } else {
        first = false;
      }
      passThrough.write(JSON.stringify(item));
    });

    stream.on('end', () => {
      passThrough.write(']');
      passThrough.end();
    });

    stream.on('error', err => {
      passThrough.emit('error', err);
    });

    return passThrough;
  }

  async exportCodingResultsByVersionAsCsv(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>
  ): Promise<Readable> {
    return this.codingListService.getCodingResultsByVersionCsvStream(
      workspaceId,
      version,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback
    );
  }

  async exportCodingResultsByVersionAsExcel(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>
  ): Promise<Buffer> {
    return this.codingListService.getCodingResultsByVersionAsExcel(
      workspaceId,
      version,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback
    );
  }

  private async generateReplayUrlWithPageLookup(
    req: Request | undefined,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    workspaceId: number,
    authToken: string,
    serverUrl?: string
  ): Promise<string> {
    const variablePage = await this.getVariablePage(unitName, variableId, workspaceId);
    if (req) {
      return generateReplayUrlFromRequest(req, {
        loginName,
        loginCode,
        loginGroup: group,
        bookletId,
        unitId: unitName,
        variablePage,
        variableAnchor: variableId,
        authToken
      });
    }

    if (!serverUrl) {
      return '';
    }

    return generateReplayUrl({
      serverUrl,
      loginName,
      loginCode,
      loginGroup: group,
      bookletId,
      unitId: unitName,
      variablePage,
      variableAnchor: variableId,
      authToken
    });
  }

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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId} with method: ${doubleCodingMethod}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ' (including auto-coded)'}`);

    this.clearPageMapsCache();

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.exportAggregatedNewRowPerVariable(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds, serverUrl);
    } if (doubleCodingMethod === 'new-column-per-coder') {
      return this.exportAggregatedNewColumnPerCoder(workspaceId, outputCommentsInsteadOfCodes, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, excludeAutoCoded, checkCancellation, jobDefinitionIds, coderTrainingIds, coderIds);
    }

    this.logger.log(`Exporting aggregated results with most-frequent method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    // 1. Get all variables to define columns
    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(variableRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const variableRecords = await variableRecordsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const variableSet = new Set<string>();
    const variableUnitNames = new Map<string, string>();
    variableRecords.forEach(v => {
      if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
        const compositeKey = `${v.unitName}_${v.variableId}`;
        if (!manualCodingVariableSet || manualCodingVariableSet.has(`${v.unitName}|${v.variableId}`)) {
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      }
    });

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v1 IS NOT NULL')
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariables.forEach(v => {
        if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
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

    if (jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
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
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    if (includeReplayUrl) baseHeaders.push('Replay URL');
    const headers = [...baseHeaders, ...variables];

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
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds);

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
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
            notes: null
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      // Group data by person and variable
      const personData = new Map<number, Map<string, { codes: number[], comments: string[] }>>();

      manualCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codes: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const code = mapCodeForExport(rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null);
        if (code !== null) d.codes.push(code);
        if (row.notes) {
          const coderName = row.username || `Job ${row.jobId}`;
          d.comments.push(`${coderName}: ${row.notes}`);
        }
      });

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codes: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const code = mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null);
        if (code !== null) d.codes.push(code);
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
          if (data && data.codes.length > 0) {
            const modalResult = calculateModalValue(data.codes);
            modalValues.set(vKey, modalResult.modalValue);
            row[vKey] = outputCommentsInsteadOfCodes ? data.comments.join(' | ') : (mapCodeForExport(modalResult.modalValue) ?? '');
          } else {
            row[vKey] = '';
          }
        }

        if (includeReplayUrl && (req || serverUrl)) {
          let replayUrl = '';
          for (const vKey of variables) {
            if (modalValues.has(vKey)) {
              const variableId = vKey.split('_').slice(1).join('_');
              const unitName = variableUnitNames.get(vKey) || '';
              replayUrl = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
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
    return Buffer.concat(chunks);
  }

  private async exportAggregatedNewRowPerVariable(
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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-row-per-variable method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(variableRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const variableRecords = await variableRecordsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const variableSet = new Set<string>();
    const variableUnitNames = new Map<string, string>();
    variableRecords.forEach(v => {
      if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
        const compositeKey = `${v.unitName}_${v.variableId}`;
        if (!manualCodingVariableSet || manualCodingVariableSet.has(`${v.unitName}|${v.variableId}`)) {
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      }
    });

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v1 IS NOT NULL')
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariables.forEach(v => {
        if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
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

    this.applyJobFilters(coderRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const coderRecords = await coderRecordsQuery
      .groupBy('user.username')
      .getRawMany();

    const allCoderNames = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
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
      this.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
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
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group', 'Unit', 'Variable'];
    if (includeReplayUrl) baseHeaders.push('Replay URL');

    const coderHeaderNames: string[] = [];
    allCoderNames.forEach(name => {
      const displayName = anonymizeCoders ? coderMapping.get(name)! : name;
      coderHeaderNames.push(`${displayName} Code`, `${displayName} Score`);
      if (includeComments) coderHeaderNames.push(`${displayName} Note`);
    });

    const headers = [...baseHeaders, ...coderHeaderNames];
    if (includeModalValue) headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
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
        .addSelect('cju.score', 'cju_score')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.score_v3', 'score_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.score_v2', 'score_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds);

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
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
            cju_score: null,
            notes: null
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      // Group data by person and variable
      const personData = new Map<number, Map<string, Map<string, { code: number | null, score: number | null, comment: string | null }>>>();

      manualCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        const coderName = row.username || `Job ${row.jobId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;

        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const code = mapCodeForExport(rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null);
        const score = row.cju_score ?? row.score_v3 ?? row.score_v2 ?? row.score_v1;
        coderMap.set(coderName, {
          code,
          score: score !== null && score !== undefined ? parseInt(score, 10) : null,
          comment: row.notes
        });
      });

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        const coderName = 'AUTO';
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;
        coderMap.set(coderName, {
          code: mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null),
          score: row.score_v1 !== null && row.score_v1 !== undefined ? parseInt(row.score_v1, 10) : null,
          comment: null
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

          const codes: number[] = [];
          const comments: string[] = [];

          allCoderNames.forEach(coderName => {
            const data = coderDataMap?.get(coderName);
            const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
            row[`${displayName} Code`] = outputCommentsInsteadOfCodes ? (data?.comment ?? '') : (data?.code ?? '');
            row[`${displayName} Score`] = outputCommentsInsteadOfCodes ? '' : (data?.score ?? '');
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
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
          }

          if (includeComments) {
            row[COMMENTS_HEADER] = comments.join(' | ');
          }

          if (includeReplayUrl && (req || serverUrl)) {
            const unitName = variableUnitNames.get(vKey) || '';
            const variableId = vKey.split('_').slice(1).join('_');
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          worksheet.addRow(row).commit();
        }
      }

      if (global.gc) global.gc();
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  private async exportAggregatedNewColumnPerCoder(
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
    coderIds?: number[]
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-column-per-coder method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    // 1. Get all coders to build mapping
    const coderRecordsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(coderRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const coderRecords = await coderRecordsQuery
      .groupBy('user.username')
      .getRawMany();
    const allCoderNamesList = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
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

    this.applyJobFilters(variableCoderPairsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const variableCoderPairs = await variableCoderPairsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .addGroupBy('user.username')
      .getRawMany();

    const colSet = new Set<string>();
    variableCoderPairs.forEach(v => {
      if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
        if (!manualCodingVariableSet || manualCodingVariableSet.has(`${v.unitName}|${v.variableId}`)) {
          const cName = anonymizeCoders ? coderMapping.get(v.userName)! : v.userName;
          colSet.add(`${v.unitName}_${v.variableId}_${cName}`);
        }
      }
    });

    if ((coderTrainingIds?.length || 0) > 0) {
      const managerVariablePairs = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
        .select('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('ctdr.training_id', 'trainingId')
        .addSelect('ctdr.response_id', 'responseId')
        .where('ctdr.workspace_id = :workspaceId', { workspaceId })
        .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds })
        .getRawMany();

      const managerDiscussionMap = await this.getTrainingDiscussionResultsMap(
        workspaceId,
        coderTrainingIds,
        Array.from(new Set(
          managerVariablePairs
            .map(pair => parseInt(pair.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ))
      );

      managerVariablePairs.forEach(pair => {
        if (!pair.unitName || ignoredSet.has(pair.unitName.toUpperCase())) return;
        if (manualCodingVariableSet && !manualCodingVariableSet.has(`${pair.unitName}|${pair.variableId}`)) return;

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
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v1 IS NOT NULL')
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariables.forEach(v => {
        if (v.unitName && !ignoredSet.has(v.unitName.toUpperCase())) {
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
      this.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
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
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    const headers = [...baseHeaders, ...sortedColumns];
    if (includeModalValue) headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
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
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds);

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
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
            notes: null
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      const personData = new Map<number, Map<string, { code: number | null, comment: string | null }>>();

      manualCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const coderName = row.username || `Job ${row.jobId}`;
        const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
        const columnKey = `${row.unitName}_${row.variableId}_${displayName}`;

        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;

        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const code = mapCodeForExport(rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null);
        dataMapForPerson.set(columnKey, {
          code,
          comment: row.notes
        });
      });

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const columnKey = `${row.unitName}_${row.variableId}_Autocoder`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;
        dataMapForPerson.set(columnKey, {
          code: mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null),
          comment: null
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
          row[col] = outputCommentsInsteadOfCodes ? data?.comment || '' : data?.code ?? '';
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
        } else if (includeModalValue) {
          row[MODAL_VALUE_HEADER] = '';
          row[DEVIATION_COUNT_HEADER] = '';
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
    return Buffer.concat(chunks);
  }

  async exportCodingResultsByCoder(
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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.clearPageMapsCache();
    if (checkCancellation) await checkCancellation();

    const codingJobsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
      .leftJoinAndSelect('cjc.user', 'user')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(codingJobsQuery, jobDefinitionIds, coderTrainingIds, coderIds);

    const codingJobs = await codingJobsQuery.getMany();

    if (codingJobs.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    const coderJobsMap = new Map<string, CodingJob[]>();
    const allCoderNames = new Set<string>();
    const managerCoderKeySuffix = '|||manager';

    for (const job of codingJobs) {
      for (const jc of job.codingJobCoders) {
        if (coderIds && coderIds.length > 0 && !coderIds.includes(jc.user.id)) {
          continue;
        }
        allCoderNames.add(jc.user.username);
        const coderKey = `${jc.user.username}_${jc.user.id}`;
        if (!coderJobsMap.has(coderKey)) {
          coderJobsMap.set(coderKey, []);
        }
        coderJobsMap.get(coderKey)!.push(job);
      }
    }

    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      const trainingJobs = codingJobs.filter(job => job.training_id && coderTrainingIds?.includes(job.training_id));

      managerUsernames.forEach(managerUsername => {
        allCoderNames.add(managerUsername);
        const managerCoderKey = `${managerUsername}${managerCoderKeySuffix}`;
        if (!coderJobsMap.has(managerCoderKey)) {
          coderJobsMap.set(managerCoderKey, trainingJobs);
        }
      });
    }

    const coderNameMapping = anonymizeCoders ?
      buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders) :
      null;

    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });

    for (const [coderKey, jobs] of coderJobsMap) {
      if (checkCancellation) await checkCancellation();
      const isManagerSheet = coderKey.endsWith(managerCoderKeySuffix);
      const coderName = isManagerSheet ?
        coderKey.slice(0, -managerCoderKeySuffix.length) :
        coderKey.replace(/_\d+$/, '');
      const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
      const worksheetName = generateUniqueWorksheetName(workbook, displayName);
      const worksheet = workbook.addWorksheet(worksheetName);

      const jobIds = jobs.map(j => j.id);
      const variablePairs = await this.codingJobUnitRepository.createQueryBuilder('cju')
        .select('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .andWhere('cju.unit_name IS NOT NULL')
        .andWhere('cju.variable_id IS NOT NULL')
        .distinct(true)
        .getRawMany();

      const variableColumns = variablePairs
        .map(item => ({
          unitName: item.unitName,
          variableId: item.variableId,
          key: JSON.stringify([item.unitName, item.variableId]),
          header: `${item.unitName} | ${item.variableId}`
        }))
        .sort((a, b) => {
          const unitCmp = a.unitName.localeCompare(b.unitName);
          if (unitCmp !== 0) return unitCmp;
          return a.variableId.localeCompare(b.variableId);
        });

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      const headers = [...baseHeaders, ...variableColumns.map(col => col.header)];

      worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      const personResults = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'id')
        .addSelect('MAX(person.login)', 'login')
        .addSelect('MAX(person.code)', 'code')
        .addSelect('MAX(person.group)', 'group')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .groupBy('person.id')
        .orderBy('MAX(person.login)', 'ASC')
        .getRawMany();

      const batchSize = 100;
      for (let j = 0; j < personResults.length; j += batchSize) {
        const batch = personResults.slice(j, j + batchSize);
        const batchIds = batch.map(p => p.id);

        const personDataMap = new Map<number, Record<string, unknown>>();

        if (isManagerSheet) {
          const trainingIdsForJobs = Array.from(
            new Set(
              jobs
                .map(job => job.training_id)
                .filter((trainingId): trainingId is number => !!trainingId)
            )
          );

          if (trainingIdsForJobs.length > 0) {
            const managerCases = await this.responseRepository.createQueryBuilder('resp')
              .innerJoin('resp.unit', 'unit')
              .innerJoin('unit.booklet', 'booklet')
              .leftJoin('booklet.bookletinfo', 'bookletinfo')
              .innerJoin('booklet.person', 'person')
              .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
              .select('resp.variableid', 'variableId')
              .addSelect('unit.name', 'unitName')
              .addSelect('person.id', 'pId')
              .addSelect('bookletinfo.name', 'bookletName')
              .addSelect('ctdr.training_id', 'trainingId')
              .addSelect('ctdr.response_id', 'responseId')
              .where('person.id IN (:...ids)', { ids: batchIds })
              .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
              .andWhere('ctdr.training_id IN (:...trainingIds)', { trainingIds: trainingIdsForJobs })
              .getRawMany();

            const managerDiscussionMap = await this.getTrainingDiscussionResultsMap(
              workspaceId,
              trainingIdsForJobs,
              Array.from(new Set(
                managerCases
                  .map(item => parseInt(item.responseId, 10))
                  .filter(responseId => !Number.isNaN(responseId))
              ))
            );

            for (const managerCase of managerCases) {
              const trainingId = parseInt(managerCase.trainingId, 10);
              const responseId = parseInt(managerCase.responseId, 10);
              if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

              const discussion = managerDiscussionMap.get(`${trainingId}|${responseId}`);
              if (!discussion?.managerUsername || discussion.managerUsername !== coderName) continue;

              const pid = parseInt(managerCase.pId, 10);
              if (!personDataMap.has(pid)) {
                personDataMap.set(pid, {});
              }

              if (!managerCase.unitName || !managerCase.variableId) {
                continue;
              }

              const pData = personDataMap.get(pid)!;
              const variableKey = JSON.stringify([managerCase.unitName, managerCase.variableId]);
              const mappedCode = mapCodeForExport(discussion.code);
              pData[variableKey] = outputCommentsInsteadOfCodes ? '' : mappedCode ?? '';
              pData[`_metadata_${variableKey}`] = {
                unitName: managerCase.unitName,
                variableId: managerCase.variableId,
                bookletName: managerCase.bookletName
              };
            }
          }
        } else {
          const responses = await this.responseRepository.createQueryBuilder('resp')
            .innerJoin('resp.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .leftJoin('booklet.bookletinfo', 'bookletinfo')
            .innerJoin('booklet.person', 'person')
            .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
            .select('resp.variableid', 'variableId')
            .addSelect('unit.name', 'unitName')
            .addSelect('cju.code', 'cju_code')
            .addSelect('resp.code_v1', 'code_v1')
            .addSelect('resp.code_v2', 'code_v2')
            .addSelect('resp.code_v3', 'code_v3')
            .addSelect('cju.notes', 'notes')
            .addSelect('person.id', 'pId')
            .addSelect('bookletinfo.name', 'bookletName')
            .where('person.id IN (:...ids)', { ids: batchIds })
            .andWhere('cju.coding_job_id IN (:...jobIds)', { jobIds })
            .getRawMany();

          for (const resp of responses) {
            const pid = parseInt(resp.pId, 10);
            if (!personDataMap.has(pid)) {
              personDataMap.set(pid, {});
            }
            const pData = personDataMap.get(pid)!;
            const latest = getLatestCode(resp);
            const rawCode = resp.cju_code ?? latest.code;
            const code = mapCodeForExport(rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null);

            if (!resp.unitName || !resp.variableId) {
              continue;
            }

            const variableKey = JSON.stringify([resp.unitName, resp.variableId]);
            pData[variableKey] = outputCommentsInsteadOfCodes ? resp.notes || '' : code ?? '';
            pData[`_metadata_${variableKey}`] = {
              unitName: resp.unitName,
              variableId: resp.variableId,
              bookletName: resp.bookletName
            };
          }
        }

        for (const p of batch) {
          const pid = parseInt(p.id, 10);
          const pData = personDataMap.get(pid) || {};
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };

          if (includeReplayUrl && (req || serverUrl)) {
            const firstVar = variableColumns.find(v => pData[`_metadata_${v.key}`]);
            if (firstVar) {
              const meta = pData[`_metadata_${firstVar.key}`] as { bookletName: string, unitName: string, variableId: string };
              row['Replay URL'] = await this.generateReplayUrlWithPageLookup(
                req,
                p.login,
                p.code,
                p.group || '',
                meta.bookletName || '',
                meta.unitName,
                meta.variableId,
                workspaceId,
                authToken,
                serverUrl
              );
            }
          }

          for (const variableColumn of variableColumns) {
            row[variableColumn.header] = pData[variableColumn.key] ?? '';
          }
          worksheet.addRow(row).commit();
        }
      }
      await worksheet.commit();
    }

    await workbook.commit();
    return Buffer.concat(chunks);
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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (CODING_INCOMPLETE only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.clearPageMapsCache();
    const MAX_WORKSHEETS = parseInt(process.env.EXPORT_MAX_WORKSHEETS || '100', 10);

    const BATCH_SIZE = 100;

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    if (checkCancellation) await checkCancellation();

    const unitVariableResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('resp.variableid', 'variableId')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (excludeAutoCoded) {
      unitVariableResultsQuery.andWhere('resp.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') });
    }

    if (jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length) {
      unitVariableResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(unitVariableResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
    }

    const combinations = await unitVariableResultsQuery
      .groupBy('unit.name')
      .addGroupBy('resp.variableid')
      .orderBy('unit.name', 'ASC')
      .addOrderBy('resp.variableid', 'ASC')
      .getRawMany();

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    const filteredCombinations = combinations.filter(c => c.unitName && !ignoredSet.has(c.unitName.toUpperCase()))
      .slice(0, MAX_WORKSHEETS);

    if (filteredCombinations.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Antworten für den gewählten Job-/Training-/Kodierer-Filter in diesem Export gefunden' :
          'Keine Antworten für den angeforderten Export gefunden'
      );
    }

    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });

    for (const { unitName, variableId } of filteredCombinations) {
      if (checkCancellation) await checkCancellation();
      const worksheetName = generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
      const worksheet = workbook.addWorksheet(worksheetName);

      // Get all coders for this variable
      const personIdsRaw = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .select('person.id', 'pId')
        .where('unit.name = :unitName', { unitName })
        .andWhere('resp.variableid = :variableId', { variableId })
        .groupBy('person.id')
        .getRawMany();

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

      this.applyJobFilters(coderQueryBuilder, jobDefinitionIds, coderTrainingIds, coderIds);

      const coderQuery = await coderQueryBuilder
        .groupBy('user.username')
        .getRawMany();

      const coderNames = coderQuery.map(c => c.username).sort();
      let discussionResultMap = new Map<string, { code: number | null, managerUsername: string | null, updatedAt: Date | null }>();
      if ((coderTrainingIds?.length || 0) > 0) {
        const managerCases = await this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
          .select('ctdr.training_id', 'trainingId')
          .addSelect('ctdr.response_id', 'responseId')
          .where('person.id IN (:...pIds)', { pIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
          .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds })
          .getRawMany();

        discussionResultMap = await this.getTrainingDiscussionResultsMap(
          workspaceId,
          coderTrainingIds,
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
      if (includeModalValue) baseHeaders.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER);
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
          .addSelect('resp.code_v1', 'code_v1')
          .addSelect('resp.code_v2', 'code_v2')
          .addSelect('resp.code_v3', 'code_v3')
          .addSelect('resp.status_v1', 'status_v1')
          .addSelect('user.username', 'username')
          .addSelect('cju.notes', 'notes')
          .addSelect('person.id', 'pId')
          .addSelect('cj.training_id', 'trainingId')
          .addSelect('cju.response_id', 'responseId')
          .where('person.id IN (:...batchIds)', { batchIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId });

        this.applyJobFilters(dataQueryBuilder, jobDefinitionIds, coderTrainingIds, coderIds);

        const dataQuery = await dataQueryBuilder.getRawMany();

        const personGroup = new Map<number, {
          login: string,
          code: string,
          group: string,
          bookletName: string,
          codings: Record<string, { code: number | null, notes: string | null, status: number | null }>,
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
            const latest = getLatestCode(d);
            const rawCode = d.cju_code ?? latest.code;
            const code = mapCodeForExport(rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null);
            p.codings[d.username] = { code, notes: d.notes, status: d.status_v1 };
          }

          if ((coderTrainingIds?.length || 0) > 0) {
            const trainingId = parseInt(d.trainingId, 10);
            const responseId = parseInt(d.responseId, 10);
            if (!Number.isNaN(trainingId) && !Number.isNaN(responseId)) {
              const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
              if (discussion?.managerUsername && !p.codings[discussion.managerUsername]) {
                p.codings[discussion.managerUsername] = {
                  code: mapCodeForExport(discussion.code),
                  notes: null,
                  status: d.status_v1
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
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          const codes: (number | null)[] = [];
          for (const cName of coderNames) {
            const cData = p.codings[cName];
            const dName = coderMapping?.get(cName) || cName;
            row[dName] = outputCommentsInsteadOfCodes ? cData?.notes || '' : cData?.code ?? '';
            if (cData) codes.push(cData.code);
          }

          if (includeModalValue) {
            const modal = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = modal.modalValue ?? '';
            row[DEVIATION_COUNT_HEADER] = modal.deviationCount;
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
    return Buffer.concat(chunks);
  }

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
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.clearPageMapsCache();
    if (checkCancellation) await checkCancellation();

    try {
      let manualCodingVariableSet: Set<string> | null = null;
      if (excludeAutoCoded) {
        const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
        if (codingListVariables.length > 0) {
          manualCodingVariableSet = new Set(codingListVariables.map(v => `${v.unitName}|${v.variableId}`));
        }
      }

      const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
      const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders && !usePseudoCoders) {
        const codersQuery = this.codingJobRepository.createQueryBuilder('cj')
          .innerJoin('cj.codingJobCoders', 'cjc')
          .innerJoin('cjc.user', 'user')
          .select('user.username', 'username')
          .where('cj.workspace_id = :workspaceId', { workspaceId });

        this.applyJobFilters(codersQuery, jobDefinitionIds, coderTrainingIds, coderIds);

        const coders = await codersQuery
          .groupBy('user.username')
          .getRawMany();
        coderNameMapping = buildCoderNameMapping(coders.map(c => c.username), false);
      }

      const totalCountQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .where('cj.workspace_id = :workspaceId', { workspaceId });

      this.applyJobFilters(totalCountQuery, jobDefinitionIds, coderTrainingIds, coderIds);
      const totalCount = await totalCountQuery.getCount();

      const chunks: Buffer[] = [];
      const includeDiscussionResult = (coderTrainingIds?.length || 0) > 0;

      const headerColumns = ['"Person Login"', '"Person Code"', '"Person Group"', '"Kodierer"', '"Unit"', '"Variable"', '"Kommentar"', '"Kodierzeitpunkt"', '"Code"'];
      if (includeReplayUrl) headerColumns.push('"Replay URL"');
      chunks.push(Buffer.from(`${headerColumns.join(';')}\n`, 'utf-8'));

      const batchSize = 500;
      const pseudoCoderMappings = new Map<string, Map<string, string>>();
      const escapeCsvField = (field: string): string => `"${field?.toString().replace(/"/g, '""') || ''}"`;

      for (let i = 0; i < totalCount; i += batchSize) {
        if (checkCancellation) await checkCancellation();
        const unitsBatchQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
          .innerJoinAndSelect('cju.coding_job', 'cj')
          .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
          .leftJoinAndSelect('cjc.user', 'user')
          .leftJoinAndSelect('cju.response', 'resp')
          .leftJoinAndSelect('resp.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo') // bookletinfo is used for replay URL
          .where('cj.workspace_id = :workspaceId', { workspaceId })
          .orderBy('cju.created_at', 'ASC')
          .skip(i)
          .take(batchSize);

        this.applyJobFilters(unitsBatchQuery, jobDefinitionIds, coderTrainingIds, coderIds);
        const unitsBatch = await unitsBatchQuery.getMany();

        let discussionResultMap = new Map<string, { code: number | null, managerUsername: string | null, updatedAt: Date | null }>();
        if (includeDiscussionResult && unitsBatch.length > 0) {
          const trainingIdSet = new Set<number>();
          const responseIdSet = new Set<number>();
          for (const unit of unitsBatch) {
            const tId = unit.coding_job?.training_id;
            if (tId) trainingIdSet.add(tId);
            if (unit.response_id) responseIdSet.add(unit.response_id);
          }

          if (trainingIdSet.size > 0 && responseIdSet.size > 0) {
            discussionResultMap = await this.getTrainingDiscussionResultsMap(
              workspaceId,
              Array.from(trainingIdSet),
              Array.from(responseIdSet)
            );
          }
        }

        let batchCsv = '';

        // Ensure that all coder rows for the same case (training_id + response_id) are emitted first,
        // then a single coding manager row at the end of that case.
        const sortedUnitsBatch = [...unitsBatch].sort((a, b) => {
          const aTrainingId = a.coding_job?.training_id ?? 0;
          const bTrainingId = b.coding_job?.training_id ?? 0;
          if (aTrainingId !== bTrainingId) return aTrainingId - bTrainingId;
          if (a.response_id !== b.response_id) return a.response_id - b.response_id;
          if (a.variable_id !== b.variable_id) return a.variable_id.localeCompare(b.variable_id);
          const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          return aUpdated - bUpdated;
        });

        let currentCaseKey: string | null = null;
        let currentCaseRepresentative: CodingJobUnit | null = null;
        let emittedManagerForCurrentCase = false;

        const flushManagerRowIfNeeded = async (): Promise<void> => {
          if (!includeDiscussionResult) return;
          if (!currentCaseRepresentative) return;
          if (emittedManagerForCurrentCase) return;

          const trainingId = currentCaseRepresentative.coding_job?.training_id;
          const responseId = currentCaseRepresentative.response_id;
          if (!trainingId || !responseId) return;

          const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
          if (!discussion) return;
          if (!discussion.managerUsername) return;

          const person = currentCaseRepresentative.response?.unit?.booklet?.person;
          const personLogin = person?.login || '';
          const personCode = person?.code || '';
          const personGroup = person?.group || '';
          const unitName = currentCaseRepresentative.unit_name || currentCaseRepresentative.response?.unit?.name || '';
          const managerDisplayName = discussion.managerUsername;
          const discussionTimestamp = discussion.updatedAt ? new Date(discussion.updatedAt).toLocaleString('de-DE').replace(',', '') : '';
          const mappedDiscussionCode = mapCodeForExport(discussion.code);
          const discussionCodeValue = mappedDiscussionCode === null ? '' : mappedDiscussionCode.toString();

          const discussionRowFields = [
            escapeCsvField(personLogin),
            escapeCsvField(personCode),
            escapeCsvField(personGroup),
            escapeCsvField(managerDisplayName),
            escapeCsvField(unitName),
            escapeCsvField(currentCaseRepresentative.variable_id),
            escapeCsvField(''),
            escapeCsvField(discussionTimestamp),
            escapeCsvField(discussionCodeValue)
          ];

          if (includeReplayUrl && (req || serverUrl)) {
            const bookletName = currentCaseRepresentative.response?.unit?.booklet?.bookletinfo?.name || '';
            const replayUnitName = currentCaseRepresentative.response?.unit?.name || unitName;
            const replayUrl = await this.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, currentCaseRepresentative.variable_id, workspaceId, authToken, serverUrl);
            discussionRowFields.push(escapeCsvField(replayUrl));
          }

          batchCsv += `${discussionRowFields.join(';')}\n`;
          emittedManagerForCurrentCase = true;
        };

        for (const unit of sortedUnitsBatch) {
          if (unit.code === null || unit.code === undefined) continue;
          if (unit.unit_name && ignoredSet.has(unit.unit_name.toUpperCase())) continue;
          if (manualCodingVariableSet && !manualCodingVariableSet.has(`${unit.unit_name}|${unit.variable_id}`)) continue;

          const trainingId = unit.coding_job?.training_id ?? 0;
          const caseKey = `${trainingId}|${unit.response_id}`;

          if (currentCaseKey !== null && caseKey !== currentCaseKey) {
            await flushManagerRowIfNeeded();
            currentCaseRepresentative = null;
            emittedManagerForCurrentCase = false;
          }

          currentCaseKey = caseKey;
          if (!currentCaseRepresentative) currentCaseRepresentative = unit;

          const person = unit.response?.unit?.booklet?.person;
          const personLogin = person?.login || '';
          const personCode = person?.code || '';
          const personGroup = person?.group || '';
          const unitName = unit.unit_name || unit.response?.unit?.name || '';
          let coder = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';

          if (anonymizeCoders && coder) {
            if (usePseudoCoders) {
              const varPersonKey = `${unit.variable_id}_${personLogin}_${personCode}`;
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

          const timestamp = unit.updated_at ? new Date(unit.updated_at).toLocaleString('de-DE').replace(',', '') : '';
          const mappedCode = mapCodeForExport(unit.code);
          const codeValue = mappedCode === null ? '' : mappedCode.toString();

          let commentValue = unit.notes || '';
          if (!outputCommentsInsteadOfCodes && unit.coding_issue_option) {
            const issueTexts: Record<number, string> = {
              1: 'Code-Vergabe unsicher', 2: 'Neuer Code nötig', 3: 'Ungültig (Spaßantwort)', 4: 'Technische Probleme'
            };
            commentValue = issueTexts[unit.coding_issue_option] || commentValue;
          }

          const rowFields = [
            escapeCsvField(personLogin),
            escapeCsvField(personCode),
            escapeCsvField(personGroup),
            escapeCsvField(coder),
            escapeCsvField(unitName),
            escapeCsvField(unit.variable_id),
            escapeCsvField(commentValue),
            escapeCsvField(timestamp),
            escapeCsvField(codeValue)
          ];

          if (includeReplayUrl && (req || serverUrl)) {
            const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
            const replayUnitName = unit.response?.unit?.name || unitName;
            const replayUrl = await this.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, unit.variable_id, workspaceId, authToken, serverUrl);
            rowFields.push(escapeCsvField(replayUrl));
          }

          batchCsv += `${rowFields.join(';')}\n`;
        }

        // Flush last case in this batch
        await flushManagerRowIfNeeded();
        chunks.push(Buffer.from(batchCsv, 'utf-8'));
      }

      this.logger.log(`Exported detailed results for workspace ${workspaceId}`);
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error exporting detailed coding results: ${error.message}`, error.stack);
      throw new Error(`Could not export detailed coding results: ${error.message}`);
    }
  }

  async exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding times report for workspace ${workspaceId}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>();
      codingListVariables.forEach(item => {
        manualCodingVariableSet.add(`${item.unitName}|${item.variableId}`);
      });
    }

    const codingJobUnitsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoinAndSelect('cju.coding_job', 'cj')
      .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
      .leftJoinAndSelect('cjc.user', 'user')
      .leftJoinAndSelect('cju.response', 'resp')
      .leftJoinAndSelect('resp.unit', 'unit')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cju.code IS NOT NULL')
      .orderBy('cju.updated_at', 'ASC');

    this.applyJobFilters(codingJobUnitsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
    const codingJobUnitsRaw = await codingJobUnitsQuery.getMany();

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    const codingJobUnits = codingJobUnitsRaw.filter(
      unit => unit.response?.unit?.name && !ignoredSet.has(unit.response.unit.name.toUpperCase())
    );

    this.logger.log(`Found ${codingJobUnits.length} coded coding job units for workspace ${workspaceId} after filtering ignored units`);

    try {
      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        const allCoders = new Set<string>();
        for (const unit of codingJobUnits) {
          const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';
          if (coderName) {
            allCoders.add(coderName);
          }
        }
        coderNameMapping = buildCoderNameMapping(Array.from(allCoders), usePseudoCoders);
      }

      if (codingJobUnits.length > 0) {
        this.logger.log('Sample coded coding job unit:', {
          id: codingJobUnits[0].id,
          variable_id: codingJobUnits[0].variable_id,
          code: codingJobUnits[0].code,
          updated_at: codingJobUnits[0].updated_at,
          unit_name: codingJobUnits[0].response?.unit?.name,
          coders_count: codingJobUnits[0].coding_job?.codingJobCoders?.length,
          first_coder: codingJobUnits[0].coding_job?.codingJobCoders?.[0]?.user?.username
        });
      } else {
        this.logger.warn(`No coded coding job units found for workspace ${workspaceId}`);
      }

      if (codingJobUnits.length === 0) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

        worksheet.columns = [
          { header: 'Unit', key: 'unit', width: 20 },
          { header: 'Variable', key: 'variable', width: 20 },
          { header: 'Gesamt', key: 'gesamt', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };

        worksheet.getColumn('unit').font = { bold: true };
        worksheet.getColumn('variable').font = { bold: true };

        this.logger.log('Generated empty coding times report (no coded units found)');
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
      }

      const variableUnitCoders = new Map<string, Set<string>>();
      const variableUnitCoderTimestamps = new Map<string, Map<string, Date[]>>();

      for (const unit of codingJobUnits) {
        if (!unit.response?.unit?.name || !unit.updated_at) continue;

        const variableId = unit.variable_id;
        const unitName = unit.response.unit.name;
        const variableUnitKey = `${unitName}|${variableId}`;
        const timestamp = new Date(unit.updated_at);

        if (manualCodingVariableSet) {
          if (!manualCodingVariableSet.has(variableUnitKey)) {
            continue;
          }
        }

        if (!variableUnitCoders.has(variableUnitKey)) {
          variableUnitCoders.set(variableUnitKey, new Set());
        }

        if (!variableUnitCoderTimestamps.has(variableUnitKey)) {
          variableUnitCoderTimestamps.set(variableUnitKey, new Map<string, Date[]>());
        }

        for (const jobCoder of unit.coding_job?.codingJobCoders || []) {
          const coderName = jobCoder.user?.username || 'Unknown';
          variableUnitCoders.get(variableUnitKey)!.add(coderName);

          const coderTimestampsByVariableUnit = variableUnitCoderTimestamps.get(variableUnitKey)!;
          if (!coderTimestampsByVariableUnit.has(coderName)) {
            coderTimestampsByVariableUnit.set(coderName, []);
          }
          coderTimestampsByVariableUnit.get(coderName)!.push(timestamp);
        }
      }

      const coderList = Array.from(new Set(
        Array.from(variableUnitCoders.values()).flatMap(coders => Array.from(coders.values()))
      )).sort();

      const displayCoderList = coderNameMapping ?
        coderList.map(coder => coderNameMapping.get(coder) || coder) :
        coderList;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

      worksheet.columns = [
        { header: 'Unit', key: 'unit', width: 20 },
        { header: 'Variable', key: 'variable', width: 20 },
        ...displayCoderList.map((displayCoder, index) => ({ header: displayCoder, key: `coder_${index}`, width: 15 })),
        { header: 'Gesamt', key: 'gesamt', width: 15 }
      ];

      const sortedVariableUnitKeys = Array.from(variableUnitCoders.keys()).sort();

      for (const variableUnitKey of sortedVariableUnitKeys) {
        const [unitName, variableId] = variableUnitKey.split('|');
        const assignedCoders = variableUnitCoders.get(variableUnitKey)!;

        const rowData: { [key: string]: string | number | null } = {
          unit: unitName,
          variable: variableId,
          gesamt: null
        };

        let totalTimeSum = 0;
        let totalValidCodings = 0;

        for (let i = 0; i < coderList.length; i++) {
          const coderName = coderList[i];
          const columnKey = `coder_${i}`;

          if (assignedCoders.has(coderName)) {
            const coderTimestamps = variableUnitCoderTimestamps
              .get(variableUnitKey)
              ?.get(coderName) || [];
            const avgTime = this.calculateAverageCodingTime(coderTimestamps);
            rowData[columnKey] = avgTime !== null ? Math.round(avgTime! * 100) / 100 : null;
            if (avgTime !== null) {
              totalTimeSum += avgTime;
              totalValidCodings += 1;
            }
          } else {
            rowData[columnKey] = null;
          }
        }

        rowData.gesamt = totalValidCodings > 0 ? Math.round((totalTimeSum / totalValidCodings) * 100) / 100 : null;

        worksheet.addRow(rowData);
      }

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      worksheet.getColumn('unit').font = { bold: true };
      worksheet.getColumn('variable').font = { bold: true };

      this.logger.log(`Generated coding times pivot table with ${sortedVariableUnitKeys.length} variable-unit combinations and ${coderList.length} coders`);

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding times report: ${error.message}`, error.stack);
      throw new Error(`Could not export coding times report: ${error.message}`);
    }
  }

  private calculateAverageCodingTime(timestamps: Date[]): number | null {
    if (timestamps.length < 2) {
      return null;
    }

    const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

    const timeSpans: number[] = [];
    const MAX_GAP_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

    for (let i = 1; i < sortedTimestamps.length; i++) {
      const timeSpan = sortedTimestamps[i].getTime() - sortedTimestamps[i - 1].getTime();

      if (timeSpan <= MAX_GAP_MS) {
        timeSpans.push(timeSpan);
      }
    }

    if (timeSpans.length === 0) {
      return null;
    }

    const totalTimeMs = timeSpans.reduce((sum, span) => sum + span, 0);
    const averageTimeMs = totalTimeMs / timeSpans.length;

    return averageTimeMs / 1000; // Convert to seconds
  }

  private async getTrainingDiscussionResultsMap(
    workspaceId: number,
    trainingIds?: number[],
    responseIds?: number[]
  ): Promise<Map<string, { code: number | null, managerUsername: string | null, updatedAt: Date | null }>> {
    if (!trainingIds?.length) {
      return new Map();
    }

    if (responseIds && responseIds.length === 0) {
      return new Map();
    }

    const where: {
      workspace_id: number;
      training_id: number | FindOperator<number>;
      response_id?: number | FindOperator<number>;
    } = {
      workspace_id: workspaceId,
      training_id: In(trainingIds)
    };

    if (responseIds) {
      where.response_id = In(responseIds);
    }

    const discussionResults = await this.coderTrainingDiscussionResultRepository.find({ where });
    if (discussionResults.length === 0) {
      return new Map();
    }

    const managerUserIds = Array.from(
      new Set(
        discussionResults
          .map(result => result.manager_user_id)
          .filter((managerUserId): managerUserId is number => !!managerUserId)
      )
    );

    const managerUsernameById = new Map<number, string>();
    if (managerUserIds.length > 0) {
      const managers = await this.userRepository.findBy({ id: In(managerUserIds) });
      managers.forEach(manager => managerUsernameById.set(manager.id, manager.username));
    }

    return new Map(
      discussionResults.map(result => {
        const managerUsername = result.manager_user_id ?
          (managerUsernameById.get(result.manager_user_id) || null) :
          null;

        return [`${result.training_id}|${result.response_id}`, {
          code: result.code,
          managerUsername,
          updatedAt: result.updated_at
        }];
      })
    );
  }

  private async getTrainingManagerUsernames(workspaceId: number, trainingIds?: number[]): Promise<string[]> {
    const discussionResultsMap = await this.getTrainingDiscussionResultsMap(workspaceId, trainingIds);
    return Array.from(
      new Set(
        Array.from(discussionResultsMap.values())
          .map(result => result.managerUsername)
          .filter((managerUsername): managerUsername is string => !!managerUsername)
      )
    ).sort();
  }

  private applyJobFilters(
    query: SelectQueryBuilder<unknown>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): void {
    const hasJd = jobDefinitionIds && jobDefinitionIds.length > 0;
    const hasTraining = coderTrainingIds && coderTrainingIds.length > 0;
    const hasCoders = coderIds && coderIds.length > 0;

    if (hasJd || hasTraining) {
      query.andWhere(new Brackets(qb => {
        if (hasJd) {
          qb.orWhere('cj.job_definition_id IN (:...jobDefinitionIds)', { jobDefinitionIds });
        }
        if (hasTraining) {
          qb.orWhere('cj.training_id IN (:...coderTrainingIds)', { coderTrainingIds });
        }
      }));
    }

    if (hasCoders) {
      // Use EXISTS subquery to filter by coder IDs in coding_job_coder table
      query.andWhere(`EXISTS (
        SELECT 1 FROM coding_job_coder filter_cjc
        WHERE filter_cjc.coding_job_id = cj.id
        AND filter_cjc.user_id IN (:...coderIds)
      )`, { coderIds });
    }
  }
}
