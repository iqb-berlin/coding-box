import { Injectable, Logger } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, IsNull, Not, Repository
} from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request, Response } from 'express';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { generateReplayUrlFromRequest } from '../../../utils/replay-url.util';
import {
  calculateModalValue, getLatestCode, buildCoderNameMapping
} from '../../../utils/coding-utils';
import { generateUniqueWorksheetName } from '../../../utils/excel-utils';
import { CodingListService, CodingItem } from './coding-list.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
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
    req: Request,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    workspaceId: number,
    authToken: string
  ): Promise<string> {
    const variablePage = await this.getVariablePage(unitName, variableId, workspaceId);
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId} with method: ${doubleCodingMethod}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ' (including auto-coded)'}`);

    this.clearPageMapsCache();

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.exportAggregatedNewRowPerVariable(workspaceId, outputCommentsInsteadOfCodes, includeReplayUrl, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, authToken, req, excludeAutoCoded, checkCancellation);
    } if (doubleCodingMethod === 'new-column-per-coder') {
      return this.exportAggregatedNewColumnPerCoder(workspaceId, outputCommentsInsteadOfCodes, anonymizeCoders, usePseudoCoders, includeComments, includeModalValue, excludeAutoCoded, checkCancellation);
    }

    this.logger.log(`Exporting aggregated results with most-frequent method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      if (codingListVariables.length === 0) {
        throw new Error('No manual coding variables found in the coding list for this workspace');
      }
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    // 1. Get all variables to define columns
    const variableRecords = await this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
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

    if (!excludeAutoCoded) {
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
    const personResults = await this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .addSelect('MAX(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error('No coding results found for this workspace');
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
      const manualCoding = await this.codingJobUnitRepository.createQueryBuilder('cju')
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
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .getRawMany();

      const autoCoding = excludeAutoCoded ? [] : await this.responseRepository.createQueryBuilder('resp')
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
        const code = row.code_v3 ?? row.code_v2 ?? row.code_v1;
        if (code !== null && code !== undefined) d.codes.push(parseInt(code, 10));
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
        if (row.code_v1 !== null && row.code_v1 !== undefined) d.codes.push(parseInt(row.code_v1, 10));
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
            row[vKey] = outputCommentsInsteadOfCodes ? data.comments.join(' | ') : (modalResult.modalValue ?? '');
          } else {
            row[vKey] = '';
          }
        }

        if (includeReplayUrl && req) {
          let replayUrl = '';
          for (const vKey of variables) {
            if (modalValues.has(vKey)) {
              const variableId = vKey.split('_').slice(1).join('_');
              const unitName = variableUnitNames.get(vKey) || '';
              replayUrl = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken);
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-row-per-variable method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    // 1. Get all variables
    const variableRecords = await this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
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

    if (!excludeAutoCoded) {
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

    // 2. Get all coders
    const coderRecords = await this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .groupBy('user.username')
      .getRawMany();

    const allCoderNames = coderRecords.map(c => c.userName).sort();
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNames.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 3. Get all persons
    const personResults = await this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .addSelect('MAX(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error('No coding results found for this workspace');
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
    headers.push(COMMENTS_HEADER);

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

      const manualCoding = await this.codingJobUnitRepository.createQueryBuilder('cju')
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
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.score_v3', 'score_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.score_v2', 'score_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .getRawMany();

      const autoCoding = excludeAutoCoded ? [] : await this.responseRepository.createQueryBuilder('resp')
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

        const code = row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const score = row.score_v3 ?? row.score_v2 ?? row.score_v1;
        coderMap.set(coderName, {
          code: code !== null && code !== undefined ? parseInt(code, 10) : null,
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
          code: row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null,
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
            row[`${displayName} Code`] = data?.code ?? '';
            row[`${displayName} Score`] = data?.score ?? '';
            if (includeComments) row[`${displayName} Note`] = data?.comment ?? '';
            if (data?.code !== null && data?.code !== undefined) codes.push(data.code);
            if (data?.comment) comments.push(`${displayName}: ${data.comment}`);
          });

          // Add AUTO if present
          if (coderDataMap?.has('AUTO')) {
            const data = coderDataMap.get('AUTO')!;
            if (data.code !== null && data.code !== undefined) codes.push(data.code);
          }

          if (includeModalValue) {
            const modalResult = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = modalResult.modalValue ?? '';
            row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
          }

          row[COMMENTS_HEADER] = comments.join(' | ');

          if (includeReplayUrl && req) {
            const unitName = variableUnitNames.get(vKey) || '';
            const variableId = vKey.split('_').slice(1).join('_');
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken);
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-column-per-coder method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const COMMENTS_HEADER = 'Kommentare';

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
      manualCodingVariableSet = new Set<string>(codingListVariables.map(item => `${item.unitName}|${item.variableId}`));
    }

    // 1. Get all coders to build mapping
    const coderRecords = await this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .groupBy('user.username')
      .getRawMany();
    const allCoderNamesList = coderRecords.map(c => c.userName).sort();
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNamesList.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 2. Get all variable-coder pairs for columns
    const variableCoderPairs = await this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
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

    if (!excludeAutoCoded) {
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
    const personResults = await this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error('No coding results found for this workspace');
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

      const manualCoding = await this.codingJobUnitRepository.createQueryBuilder('cju')
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
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .getRawMany();

      const autoCoding = excludeAutoCoded ? [] : await this.responseRepository.createQueryBuilder('resp')
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

        const code = row.code_v3 ?? row.code_v2 ?? row.code_v1;
        dataMapForPerson.set(columnKey, {
          code: code !== null && code !== undefined ? parseInt(code, 10) : null,
          comment: row.notes
        });
      });

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const columnKey = `${row.unitName}_${row.variableId}_Autocoder`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;
        dataMapForPerson.set(columnKey, {
          code: row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null,
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

        if (includeModalValue) {
          const modalResult = calculateModalValue(codes);
          row[MODAL_VALUE_HEADER] = modalResult.modalValue ?? '';
          row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.clearPageMapsCache();
    if (checkCancellation) await checkCancellation();

    const codingJobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['codingJobCoders', 'codingJobCoders.user']
    });

    if (codingJobs.length === 0) {
      throw new Error('No coding jobs found for this workspace');
    }

    const coderJobsMap = new Map<string, CodingJob[]>();
    const allCoderNames = new Set<string>();

    for (const job of codingJobs) {
      for (const jc of job.codingJobCoders) {
        allCoderNames.add(jc.user.username);
        const coderKey = `${jc.user.username}_${jc.user.id}`;
        if (!coderJobsMap.has(coderKey)) {
          coderJobsMap.set(coderKey, []);
        }
        coderJobsMap.get(coderKey)!.push(job);
      }
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
      const [coderName] = coderKey.split('_');
      const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
      const worksheetName = generateUniqueWorksheetName(workbook, displayName);
      const worksheet = workbook.addWorksheet(worksheetName);

      const jobIds = jobs.map(j => j.id);
      const codingJobVariables = await this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      });
      const variableIds = Array.from(new Set(codingJobVariables.map(v => v.variable_id))).sort();

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      const headers = [...baseHeaders, ...variableIds];

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

        const responses = await this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .leftJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
          .select('resp.variableid', 'variableId')
          .addSelect('unit.name', 'unitName')
          .addSelect('resp.code_v1', 'code_v1')
          .addSelect('resp.code_v2', 'code_v2')
          .addSelect('resp.code_v3', 'code_v3')
          .addSelect('cju.notes', 'notes')
          .addSelect('booklet.person_id', 'pId')
          .addSelect('bookletinfo.name', 'bookletName')
          .where('booklet.person_id IN (:...ids)', { ids: batchIds })
          .andWhere('cju.coding_job_id IN (:...jobIds)', { jobIds })
          .getRawMany();

        const personDataMap = new Map<number, Record<string, unknown>>();
        for (const resp of responses) {
          const pid = parseInt(resp.pId, 10);
          if (!personDataMap.has(pid)) {
            personDataMap.set(pid, {});
          }
          const pData = personDataMap.get(pid)!;
          const latest = getLatestCode(resp);
          pData[resp.variableId] = outputCommentsInsteadOfCodes ? resp.notes || '' : latest.code ?? '';
          pData[`_metadata_${resp.variableId}`] = { unitName: resp.unitName, bookletName: resp.bookletName };
        }

        for (const p of batch) {
          const pid = parseInt(p.id, 10);
          const pData = personDataMap.get(pid) || {};
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };

          if (includeReplayUrl && req) {
            const firstVar = variableIds.find(v => pData[`_metadata_${v}`]);
            if (firstVar) {
              const meta = pData[`_metadata_${firstVar}`] as { bookletName: string, unitName: string };
              row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', meta.bookletName || '', meta.unitName, firstVar, workspaceId, authToken);
            }
          }

          for (const vId of variableIds) {
            row[vId] = pData[vId] ?? '';
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
    checkCancellation?: () => Promise<void>
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (CODING_INCOMPLETE only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.clearPageMapsCache();
    const MAX_WORKSHEETS = parseInt(process.env.EXPORT_MAX_WORKSHEETS || '100', 10);

    const BATCH_SIZE = 100;

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';

    if (checkCancellation) await checkCancellation();

    const unitVariableResults = await this.responseRepository.createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (excludeAutoCoded) {
      unitVariableResults.andWhere('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') });
    }

    const combinations = await unitVariableResults
      .groupBy('unit.name')
      .addGroupBy('response.variableid')
      .orderBy('unit.name', 'ASC')
      .addOrderBy('response.variableid', 'ASC')
      .getRawMany();

    const ignoredUnits = await this.workspaceCoreService.getIgnoredUnits(workspaceId);
    const ignoredSet = new Set(ignoredUnits.map(u => u.toUpperCase()));

    const filteredCombinations = combinations.filter(c => c.unitName && !ignoredSet.has(c.unitName.toUpperCase()))
      .slice(0, MAX_WORKSHEETS);

    if (filteredCombinations.length === 0) {
      throw new Error('No responses found for requested export');
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
        .select('booklet.person_id', 'pId')
        .where('unit.name = :unitName', { unitName })
        .andWhere('resp.variableid = :variableId', { variableId })
        .groupBy('booklet.person_id')
        .getRawMany();

      const pIds = personIdsRaw.map(r => r.pId);
      if (pIds.length === 0) {
        await worksheet.commit();
        continue;
      }

      // Find coders involved
      const coderQuery = await this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'job')
        .innerJoin('job.codingJobCoders', 'jc')
        .innerJoin('jc.user', 'user')
        .select('user.username', 'username')
        .where('cju.unit_name = :unitName', { unitName })
        .andWhere('cju.variable_id = :variableId', { variableId })
        .andWhere('job.workspace_id = :workspaceId', { workspaceId })
        .groupBy('user.username')
        .getRawMany();

      const coderNames = coderQuery.map(c => c.username).sort();
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
        const dataQuery = await this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .leftJoin('booklet.bookletinfo', 'bookletinfo')
          .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
          .leftJoin('cju.coding_job', 'job')
          .leftJoin('job.codingJobCoders', 'jc')
          .leftJoin('jc.user', 'user')
          .select('person.login', 'login')
          .addSelect('person.code', 'code')
          .addSelect('person.group', 'group')
          .addSelect('bookletinfo.name', 'bookletName')
          .addSelect('resp.code_v1', 'code_v1')
          .addSelect('resp.code_v2', 'code_v2')
          .addSelect('resp.code_v3', 'code_v3')
          .addSelect('resp.status_v1', 'status_v1')
          .addSelect('user.username', 'username')
          .addSelect('cju.notes', 'notes')
          .addSelect('person.id', 'pId')
          .where('person.id IN (:...batchIds)', { batchIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .getRawMany();

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
            p.codings[d.username] = { code: latest.code, notes: d.notes, status: d.status_v1 };
          }
        }

        for (const [, p] of personGroup) {
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };

          if (includeReplayUrl && req) {
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken);
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
    checkCancellation?: () => Promise<void>
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
        const coders = await this.codingJobRepository.createQueryBuilder('job')
          .innerJoin('job.codingJobCoders', 'jc')
          .innerJoin('jc.user', 'user')
          .select('user.username', 'username')
          .where('job.workspace_id = :workspaceId', { workspaceId })
          .groupBy('user.username')
          .getRawMany();
        coderNameMapping = buildCoderNameMapping(coders.map(c => c.username), false);
      }

      const totalCount = await this.codingJobUnitRepository.count({
        where: { coding_job: { workspace_id: workspaceId } }
      });

      const chunks: Buffer[] = [];
      const headerColumns = ['"Person"', '"Kodierer"', '"Variable"', '"Kommentar"', '"Kodierzeitpunkt"', '"Code"'];
      if (includeReplayUrl) headerColumns.push('"Replay URL"');
      chunks.push(Buffer.from(`${headerColumns.join(';')}\n`, 'utf-8'));

      const batchSize = 500;
      const pseudoCoderMappings = new Map<string, Map<string, string>>();
      const escapeCsvField = (field: string): string => `"${field?.toString().replace(/"/g, '""') || ''}"`;

      for (let i = 0; i < totalCount; i += batchSize) {
        if (checkCancellation) await checkCancellation();
        const unitsBatch = await this.codingJobUnitRepository.find({
          where: { coding_job: { workspace_id: workspaceId } },
          relations: [
            'coding_job',
            'coding_job.codingJobCoders',
            'coding_job.codingJobCoders.user',
            'response',
            'response.unit',
            'response.unit.booklet',
            'response.unit.booklet.person'
          ],
          order: { created_at: 'ASC' },
          skip: i,
          take: batchSize
        });

        let batchCsv = '';
        for (const unit of unitsBatch) {
          if (unit.code === null || unit.code === undefined) continue;
          if (unit.unit_name && ignoredSet.has(unit.unit_name.toUpperCase())) continue;
          if (manualCodingVariableSet && !manualCodingVariableSet.has(`${unit.unit_name}|${unit.variable_id}`)) continue;

          const person = unit.response?.unit?.booklet?.person;
          const personId = person?.code || person?.login || '';
          let coder = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';

          if (anonymizeCoders && coder) {
            if (usePseudoCoders) {
              const varPersonKey = `${unit.variable_id}_${personId}`;
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
          const codeValue = (unit.code >= -4 && unit.code <= -1) ? '' : unit.code.toString();

          let commentValue = unit.notes || '';
          if (!outputCommentsInsteadOfCodes && unit.coding_issue_option) {
            const issueTexts: Record<number, string> = {
              1: 'Code-Vergabe unsicher', 2: 'Neuer Code nötig', 3: 'Ungültig (Spaßantwort)', 4: 'Technische Probleme'
            };
            commentValue = issueTexts[unit.coding_issue_option] || commentValue;
          }

          const rowFields = [
            escapeCsvField(personId),
            escapeCsvField(coder),
            escapeCsvField(unit.variable_id),
            escapeCsvField(commentValue),
            escapeCsvField(timestamp),
            escapeCsvField(codeValue)
          ];

          if (includeReplayUrl && req) {
            const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
            const unitName = unit.response?.unit?.name || '';
            const group = person?.group || '';
            const replayUrl = await this.generateReplayUrlWithPageLookup(req, person?.login || '', person?.code || '', group, bookletName, unitName, unit.variable_id, workspaceId, authToken);
            rowFields.push(escapeCsvField(replayUrl));
          }
          batchCsv += `${rowFields.join(';')}\n`;
        }
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
    checkCancellation?: () => Promise<void>
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

    const codingJobUnitsRaw = await this.codingJobUnitRepository.find({
      where: {
        coding_job: {
          workspace_id: workspaceId
        },
        code: Not(IsNull()) // Only include units that have been coded
      },
      relations: [
        'coding_job',
        'coding_job.codingJobCoders',
        'coding_job.codingJobCoders.user',
        'response',
        'response.unit'
      ],
      select: {
        id: true,
        variable_id: true,
        updated_at: true,
        code: true,
        coding_job: {
          id: true,
          codingJobCoders: {
            id: true,
            user: {
              id: true,
              username: true
            }
          }
        },
        response: {
          id: true,
          unit: {
            id: true,
            name: true
          }
        }
      },
      order: {
        updated_at: 'ASC'
      }
    });

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

      const coderTimestamps = new Map<string, Date[]>();

      for (const unit of codingJobUnits) {
        if (!unit.updated_at || !unit.coding_job?.codingJobCoders?.length) {
          continue;
        }

        const timestamp = new Date(unit.updated_at);

        for (const jobCoder of unit.coding_job.codingJobCoders) {
          const coderName = jobCoder.user?.username || 'Unknown';

          if (!coderTimestamps.has(coderName)) {
            coderTimestamps.set(coderName, []);
          }

          coderTimestamps.get(coderName)!.push(timestamp);
        }
      }

      const coderAverages = new Map<string, number | null>();
      for (const [coderName, timestamps] of coderTimestamps) {
        const avgTime = this.calculateAverageCodingTime(timestamps);
        coderAverages.set(coderName, avgTime);
      }

      const variableUnitCoders = new Map<string, Set<string>>();

      for (const unit of codingJobUnits) {
        if (!unit.response?.unit?.name) continue;

        const variableId = unit.variable_id;
        const unitName = unit.response.unit.name;
        const variableUnitKey = `${unitName}|${variableId}`;

        if (manualCodingVariableSet) {
          if (!manualCodingVariableSet.has(variableUnitKey)) {
            continue;
          }
        }

        if (!variableUnitCoders.has(variableUnitKey)) {
          variableUnitCoders.set(variableUnitKey, new Set());
        }

        for (const jobCoder of unit.coding_job?.codingJobCoders || []) {
          const coderName = jobCoder.user?.username || 'Unknown';
          variableUnitCoders.get(variableUnitKey)!.add(coderName);
        }
      }

      const coderList = Array.from(coderTimestamps.keys()).sort();

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
            const avgTime = coderAverages.get(coderName);
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
}
