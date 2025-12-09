import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import * as fastCsv from 'fast-csv';
import * as ExcelJS from 'exceljs';
import FileUpload from '../entities/file_upload.entity';
import { ResponseEntity } from '../entities/response.entity';
import { extractVariableLocation } from '../../utils/voud/extractVariableLocation';
import { statusStringToNumber, statusNumberToString } from '../utils/response-status-converter';
import { LRUCache } from './lru-cache';
import { WorkspaceFilesService } from './workspace-files.service';

export interface CodingItem {
  unit_key: string;
  unit_alias: string;
  login_name: string;
  login_code: string;
  login_group: string;
  booklet_id: string;
  variable_id: string;
  variable_page: string;
  variable_anchor: string;
  url?: string;
}

interface JsonStream {
  on(event: 'data', listener: (item: CodingItem) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

@Injectable()
export class CodingListService {
  private readonly logger = new Logger(CodingListService.name);
  private voudCache = new LRUCache<Map<string, string>>(50);
  private vocsCache = new LRUCache<Set<string>>(50);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    private readonly workspaceFilesService: WorkspaceFilesService
  ) {}

  private async loadVoudData(unitName: string, workspaceId: number): Promise<Map<string, string>> {
    const cacheKey = `${workspaceId}:${unitName}`;
    let variablePageMap = this.voudCache.get(cacheKey);
    if (variablePageMap) {
      return variablePageMap;
    }

    const voudFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOUD`
      }
    });

    variablePageMap = new Map<string, string>();

    if (voudFile) {
      try {
        const respDefinition = { definition: voudFile.data as string };
        const variableLocation = extractVariableLocation([respDefinition]);
        if (variableLocation[0]?.variable_pages) {
          for (const pageInfo of variableLocation[0].variable_pages) {
            variablePageMap.set(pageInfo.variable_ref, pageInfo.variable_path?.pages?.toString() || '0');
          }
        }
      } catch (error) {
        this.logger.debug(`Error parsing VOUD file for unit ${unitName}: ${error.message}`);
      }
    }

    this.voudCache.set(cacheKey, variablePageMap);
    return variablePageMap;
  }

  private async loadVocsExclusions(unitName: string, workspaceId: number): Promise<Set<string>> {
    const cacheKey = `${workspaceId}:${unitName}`;

    let exclusions = this.vocsCache.get(cacheKey);
    if (exclusions) {
      return exclusions;
    }

    exclusions = new Set<string>();

    const vocsFile = await this.fileUploadRepository.findOne({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: `${unitName}.VOCS`
      }
    });

    if (vocsFile) {
      try {
        interface VocsScheme { variableCodings?: { id: string; sourceType?: string }[] }

        const data = typeof vocsFile.data === 'string' ? JSON.parse(vocsFile.data) : vocsFile.data;
        const scheme = data as VocsScheme;
        const vars = scheme?.variableCodings || [];

        for (const vc of vars) {
          if (vc && vc.id && vc.sourceType && vc.sourceType === 'BASE_NO_VALUE') {
            exclusions.add(`${unitName}||${vc.id}`);
          }
        }
      } catch (error) {
        this.logger.debug(`Error parsing VOCS file for unit ${unitName}: ${error.message}`);
      }
    }

    this.vocsCache.set(cacheKey, exclusions);
    return exclusions;
  }

  async getVariablePageMap(unitName: string, workspaceId: number): Promise<Map<string, string>> {
    return this.loadVoudData(unitName, workspaceId);
  }

  private async processResponseItem(
    response: ResponseEntity,
    authToken: string,
    serverUrl: string,
    workspaceId: number
  ): Promise<CodingItem | null> {
    const unit = response.unit;
    if (!unit) return null;

    const booklet = unit.booklet;
    if (!booklet) return null;

    const person = booklet.person;
    const bookletInfo = booklet.bookletinfo;

    const unitKey = unit.name || '';
    const variableId = response.variableid || '';

    const hasValue = response.value != null && response.value.trim() !== '';
    if (!hasValue || /image|text|audio|frame|video|_0/i.test(variableId)) {
      return null;
    }

    const exclusions = await this.loadVocsExclusions(unitKey, workspaceId);
    if (exclusions.has(`${unitKey}||${variableId}`)) {
      return null;
    }

    const variablePageMap = await this.loadVoudData(unitKey, workspaceId);
    const variablePage = variablePageMap.get(variableId) || '0';

    const loginName = person?.login || '';
    const loginCode = person?.code || '';
    const loginGroup = person?.group || '';
    const bookletId = bookletInfo?.name || '';
    const unitAlias = unit.alias || '';
    const variableAnchor = variableId;

    const url = `${serverUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

    return {
      unit_key: unitKey,
      unit_alias: unitAlias,
      login_name: loginName,
      login_code: loginCode,
      login_group: loginGroup,
      booklet_id: bookletId,
      variable_id: variableId,
      variable_page: variablePage,
      variable_anchor: variableAnchor,
      url
    };
  }

  async getCodingList(
    workspace_id: number,
    authToken: string,
    serverUrl?: string
  ): Promise<{
      items: CodingItem[];
      total: number;
    }> {
    try {
      const server = serverUrl;

      // 1) Preload VOUD files and build variable->page mapping
      const voudFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspace_id,
          file_type: 'Resource',
          filename: Like('%.voud')
        }
      });

      this.logger.log(`Found ${voudFiles.length} VOUD files for workspace ${workspace_id}`);

      const variablePageMap = new Map<string, Map<string, string>>();
      for (const voudFile of voudFiles) {
        try {
          const respDefinition = { definition: (voudFile).data };
          const variableLocation = extractVariableLocation([respDefinition]);
          const unitVarPages = new Map<string, string>();
          for (const pageInfo of variableLocation[0].variable_pages) {
            unitVarPages.set(pageInfo.variable_ref, pageInfo.variable_path?.pages?.toString() || '0');
          }
          variablePageMap.set(voudFile.file_id.replace('.VOUD', ''), unitVarPages);
        } catch (error) {
          this.logger.error(`Error parsing VOUD file ${voudFile.filename}: ${error.message}`);
        }
      }
      // 2) Query all coding incomplete responses
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
        .andWhere('person.workspace_id = :workspace_id', { workspace_id })
        .orderBy('response.id', 'ASC');

      const [responses, total] = await queryBuilder.getManyAndCount();

      // 3) Build exclusion Set from VOCS files where sourceType == BASE_NO_VALUE
      interface VocsScheme { variableCodings?: { id: string; sourceType?: string }[] }

      const vocsFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        },
        select: ['file_id', 'data']
      });

      const excludedPairs = new Set<string>(); // key: `${unitKey}||${variableId}`
      for (const file of vocsFiles) {
        try {
          const unitKey = file.file_id.replace('.VOCS', '');
          const data = typeof (file).data === 'string' ? JSON.parse((file).data) : (file).data;
          const scheme = data as VocsScheme;
          const vars = scheme?.variableCodings || [];
          for (const vc of vars) {
            if (vc && vc.id && vc.sourceType && vc.sourceType === 'BASE_NO_VALUE') {
              excludedPairs.add(`${unitKey}||${vc.id}`);
            }
          }
        } catch (e) {
          this.logger.error(`Error parsing VOCS file ${file.file_id}: ${e.message}`);
        }
      }

      // 4) Map responses to output and filter by excludedPairs, variable id substrings, and empty values
      const filtered = (responses).filter(r => {
        const unitKey = r.unit?.name || '';
        const variableId = r.variableid || '';
        const hasExcludedPair = excludedPairs.has(`${unitKey}||${variableId}`);
        const hasExcludedSubstring = /image|text|audio|frame|video|_0/i.test(variableId);
        const hasValue = r.value != null && r.value.trim() !== '';
        return !hasExcludedPair && !hasExcludedSubstring && hasValue;
      });

      const result = filtered.map(response => {
        const unit = response.unit;
        const booklet = unit?.booklet;
        const person = booklet?.person;
        const bookletInfo = booklet?.bookletinfo;
        const loginName = person?.login || '';
        const loginCode = person?.code || '';
        const loginGroup = person?.group || '';
        const bookletId = bookletInfo?.name || '';
        const unitKey = unit?.name || '';
        const unitAlias = unit?.alias || '';
        const variableId = response.variableid || '';
        const unitVarPages = variablePageMap.get(unitKey);
        const variablePage = unitVarPages?.get(variableId) || '0';
        const variableAnchor = variableId;

        const url = `${server}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

        return {
          unit_key: unitKey,
          unit_alias: unitAlias,
          login_name: loginName,
          login_code: loginCode,
          login_group: loginGroup,
          booklet_id: bookletId,
          variable_id: variableId,
          variable_page: variablePage,
          variable_anchor: variableAnchor,
          url
        };
      });

      // 5) Sort
      const sortedResult = result.sort((a, b) => {
        const unitKeyComparison = a.unit_key.localeCompare(b.unit_key);
        if (unitKeyComparison !== 0) {
          return unitKeyComparison;
        }
        return a.variable_id.localeCompare(b.variable_id);
      });

      this.logger.log(`Found ${sortedResult.length} coding items after filtering derived variables, total raw ${total}`);
      return { items: sortedResult, total };
    } catch (error) {
      this.logger.error(`Error fetching coding list: ${error.message}`);
      return { items: [], total: 0 };
    }
  }

  // Memory-efficient streaming CSV generator with on-demand file loading
  async getCodingListCsvStream(workspace_id: number, authToken: string, serverUrl?: string) {
    this.logger.log(`Memory-efficient CSV export for workspace ${workspace_id}`);
    this.voudCache.clear();
    this.vocsCache.clear();
    const csvStream = fastCsv.format({ headers: true });

    (async () => {
      try {
        const batchSize = 5000;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          const responses = await this.responseRepository.createQueryBuilder('response')
            .leftJoinAndSelect('response.unit', 'unit')
            .leftJoinAndSelect('unit.booklet', 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
            .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
            .andWhere('person.workspace_id = :workspace_id', { workspace_id })
            .andWhere('response.id > :lastId', { lastId })
            .orderBy('response.id', 'ASC')
            .take(batchSize)
            .getMany();

          if (!responses.length) break;

          // Process responses in parallel batches for better performance
          const items: CodingItem[] = [];
          const processingPromises = responses.map(response => this.processResponseItem(response, authToken, serverUrl!, workspace_id)
          );

          const results = await Promise.allSettled(processingPromises);

          for (const result of results) {
            if (result.status === 'fulfilled' && result.value !== null) {
              items.push(result.value);
            }
          }

          // Write items to CSV stream
          for (const item of items) {
            const ok = csvStream.write(item);
            totalWritten += 1;

            if (!ok) {
              await new Promise(resolve => { csvStream.once('drain', resolve); });
            }
          }

          // Force garbage collection hint after each batch
          if (global.gc) {
            global.gc();
          }

          lastId = responses[responses.length - 1].id;
          await new Promise(resolve => { setImmediate(resolve); });
        }

        this.logger.log(`CSV stream finished. Rows written: ${totalWritten}`);
        csvStream.end();
      } catch (error) {
        this.logger.error(`Error streaming CSV export: ${error.message}`);
        csvStream.emit('error', error);
      } finally {
        // Clear caches after export to free memory
        this.voudCache.clear();
        this.vocsCache.clear();
      }
    })();

    return csvStream;
  }

  async getCodingListAsExcel(workspace_id: number, authToken?: string, serverUrl?: string): Promise<Buffer> {
    this.logger.log(`Memory-efficient Excel export for workspace ${workspace_id}`);
    this.voudCache.clear();
    this.vocsCache.clear();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Coding List');

    worksheet.columns = [
      { header: 'unit_key', key: 'unit_key', width: 30 },
      { header: 'unit_alias', key: 'unit_alias', width: 30 },
      { header: 'login_name', key: 'login_name', width: 25 },
      { header: 'login_code', key: 'login_code', width: 25 },
      { header: 'login_group', key: 'login_group', width: 25 },
      { header: 'booklet_id', key: 'booklet_id', width: 30 },
      { header: 'variable_id', key: 'variable_id', width: 30 },
      { header: 'variable_page', key: 'variable_page', width: 15 },
      { header: 'variable_anchor', key: 'variable_anchor', width: 30 },
      { header: 'url', key: 'url', width: 60 }
    ];

    try {
      const batchSize = 5000;
      let lastId = 0;
      let totalWritten = 0;

      for (; ;) {
        const responses = await this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
          .andWhere('person.workspace_id = :workspace_id', { workspace_id })
          .andWhere('response.id > :lastId', { lastId })
          .orderBy('response.id', 'ASC')
          .take(batchSize)
          .getMany();

        if (!responses.length) break;

        const processingPromises = responses.map(response => this.processResponseItem(response, authToken!, serverUrl!, workspace_id)
        );

        const results = await Promise.allSettled(processingPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            worksheet.addRow(result.value);
            totalWritten += 1;
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;
        await new Promise(resolve => { setImmediate(resolve); });
      }

      this.logger.log(`Excel export finished. Rows written: ${totalWritten}`);
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error creating Excel export: ${error.message}`);
      throw error;
    } finally {
      // Clear caches after export to free memory
      this.voudCache.clear();
      this.vocsCache.clear();
    }
  }

  getCodingListJsonStream(workspace_id: number, authToken: string, serverUrl?: string): JsonStream {
    this.logger.log(`Memory-efficient JSON stream export for workspace ${workspace_id}`);
    this.voudCache.clear();
    this.vocsCache.clear();

    return {
      on: (event: string, listener: ((item: CodingItem) => void) | (() => void) | ((error: Error) => void)) => {
        if (event === 'data') {
          this.processJsonExport(workspace_id, authToken, serverUrl!, listener as (item: CodingItem) => void);
        } else if (event === 'end') {
          this.endListener = listener as () => void;
        } else if (event === 'error') {
          this.errorListener = listener as (error: Error) => void;
        }
      }
    };
  }

  private endListener: (() => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  private async processJsonExport(workspace_id: number, authToken: string, serverUrl: string, dataListener: (item: CodingItem) => void) {
    try {
      const batchSize = 5000;
      let lastId = 0;

      for (; ;) {
        const responses = await this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') })
          .andWhere('person.workspace_id = :workspace_id', { workspace_id })
          .andWhere('response.id > :lastId', { lastId })
          .orderBy('response.id', 'ASC')
          .take(batchSize)
          .getMany();

        if (!responses.length) break;

        const processingPromises = responses.map(response => this.processResponseItem(response, authToken, serverUrl, workspace_id)
        );

        const results = await Promise.allSettled(processingPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value !== null) {
            dataListener(result.value);
          }
        }

        // Force garbage collection hint after each batch
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;
        await new Promise(resolve => { setImmediate(resolve); });
      }

      // Signal end of stream
      if (this.endListener) {
        this.endListener();
      }

      this.voudCache.clear();
      this.vocsCache.clear();
    } catch (error) {
      this.logger.error(`Error during JSON stream export: ${error.message}`);
      if (this.errorListener) {
        this.errorListener(error);
      }
    }
  }

  async getCodingListVariables(workspaceId: number): Promise<Array<{ unitName: string; variableId: string }>> {
    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .distinct(true)
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.status_v1 = :status', { status: statusStringToNumber('CODING_INCOMPLETE') });

    interface VocsScheme { variableCodings?: { id: string; sourceType?: string }[] }

    const vocsFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: Like('%.VOCS')
      },
      select: ['file_id', 'data']
    });

    const excludedPairs = new Set<string>(); // key: `${unitKey}||${variableId}`
    for (const file of vocsFiles) {
      try {
        const unitKey = file.file_id.replace('.VOCS', '');
        const data = typeof (file).data === 'string' ? JSON.parse((file).data) : (file).data;
        const scheme = data as VocsScheme;
        const vars = scheme?.variableCodings || [];
        for (const vc of vars) {
          if (vc && vc.id && vc.sourceType && vc.sourceType === 'BASE_NO_VALUE') {
            excludedPairs.add(`${unitKey}||${vc.id}`);
          }
        }
      } catch (e) {
        this.logger.error(`Error parsing VOCS file ${file.file_id}: ${e.message}`);
      }
    }

    if (excludedPairs.size > 0) {
      const exclusionConditions: string[] = [];
      const exclusionParams: Record<string, string> = {};

      Array.from(excludedPairs).forEach((pair, index) => {
        const [unitKey, varId] = pair.split('||');
        const unitParam = `unit${index}`;
        const varParam = `var${index}`;
        exclusionConditions.push(`NOT (unit.name = :${unitParam} AND response.variableid = :${varParam})`);
        exclusionParams[unitParam] = unitKey;
        exclusionParams[varParam] = varId;
      });

      queryBuilder.andWhere(`(${exclusionConditions.join(' AND ')})`, exclusionParams);
    }

    // Exclude media variables and derived variables
    queryBuilder.andWhere(
      `response.variableid NOT LIKE 'image%'
       AND response.variableid NOT LIKE 'text%'
       AND response.variableid NOT LIKE 'audio%'
       AND response.variableid NOT LIKE 'frame%'
       AND response.variableid NOT LIKE 'video%'
       AND response.variableid NOT LIKE '%_0' ESCAPE '\\'`
    );

    queryBuilder.andWhere(
      '(response.value IS NOT NULL AND response.value != \'\')'
    );

    const rawResults = await queryBuilder.getRawMany();

    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspaceId);

    const validVariableSets = new Map<string, Set<string>>();
    unitVariableMap.forEach((variables: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), variables);
    });

    const filteredResults = rawResults.filter(row => {
      const unitNamesValidVars = validVariableSets.get(row.unitName?.toUpperCase());
      return unitNamesValidVars?.has(row.variableId);
    });

    this.logger.log(`Found ${rawResults.length} CODING_INCOMPLETE variable groups, filtered to ${filteredResults.length} valid variables`);

    return filteredResults;
  }

  async getCodingResultsByVersionCsvStream(workspace_id: number, version: 'v1' | 'v2' | 'v3', authToken: string, serverUrl?: string, includeReplayUrls: boolean = false) {
    this.logger.log(`Memory-efficient CSV export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls})`);
    this.voudCache.clear();
    this.vocsCache.clear();
    const csvStream = fastCsv.format({ headers: true });

    (async () => {
      try {
        const batchSize = 5000;
        let lastId = 0;
        let totalWritten = 0;

        for (; ;) {
          const responses = await this.responseRepository.createQueryBuilder('response')
            .leftJoinAndSelect('response.unit', 'unit')
            .leftJoinAndSelect('unit.booklet', 'booklet')
            .leftJoinAndSelect('booklet.person', 'person')
            .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
            .where(`response.status_${version} IS NOT NULL`)
            .andWhere('person.workspace_id = :workspace_id', { workspace_id })
            .andWhere('response.id > :lastId', { lastId })
            .orderBy('response.id', 'ASC')
            .take(batchSize)
            .getMany();

          if (!responses.length) break;

          // Process responses in parallel batches for better performance
          const items: CodingItem[] = [];
          const processingPromises = responses.map(response => this.processResponseItemWithVersions(response, version, authToken, serverUrl!, workspace_id, includeReplayUrls)
          );

          const results = await Promise.allSettled(processingPromises);

          for (const result of results) {
            if (result.status === 'fulfilled' && result.value !== null) {
              items.push(result.value);
            }
          }

          // Write items to CSV stream
          for (const item of items) {
            const ok = csvStream.write(item);
            totalWritten += 1;

            if (!ok) {
              await new Promise(resolve => { csvStream.once('drain', resolve); });
            }
          }

          // Force garbage collection hint after each batch
          if (global.gc) {
            global.gc();
          }

          lastId = responses[responses.length - 1].id;
          await new Promise(resolve => { setImmediate(resolve); });
        }

        this.logger.log(`CSV stream finished for version ${version}. Rows written: ${totalWritten}`);
        csvStream.end();
      } catch (error) {
        this.logger.error(`Error streaming CSV export for version ${version}: ${error.message}`);
        csvStream.emit('error', error);
      } finally {
        // Clear caches after export to free memory
        this.voudCache.clear();
        this.vocsCache.clear();
      }
    })();

    return csvStream;
  }

  async getCodingResultsByVersionAsExcel(workspace_id: number, version: 'v1' | 'v2' | 'v3', authToken?: string, serverUrl?: string, includeReplayUrls: boolean = false): Promise<Buffer> {
    this.logger.log(`Starting Excel export for coding results version ${version}, workspace ${workspace_id} (replay URLs: ${includeReplayUrls})`);
    this.voudCache.clear();
    this.vocsCache.clear();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Coding Results');

    // Define headers based on version (include lower versions)
    let headers = this.getHeadersForVersion(version);

    // Add URL column if replay URLs are included
    if (includeReplayUrls) {
      headers = [...headers, 'url'];
    }

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 20 }));

    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    const batchSize = 5000;
    let lastId = 0;

    try {
      for (; ;) {
        const responses = await this.responseRepository.createQueryBuilder('response')
          .leftJoinAndSelect('response.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
          .where(`response.status_${version} IS NOT NULL`)
          .andWhere('person.workspace_id = :workspace_id', { workspace_id })
          .andWhere('response.id > :lastId', { lastId })
          .orderBy('response.id', 'ASC')
          .take(batchSize)
          .getMany();

        if (!responses.length) break;

        for (const response of responses) {
          const itemData = await this.processResponseItemWithVersions(response, version, authToken || '', serverUrl || '', workspace_id, includeReplayUrls);
          if (itemData) {
            worksheet.addRow(itemData);
          }
        }

        // Force garbage collection hint
        if (global.gc) {
          global.gc();
        }

        lastId = responses[responses.length - 1].id;
        await new Promise(resolve => { setImmediate(resolve); });
      }

      this.logger.log(`Excel export completed for version ${version}`);
      return await workbook.xlsx.writeBuffer() as unknown as Buffer;
    } catch (error) {
      this.logger.error(`Error during Excel export for version ${version}: ${error.message}`);
      throw error;
    } finally {
      this.voudCache.clear();
      this.vocsCache.clear();
    }
  }

  private getHeadersForVersion(version: 'v1' | 'v2' | 'v3'): string[] {
    const baseHeaders = [
      'unit_key',
      'unit_alias',
      'login_name',
      'login_code',
      'login_group',
      'booklet_id',
      'variable_id',
      'variable_page',
      'variable_anchor'
    ];

    // Add version-specific columns for comparison
    if (version === 'v1') {
      return [
        ...baseHeaders,
        'status_v1',
        'code_v1',
        'score_v1'
      ];
    } if (version === 'v2') {
      return [
        ...baseHeaders,
        'status_v1',
        'code_v1',
        'score_v1',
        'status_v2',
        'code_v2',
        'score_v2'
      ];
    } // v3
    return [
      ...baseHeaders,
      'status_v1',
      'code_v1',
      'score_v1',
      'status_v2',
      'code_v2',
      'score_v2',
      'status_v3',
      'code_v3',
      'score_v3'
    ];
  }

  private async processResponseItemWithVersions(
    response: ResponseEntity,
    targetVersion: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    workspaceId: number,
    includeReplayUrls: boolean = false
  ): Promise<CodingItem | null> {
    try {
      const unit = response.unit;
      if (!unit) return null;

      const booklet = unit.booklet;
      if (!booklet) return null;

      const person = booklet.person;
      const bookletInfo = booklet.bookletinfo;

      const unitKey = unit.name || '';
      const variableId = response.variableid || '';

      // Load variable page mapping
      const variablePageMap = await this.loadVoudData(unitKey, workspaceId);
      const variablePage = variablePageMap.get(variableId) || '0';

      const loginName = person?.login || '';
      const loginCode = person?.code || '';
      const loginGroup = person?.group || '';
      const bookletId = bookletInfo?.name || '';
      const unitAlias = unit.alias || '';
      const variableAnchor = variableId;

      const url = `${serverUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitKey}/${variablePage}/${variableAnchor}?auth=${authToken}`;

      const baseItem: CodingItem & Record<string, unknown> = {
        unit_key: unitKey,
        unit_alias: unitAlias,
        login_name: loginName,
        login_code: loginCode,
        login_group: loginGroup,
        booklet_id: bookletId,
        variable_id: variableId,
        variable_page: variablePage,
        variable_anchor: variableAnchor
      };

      // Add version-specific data (include all lower versions) and convert status numbers to strings
      if (targetVersion === 'v1') {
        baseItem.status_v1 = response.status_v1 != null ? statusNumberToString(response.status_v1) || '' : '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
      } else if (targetVersion === 'v2') {
        baseItem.status_v1 = response.status_v1 != null ? statusNumberToString(response.status_v1) || '' : '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
        baseItem.status_v2 = response.status_v2 != null ? statusNumberToString(response.status_v2) || '' : '';
        baseItem.code_v2 = response.code_v2 || '';
        baseItem.score_v2 = response.score_v2 || '';
      } else { // v3
        baseItem.status_v1 = response.status_v1 != null ? statusNumberToString(response.status_v1) || '' : '';
        baseItem.code_v1 = response.code_v1 || '';
        baseItem.score_v1 = response.score_v1 || '';
        baseItem.status_v2 = response.status_v2 != null ? statusNumberToString(response.status_v2) || '' : '';
        baseItem.code_v2 = response.code_v2 || '';
        baseItem.score_v2 = response.score_v2 || '';
        baseItem.status_v3 = response.status_v3 != null ? statusNumberToString(response.status_v3) || '' : '';
        baseItem.code_v3 = response.code_v3 || '';
        baseItem.score_v3 = response.score_v3 || '';
      }

      // Append replay URL as the last field if requested
      if (includeReplayUrls) {
        baseItem.url = url;
      }

      return baseItem;
    } catch (error) {
      this.logger.error(`Error processing response ${response.id}: ${error.message}`);
      return null;
    }
  }
}
