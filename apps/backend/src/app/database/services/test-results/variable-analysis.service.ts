import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import * as fastCsv from 'fast-csv';
import {
  VariableAnalysisResultDto,
  VariableCombo
} from '../../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableAnalysisResultPageDto } from '../../../admin/variable-analysis/dto/variable-analysis-result-page.dto';
import { VariableAnalysisTableRowDto } from '../../../admin/variable-analysis/dto/variable-analysis-table-row.dto';
import { statusNumberToString } from '../../utils/response-status-converter';
import {
  JobQueueService,
  VariableAnalysisJobData,
  VariableAnalysisJobResult,
  VariableAnalysisResultCacheManifest
} from '../../../job-queue/job-queue.service';
import { VariableFrequencyDto } from '../../../admin/variable-analysis/dto/variable-frequency.dto';
import { VariableAnalysisJobDto } from '../../../admin/variable-analysis/dto/variable-analysis-job.dto';
import { CacheService } from '../../../cache/cache.service';

interface NormalizedVariableAnalysisPaging {
  page: number;
  pageSize: number;
  search: string;
  onlyEmpty: boolean;
  includeSchemaCodes: boolean;
  sortBy: VariableAnalysisSortBy;
  sortDirection: VariableAnalysisSortDirection;
}

interface VariableAnalysisResultOptions {
  includeSchemaCodes?: boolean | string;
}

interface NormalizedVariableAnalysisFilter {
  search: string;
  onlyEmpty: boolean;
  includeSchemaCodes: boolean;
}

type VariableAnalysisSortDirection = 'asc' | 'desc';

type VariableAnalysisSortBy =
  | 'unitName'
  | 'variableId'
  | 'value'
  | 'label'
  | 'score'
  | 'count'
  | 'percentage'
  | 'totalCount'
  | 'emptyCount'
  | 'emptyPercentage'
  | 'statusSummary';

const VARIABLE_ANALYSIS_EXPORT_COLUMNS = [
  { header: 'Unit-ID', key: 'unitId', width: 12 },
  { header: 'Unit-Name', key: 'unitName', width: 24 },
  { header: 'Variablen-ID', key: 'variableId', width: 22 },
  { header: 'Wert', key: 'value', width: 36 },
  { header: 'Label', key: 'label', width: 36 },
  { header: 'Wert ist leer', key: 'isEmptyValue', width: 14 },
  { header: 'Anzahl', key: 'count', width: 12 },
  { header: 'Anteil (%)', key: 'percentage', width: 14 },
  { header: 'Antworten gesamt', key: 'totalCount', width: 18 },
  { header: 'Leere Werte', key: 'emptyCount', width: 14 },
  { header: 'Leere Werte (%)', key: 'emptyPercentage', width: 18 },
  { header: 'Unterschiedliche Werte', key: 'distinctValueCount', width: 22 },
  { header: 'Weitere Werte nicht enthalten', key: 'hiddenValueCount', width: 28 },
  { header: 'Antwortstatus', key: 'statusSummary', width: 42 }
] as const;

type VariableAnalysisExportColumnKey =
  typeof VARIABLE_ANALYSIS_EXPORT_COLUMNS[number]['key'];

type VariableAnalysisExportCell = string | number;

type VariableAnalysisExportRow = Record<
VariableAnalysisExportColumnKey,
VariableAnalysisExportCell
>;

@Injectable()
export class VariableAnalysisService {
  private readonly logger = new Logger(VariableAnalysisService.name);
  private readonly RESULT_CACHE_KEY_PREFIX = 'variable-analysis';
  private readonly DEFAULT_PAGE = 1;
  private readonly DEFAULT_PAGE_SIZE = 50;
  private readonly MAX_PAGE_SIZE = 200;
  private readonly MAX_SORTED_PAGE_WINDOW_ROWS = 100000;
  private readonly DEFAULT_SORT_BY: VariableAnalysisSortBy = 'unitName';
  private readonly DEFAULT_SORT_DIRECTION: VariableAnalysisSortDirection =
    'asc';

  private readonly SORTABLE_FIELDS = new Set<VariableAnalysisSortBy>([
    'unitName',
    'variableId',
    'value',
    'label',
    'score',
    'count',
    'percentage',
    'totalCount',
    'emptyCount',
    'emptyPercentage',
    'statusSummary'
  ]);

  constructor(
    private jobQueueService: JobQueueService,
    private cacheService: CacheService
  ) {}

  async createAnalysisJob(
    workspaceId: number,
    unitId?: number,
    variableId?: string
  ): Promise<VariableAnalysisJobDto> {
    const existingJobs = await this.getAnalysisJobs(workspaceId);
    const hasActiveJob = existingJobs.some(
      j => j.status === 'pending' || j.status === 'processing'
    );

    if (hasActiveJob) {
      throw new ConflictException(
        `A variable analysis job is already in progress for workspace ${workspaceId}`
      );
    }

    const jobData: VariableAnalysisJobData = {
      workspaceId,
      unitId,
      variableId,
      cacheKey: this.createResultCacheKey(workspaceId)
    };

    const job = await this.jobQueueService.addVariableAnalysisJob(jobData);
    this.logger.log(`Created variable analysis job with ID ${job.id}`);

    // Map Bull job to DTO
    return VariableAnalysisJobDto.fromJob({
      id: job.id,
      workspaceId,
      unitId,
      variableId,
      status: 'pending', // Initial status
      progress: 0,
      timestamp: Date.now()
    });
  }

  async getAnalysisJob(
    jobId: number | string,
    workspaceId?: number
  ): Promise<VariableAnalysisJobDto> {
    const job = await this.jobQueueService.getVariableAnalysisJob(
      jobId.toString()
    );

    if (!job) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(
          `Job with ID ${jobId} not found in workspace ${workspaceId}`
        );
      } else {
        throw new NotFoundException(`Job with ID ${jobId} not found`);
      }
    }

    if (workspaceId !== undefined && job.data.workspaceId !== workspaceId) {
      throw new NotFoundException(
        `Job with ID ${jobId} not found in workspace ${workspaceId}`
      );
    }

    const state = await job.getState();
    const progress = await job.progress();

    return VariableAnalysisJobDto.fromJob({
      id: job.id,
      workspaceId: job.data.workspaceId,
      unitId: job.data.unitId,
      variableId: job.data.variableId,
      status: state === 'active' ? 'processing' : state, // Map 'active' to 'processing' to match previous enum if needed
      progress,
      error: job.failedReason,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn
    });
  }

  async getAnalysisResults(
    jobId: number | string,
    workspaceId?: number,
    options: VariableAnalysisResultOptions = {}
  ): Promise<VariableAnalysisResultDto> {
    const job = await this.getCompletedAnalysisJob(jobId, workspaceId);
    const includeSchemaCodes = this.normalizeBooleanOption(
      options.includeSchemaCodes
    );

    const cacheKey = this.getResultCacheKey(job.returnvalue, job.data.cacheKey);

    if (cacheKey) {
      const cachedResult = await this.getCachedResult(cacheKey);
      if (cachedResult) {
        return this.withSchemaCodeVisibility(
          cachedResult,
          includeSchemaCodes
        );
      }

      throw new Error(`Job with ID ${jobId} has no cached results`);
    }

    if (!this.isVariableAnalysisResult(job.returnvalue)) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    return this.withSchemaCodeVisibility(
      job.returnvalue as VariableAnalysisResultDto,
      includeSchemaCodes
    );
  }

  async getAnalysisResultsPage(
    jobId: number | string,
    workspaceId?: number,
    options: {
      page?: number | string;
      pageSize?: number | string;
      search?: string;
      onlyEmpty?: boolean | string;
      includeSchemaCodes?: boolean | string;
      sortBy?: string;
      sortDirection?: string;
    } = {}
  ): Promise<VariableAnalysisResultPageDto> {
    const job = await this.getCompletedAnalysisJob(jobId, workspaceId);
    const paging = this.normalizePagingOptions(options);
    const cacheKey = this.getResultCacheKey(job.returnvalue, job.data.cacheKey);

    if (cacheKey) {
      const cachedPage = await this.getCachedResultPage(cacheKey, paging);
      if (cachedPage) {
        return cachedPage;
      }

      throw new Error(`Job with ID ${jobId} has no cached results`);
    }

    if (!this.isVariableAnalysisResult(job.returnvalue)) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    return this.getResultPage(
      job.returnvalue as VariableAnalysisResultDto,
      paging
    );
  }

  async exportAnalysisResultsAsCsv(
    jobId: number | string,
    workspaceId: number,
    options: {
      search?: string;
      onlyEmpty?: boolean | string;
      includeSchemaCodes?: boolean | string;
    } = {}
  ): Promise<string> {
    const result = await this.getAnalysisResultsForExport(
      jobId,
      workspaceId,
      options
    );
    const rows = this.createExportRows(result);
    const csvRows = rows.map(row => this.toCsvExportRow(row));
    const csvContent = await fastCsv.writeToString(csvRows, {
      headers: VARIABLE_ANALYSIS_EXPORT_COLUMNS.map(column => column.header),
      alwaysWriteHeaders: true,
      delimiter: ';',
      quote: '"'
    });

    return `\uFEFF${csvContent}`;
  }

  async exportAnalysisResultsAsXlsx(
    jobId: number | string,
    workspaceId: number,
    options: {
      search?: string;
      onlyEmpty?: boolean | string;
      includeSchemaCodes?: boolean | string;
    } = {}
  ): Promise<Buffer> {
    const result = await this.getAnalysisResultsForExport(
      jobId,
      workspaceId,
      options
    );
    const rows = this.createExportRows(result);
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet('Antwortwerte');
    worksheet.columns = VARIABLE_ANALYSIS_EXPORT_COLUMNS.map(column => ({
      header: column.header,
      key: column.key,
      width: column.width
    }));
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, rows.length + 1),
        column: VARIABLE_ANALYSIS_EXPORT_COLUMNS.length
      }
    };

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    rows.forEach(row => worksheet.addRow(row));
    ['percentage', 'emptyPercentage'].forEach(columnKey => {
      worksheet.getColumn(columnKey).numFmt = '0.0';
    });
    [
      'unitId',
      'count',
      'totalCount',
      'emptyCount',
      'distinctValueCount',
      'hiddenValueCount'
    ].forEach(columnKey => {
      worksheet.getColumn(columnKey).numFmt = '0';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async getAnalysisJobs(
    workspaceId: number
  ): Promise<VariableAnalysisJobDto[]> {
    const jobs =
      await this.jobQueueService.getVariableAnalysisJobs(workspaceId);

    // Map to DTOs and sort by creation date
    const dtos = await Promise.all(
      jobs.map(async job => {
        const state = await job.getState();
        const progress = await job.progress();
        return VariableAnalysisJobDto.fromJob({
          id: job.id,
          workspaceId: job.data.workspaceId,
          unitId: job.data.unitId,
          variableId: job.data.variableId,
          status: state === 'active' ? 'processing' : state,
          progress,
          error: job.failedReason,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn
        });
      })
    );

    return dtos.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async deleteJob(
    workspaceId: number,
    jobId: string | number
  ): Promise<boolean> {
    const job = await this.jobQueueService.getVariableAnalysisJob(
      jobId.toString()
    );
    const deleted = await this.jobQueueService.deleteVariableAnalysisJob(
      jobId.toString()
    );

    if (deleted) {
      await this.deleteCachedResult(job?.data?.cacheKey, job?.returnvalue);
    }

    return deleted;
  }

  async cancelJob(
    workspaceId: number,
    jobId: string | number
  ): Promise<boolean> {
    return this.jobQueueService.cancelVariableAnalysisJob(jobId.toString());
  }

  async deleteAllJobs(workspaceId: number): Promise<void> {
    const jobs =
      await this.jobQueueService.getVariableAnalysisJobs(workspaceId);
    await this.jobQueueService.deleteVariableAnalysisJobs(workspaceId);
    await Promise.all(
      jobs.map(job => this.deleteCachedResult(job.data.cacheKey, job.returnvalue)
      )
    );
  }

  private createResultCacheKey(workspaceId: number): string {
    return `${this.RESULT_CACHE_KEY_PREFIX}:${workspaceId}:${randomUUID()}`;
  }

  private async getCompletedAnalysisJob(
    jobId: number | string,
    workspaceId?: number
  ) {
    const job = await this.jobQueueService.getVariableAnalysisJob(
      jobId.toString()
    );

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    if (workspaceId !== undefined && job.data.workspaceId !== workspaceId) {
      throw new NotFoundException(
        `Job with ID ${jobId} not found in workspace ${workspaceId}`
      );
    }

    const state = await job.getState();
    if (state !== 'completed') {
      throw new Error(
        `Job with ID ${jobId} is not completed (status: ${state})`
      );
    }

    return job;
  }

  private getResultCacheKey(
    returnvalue: unknown,
    dataCacheKey?: string
  ): string | undefined {
    if (dataCacheKey) {
      return dataCacheKey;
    }

    if (this.isVariableAnalysisJobResult(returnvalue)) {
      return returnvalue.cacheKey;
    }

    return undefined;
  }

  private isVariableAnalysisJobResult(
    value: unknown
  ): value is VariableAnalysisJobResult {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as VariableAnalysisJobResult).cacheKey === 'string'
    );
  }

  private isVariableAnalysisResult(
    value: unknown
  ): value is VariableAnalysisResultDto {
    return (
      typeof value === 'object' &&
      value !== null &&
      Array.isArray((value as VariableAnalysisResultDto).variableCombos) &&
      typeof (value as VariableAnalysisResultDto).frequencies === 'object' &&
      typeof (value as VariableAnalysisResultDto).total === 'number'
    );
  }

  private isChunkedResultManifest(
    value: unknown
  ): value is VariableAnalysisResultCacheManifest {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as VariableAnalysisResultCacheManifest).storage === 'chunked' &&
      Number.isInteger(
        (value as VariableAnalysisResultCacheManifest).variableComboChunks
      ) &&
      Number.isInteger(
        (value as VariableAnalysisResultCacheManifest).frequencyChunks
      )
    );
  }

  private async getCachedResult(
    cacheKey: string
  ): Promise<VariableAnalysisResultDto | null> {
    const cachedValue = await this.cacheService.get<
    VariableAnalysisResultDto | VariableAnalysisResultCacheManifest
    >(cacheKey);

    if (!cachedValue) {
      return null;
    }

    if (this.isVariableAnalysisResult(cachedValue)) {
      return cachedValue;
    }

    if (this.isChunkedResultManifest(cachedValue)) {
      throw new Error(
        'Variable analysis result is stored in chunks; use the paginated results endpoint'
      );
    }

    return null;
  }

  private async getCachedResultPage(
    cacheKey: string,
    paging: NormalizedVariableAnalysisPaging
  ): Promise<VariableAnalysisResultPageDto | null> {
    const cachedValue = await this.cacheService.get<
    VariableAnalysisResultDto | VariableAnalysisResultCacheManifest
    >(cacheKey);

    if (!cachedValue) {
      return null;
    }

    if (this.isVariableAnalysisResult(cachedValue)) {
      return this.getResultPage(cachedValue, paging);
    }

    if (!this.isChunkedResultManifest(cachedValue)) {
      return null;
    }

    return this.getChunkedResultPage(cacheKey, cachedValue, paging);
  }

  private async getAnalysisResultsForExport(
    jobId: number | string,
    workspaceId: number,
    options: {
      search?: string;
      onlyEmpty?: boolean | string;
      includeSchemaCodes?: boolean | string;
    }
  ): Promise<VariableAnalysisResultDto> {
    const job = await this.getCompletedAnalysisJob(jobId, workspaceId);
    const filter = this.normalizeFilterOptions(options);
    const cacheKey = this.getResultCacheKey(job.returnvalue, job.data.cacheKey);

    if (cacheKey) {
      const cachedResult = await this.getCachedResultForExport(cacheKey, filter);
      if (cachedResult) {
        return cachedResult;
      }

      throw new Error(`Job with ID ${jobId} has no cached results`);
    }

    if (!this.isVariableAnalysisResult(job.returnvalue)) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    return this.getFilteredResultForExport(
      job.returnvalue as VariableAnalysisResultDto,
      filter
    );
  }

  private async getCachedResultForExport(
    cacheKey: string,
    filter: NormalizedVariableAnalysisFilter
  ): Promise<VariableAnalysisResultDto | null> {
    const cachedValue = await this.cacheService.get<
    VariableAnalysisResultDto | VariableAnalysisResultCacheManifest
    >(cacheKey);

    if (!cachedValue) {
      return null;
    }

    if (this.isVariableAnalysisResult(cachedValue)) {
      return this.getFilteredResultForExport(cachedValue, filter);
    }

    if (!this.isChunkedResultManifest(cachedValue)) {
      return null;
    }

    return this.getChunkedResultForExport(cacheKey, cachedValue, filter);
  }

  private async getChunkedResultForExport(
    cacheKey: string,
    manifest: VariableAnalysisResultCacheManifest,
    filter: NormalizedVariableAnalysisFilter
  ): Promise<VariableAnalysisResultDto | null> {
    const variableCombos: VariableCombo[] = [];

    for (let index = 0; index < manifest.variableComboChunks; index += 1) {
      const chunk = await this.cacheService.get<VariableCombo[]>(
        this.getVariableComboChunkKey(cacheKey, index)
      );
      if (!chunk) {
        return null;
      }

      chunk.forEach(combo => {
        if (this.matchesFilter(combo, filter)) {
          variableCombos.push(combo);
        }
      });
    }

    const selectedComboKeys = new Set(
      variableCombos.map(combo => this.getComboKey(combo))
    );
    const frequencies = await this.getFrequenciesForCombos(
      cacheKey,
      manifest,
      selectedComboKeys,
      filter.includeSchemaCodes
    );
    if (!frequencies) {
      return null;
    }

    return {
      variableCombos,
      frequencies,
      total: variableCombos.length
    };
  }

  private async getChunkedResultPage(
    cacheKey: string,
    manifest: VariableAnalysisResultCacheManifest,
    paging: NormalizedVariableAnalysisPaging
  ): Promise<VariableAnalysisResultPageDto | null> {
    const matchingComboByKey = new Map<string, VariableCombo>();
    const maxPage = this.getMaxSortedPage(paging.pageSize);
    const pageableRowLimit = maxPage * paging.pageSize;
    const requestedPage = Math.min(paging.page, maxPage);

    for (let index = 0; index < manifest.variableComboChunks; index += 1) {
      const chunk = await this.cacheService.get<VariableCombo[]>(
        this.getVariableComboChunkKey(cacheKey, index)
      );
      if (!chunk) {
        return null;
      }

      for (const combo of chunk) {
        if (this.matchesPagingFilter(combo, paging)) {
          matchingComboByKey.set(this.getComboKey(combo), combo);
        }
      }
    }

    if (matchingComboByKey.size === 0) {
      return {
        variableCombos: [],
        frequencies: {},
        total: 0,
        unfilteredTotal: manifest.total,
        rows: [],
        rowTotal: 0,
        pageableRowTotal: 0,
        maxPage,
        page: this.DEFAULT_PAGE,
        pageSize: paging.pageSize,
        totalPages: 0
      };
    }

    const candidateEndIndex = requestedPage * paging.pageSize;
    const pageCandidates: VariableAnalysisTableRowDto[] = [];
    let rowTotal = 0;

    for (let index = 0; index < manifest.frequencyChunks; index += 1) {
      const chunk = await this.cacheService.get<
      Array<[string, VariableFrequencyDto[]]>
      >(this.getFrequencyChunkKey(cacheKey, index));
      if (!chunk) {
        return null;
      }

      for (const [comboKey, frequencyRows] of chunk) {
        const combo = matchingComboByKey.get(comboKey);
        if (!combo) {
          continue;
        }

        const visibleRows = this.getVisibleFrequencyRows(
          frequencyRows,
          paging.includeSchemaCodes
        );
        const tableRows = this.createTableRowsForCombo(combo, visibleRows);
        rowTotal += tableRows.length;
        tableRows.forEach(row => this.addPageCandidate(
          pageCandidates,
          row,
          candidateEndIndex,
          paging
        ));
      }
    }

    const pageableRowTotal = Math.min(rowTotal, pageableRowLimit);
    const totalPages = Math.ceil(pageableRowTotal / paging.pageSize);
    const page = totalPages === 0 ?
      this.DEFAULT_PAGE :
      Math.min(requestedPage, totalPages);
    const startIndex = (page - 1) * paging.pageSize;
    const pageEndIndex = page * paging.pageSize;
    const pageRows = pageCandidates
      .sort((a, b) => this.compareRows(a, b, paging))
      .slice(startIndex, pageEndIndex);
    const matchingCombos = Array.from(matchingComboByKey.values());

    return {
      variableCombos: this.getCombosForRows(matchingCombos, pageRows),
      frequencies: this.getFrequenciesForRows(pageRows),
      total: matchingComboByKey.size,
      unfilteredTotal: manifest.total,
      rows: pageRows,
      rowTotal,
      pageableRowTotal,
      maxPage,
      page,
      pageSize: paging.pageSize,
      totalPages
    };
  }

  private getMaxSortedPage(pageSize: number): number {
    return Math.max(
      this.DEFAULT_PAGE,
      Math.floor(this.MAX_SORTED_PAGE_WINDOW_ROWS / pageSize)
    );
  }

  private addPageCandidate(
    pageCandidates: VariableAnalysisTableRowDto[],
    row: VariableAnalysisTableRowDto,
    limit: number,
    paging: NormalizedVariableAnalysisPaging
  ): void {
    if (limit <= 0) {
      return;
    }

    if (pageCandidates.length < limit) {
      pageCandidates.push(row);
      this.siftUpWorstRow(pageCandidates, pageCandidates.length - 1, paging);
      return;
    }

    if (this.compareRows(row, pageCandidates[0], paging) < 0) {
      pageCandidates[0] = row;
      this.siftDownWorstRow(pageCandidates, 0, paging);
    }
  }

  private siftUpWorstRow(
    rows: VariableAnalysisTableRowDto[],
    index: number,
    paging: NormalizedVariableAnalysisPaging
  ): void {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (!this.isWorseRow(rows[currentIndex], rows[parentIndex], paging)) {
        return;
      }

      [rows[parentIndex], rows[currentIndex]] = [
        rows[currentIndex],
        rows[parentIndex]
      ];
      currentIndex = parentIndex;
    }
  }

  private siftDownWorstRow(
    rows: VariableAnalysisTableRowDto[],
    index: number,
    paging: NormalizedVariableAnalysisPaging
  ): void {
    let currentIndex = index;

    while (currentIndex < rows.length) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let worstIndex = currentIndex;

      if (
        leftIndex < rows.length &&
        this.isWorseRow(rows[leftIndex], rows[worstIndex], paging)
      ) {
        worstIndex = leftIndex;
      }

      if (
        rightIndex < rows.length &&
        this.isWorseRow(rows[rightIndex], rows[worstIndex], paging)
      ) {
        worstIndex = rightIndex;
      }

      if (worstIndex === currentIndex) {
        return;
      }

      [rows[currentIndex], rows[worstIndex]] = [
        rows[worstIndex],
        rows[currentIndex]
      ];
      currentIndex = worstIndex;
    }
  }

  private isWorseRow(
    a: VariableAnalysisTableRowDto,
    b: VariableAnalysisTableRowDto,
    paging: NormalizedVariableAnalysisPaging
  ): boolean {
    return this.compareRows(a, b, paging) > 0;
  }

  private async getFrequenciesForCombos(
    cacheKey: string,
    manifest: VariableAnalysisResultCacheManifest,
    selectedComboKeys: Set<string>,
    includeSchemaCodes: boolean
  ): Promise<Record<string, VariableFrequencyDto[]> | null> {
    const frequencies: Record<string, VariableFrequencyDto[]> = {};
    selectedComboKeys.forEach(comboKey => {
      frequencies[comboKey] = [];
    });

    if (selectedComboKeys.size === 0) {
      return frequencies;
    }

    for (let index = 0; index < manifest.frequencyChunks; index += 1) {
      const chunk = await this.cacheService.get<
      Array<[string, VariableFrequencyDto[]]>
      >(this.getFrequencyChunkKey(cacheKey, index));
      if (!chunk) {
        return null;
      }

      for (const [key, values] of chunk) {
        if (selectedComboKeys.has(key)) {
          frequencies[key] = this.getVisibleFrequencyRows(
            values,
            includeSchemaCodes
          );
        }
      }
    }

    return frequencies;
  }

  private getResultPage(
    result: VariableAnalysisResultDto,
    paging: NormalizedVariableAnalysisPaging
  ): VariableAnalysisResultPageDto {
    const filteredCombos = result.variableCombos.filter(combo => this.matchesPagingFilter(combo, paging)
    );
    const frequencies = this.getVisibleFrequenciesForCombos(
      result,
      filteredCombos,
      paging.includeSchemaCodes
    );

    return this.getRowPageFromResult(
      {
        variableCombos: filteredCombos,
        frequencies,
        total: filteredCombos.length
      },
      paging,
      {
        unfilteredTotal: result.total,
        unfilteredRowTotal: this.createTableRows(
          result.variableCombos,
          this.getVisibleFrequenciesForCombos(
            result,
            result.variableCombos,
            paging.includeSchemaCodes
          )
        ).length
      }
    );
  }

  private getRowPageFromResult(
    result: VariableAnalysisResultDto,
    paging: NormalizedVariableAnalysisPaging,
    totals: { unfilteredTotal: number; unfilteredRowTotal?: number }
  ): VariableAnalysisResultPageDto {
    const rows = this.sortRows(
      this.createTableRows(result.variableCombos, result.frequencies),
      paging
    );
    const startIndex = (paging.page - 1) * paging.pageSize;
    const pageRows = rows.slice(startIndex, startIndex + paging.pageSize);
    const variableCombos = this.getCombosForRows(
      result.variableCombos,
      pageRows
    );
    const frequencies = this.getFrequenciesForRows(pageRows);

    return {
      variableCombos,
      frequencies,
      total: result.variableCombos.length,
      unfilteredTotal: totals.unfilteredTotal,
      rows: pageRows,
      rowTotal: rows.length,
      pageableRowTotal: rows.length,
      unfilteredRowTotal: totals.unfilteredRowTotal,
      page: paging.page,
      pageSize: paging.pageSize,
      totalPages: Math.ceil(rows.length / paging.pageSize)
    };
  }

  private getVisibleFrequenciesForCombos(
    result: VariableAnalysisResultDto,
    combos: VariableCombo[],
    includeSchemaCodes: boolean
  ): Record<string, VariableFrequencyDto[]> {
    const frequencies: Record<string, VariableFrequencyDto[]> = {};

    combos.forEach(combo => {
      const comboKey = this.getComboKey(combo);
      frequencies[comboKey] = this.getVisibleFrequencyRows(
        result.frequencies[comboKey] || [],
        includeSchemaCodes
      );
    });

    return frequencies;
  }

  private createTableRows(
    combos: VariableCombo[],
    frequencies: Record<string, VariableFrequencyDto[]>
  ): VariableAnalysisTableRowDto[] {
    return combos.flatMap(combo => this.createTableRowsForCombo(
      combo,
      frequencies[this.getComboKey(combo)] || []
    ));
  }

  private createTableRowsForCombo(
    combo: VariableCombo,
    rows: VariableFrequencyDto[]
  ): VariableAnalysisTableRowDto[] {
    const totalCount = combo.totalCount ?? this.sumCounts(rows);
    const emptyCount = combo.emptyCount ?? this.sumCounts(
      rows.filter(frequency => frequency.value === '')
    );
    const emptyPercentage = combo.emptyPercentage ??
      this.calculatePercentage(emptyCount, totalCount);
    const distinctValueCount = combo.distinctValueCount ?? rows.length;
    const displayedObservedValueCount = rows.filter(
      frequency => !frequency.isSchemaOnly
    ).length;
    const hiddenValueCount = Math.max(
      0,
      distinctValueCount - displayedObservedValueCount
    );
    const statusSummary = this.formatStatusSummary(combo.statusCounts || []);

    const toTableRow = (
      row: VariableFrequencyDto
    ): VariableAnalysisTableRowDto => ({
      unitId: combo.unitId,
      unitName: combo.unitName,
      variableId: combo.variableId,
      sourceVariableId: combo.sourceVariableId,
      variableAlias: combo.variableAlias,
      selectionSource: combo.selectionSource,
      sourceType: combo.sourceType,
      isDerived: combo.isDerived,
      hasCodingScheme: combo.hasCodingScheme,
      value: row.value,
      label: row.label,
      score: row.score,
      schemaOrder: row.schemaOrder,
      isSchemaOnly: row.isSchemaOnly,
      isSchemaSupplemental: row.isSchemaSupplemental,
      count: row.count,
      percentage: row.percentage,
      totalCount,
      emptyCount,
      emptyPercentage,
      distinctValueCount,
      hiddenValueCount,
      statusCounts: combo.statusCounts || [],
      statusSummary
    });

    if (rows.length === 0) {
      return [toTableRow({
        unitId: combo.unitId,
        unitName: combo.unitName,
        variableId: combo.variableId,
        value: '',
        count: 0,
        percentage: 0,
        isSchemaOnly: true
      })];
    }

    return rows.map(toTableRow);
  }

  private sortRows(
    rows: VariableAnalysisTableRowDto[],
    paging: NormalizedVariableAnalysisPaging
  ): VariableAnalysisTableRowDto[] {
    return [...rows].sort((a, b) => this.compareRows(a, b, paging));
  }

  private compareRows(
    a: VariableAnalysisTableRowDto,
    b: VariableAnalysisTableRowDto,
    paging: NormalizedVariableAnalysisPaging
  ): number {
    return this.compareSortValues(
      this.getSortValue(a, paging.sortBy),
      this.getSortValue(b, paging.sortBy),
      paging.sortDirection
    ) || this.compareRowsByDefaultOrder(a, b);
  }

  private getSortValue(
    row: VariableAnalysisTableRowDto,
    sortBy: VariableAnalysisSortBy
  ): string | number | null | undefined {
    return row[sortBy];
  }

  private compareSortValues(
    a: string | number | null | undefined,
    b: string | number | null | undefined,
    direction: VariableAnalysisSortDirection
  ): number {
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return 1;
    }
    if (b === null || b === undefined) {
      return -1;
    }

    const result = this.compareDefinedRowValues(a, b);
    return direction === 'desc' ? -result : result;
  }

  private compareRowValues(
    a: string | number | null | undefined,
    b: string | number | null | undefined
  ): number {
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return 1;
    }
    if (b === null || b === undefined) {
      return -1;
    }
    return this.compareDefinedRowValues(a, b);
  }

  private compareDefinedRowValues(
    a: string | number,
    b: string | number
  ): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'de', {
      numeric: true,
      sensitivity: 'base'
    });
  }

  private compareRowsByDefaultOrder(
    a: VariableAnalysisTableRowDto,
    b: VariableAnalysisTableRowDto
  ): number {
    return (
      this.compareRowValues(a.unitName, b.unitName) ||
      this.compareRowValues(a.unitId, b.unitId) ||
      this.compareRowValues(a.variableId, b.variableId) ||
      this.compareRowValues(a.schemaOrder, b.schemaOrder) ||
      this.compareRowValues(a.value, b.value) ||
      this.compareRowValues(a.label, b.label)
    );
  }

  private getCombosForRows(
    combos: VariableCombo[],
    rows: VariableAnalysisTableRowDto[]
  ): VariableCombo[] {
    const comboByKey = new Map(
      combos.map(combo => [this.getComboKey(combo), combo])
    );
    const seenKeys = new Set<string>();
    const selectedCombos: VariableCombo[] = [];

    rows.forEach(row => {
      const comboKey = this.getComboKey(row);
      if (seenKeys.has(comboKey)) {
        return;
      }
      const combo = comboByKey.get(comboKey);
      if (combo) {
        selectedCombos.push(combo);
        seenKeys.add(comboKey);
      }
    });

    return selectedCombos;
  }

  private getFrequenciesForRows(
    rows: VariableAnalysisTableRowDto[]
  ): Record<string, VariableFrequencyDto[]> {
    const frequencies: Record<string, VariableFrequencyDto[]> = {};

    rows.forEach(row => {
      const comboKey = this.getComboKey(row);
      frequencies[comboKey] = frequencies[comboKey] || [];
      frequencies[comboKey].push({
        unitId: row.unitId,
        unitName: row.unitName,
        variableId: row.variableId,
        value: row.value,
        label: row.label,
        score: row.score,
        schemaOrder: row.schemaOrder,
        isSchemaOnly: row.isSchemaOnly,
        isSchemaSupplemental: row.isSchemaSupplemental,
        count: row.count,
        percentage: row.percentage
      });
    });

    return frequencies;
  }

  private getFilteredResultForExport(
    result: VariableAnalysisResultDto,
    filter: NormalizedVariableAnalysisFilter
  ): VariableAnalysisResultDto {
    const variableCombos = result.variableCombos.filter(combo => this.matchesFilter(combo, filter)
    );
    const selectedComboKeys = new Set(
      variableCombos.map(combo => this.getComboKey(combo))
    );
    const frequencies: Record<string, VariableFrequencyDto[]> = {};

    selectedComboKeys.forEach(comboKey => {
      frequencies[comboKey] = this.getVisibleFrequencyRows(
        result.frequencies[comboKey] || [],
        filter.includeSchemaCodes
      );
    });

    return {
      variableCombos,
      frequencies,
      total: variableCombos.length
    };
  }

  private createExportRows(
    result: VariableAnalysisResultDto
  ): VariableAnalysisExportRow[] {
    const rows: VariableAnalysisExportRow[] = [];

    result.variableCombos.forEach(combo => {
      const comboKey = this.getComboKey(combo);
      const frequencies = result.frequencies[comboKey] || [];
      const totalCount = combo.totalCount ?? this.sumCounts(frequencies);
      const emptyCount = combo.emptyCount ?? this.sumCounts(
        frequencies.filter(frequency => frequency.value === '')
      );
      const emptyPercentage = combo.emptyPercentage ??
        this.calculatePercentage(emptyCount, totalCount);
      const distinctValueCount =
        combo.distinctValueCount ?? frequencies.length;
      const displayedObservedValueCount = frequencies.filter(
        frequency => !frequency.isSchemaOnly
      ).length;
      const hiddenValueCount = Math.max(
        0,
        distinctValueCount - displayedObservedValueCount
      );
      const statusSummary = this.formatStatusSummary(combo.statusCounts || []);

      const visibleFrequencies: VariableFrequencyDto[] = frequencies.length > 0 ?
        frequencies :
        [{
          unitId: combo.unitId,
          unitName: combo.unitName,
          variableId: combo.variableId,
          value: '',
          count: 0,
          percentage: 0,
          isSchemaOnly: true
        }];

      visibleFrequencies.forEach(frequency => {
        rows.push({
          unitId: combo.unitId,
          unitName: combo.unitName,
          variableId: combo.variableId,
          value: frequency.value,
          label: frequency.label || '',
          isEmptyValue: frequency.value === '' ? 'ja' : 'nein',
          count: frequency.count,
          percentage: this.roundPercentage(frequency.percentage),
          totalCount,
          emptyCount,
          emptyPercentage: this.roundPercentage(emptyPercentage),
          distinctValueCount,
          hiddenValueCount,
          statusSummary
        });
      });
    });

    return rows;
  }

  private toCsvExportRow(
    row: VariableAnalysisExportRow
  ): Record<string, VariableAnalysisExportCell> {
    return VARIABLE_ANALYSIS_EXPORT_COLUMNS.reduce<
    Record<string, VariableAnalysisExportCell>
    >((csvRow, column) => {
      const value = row[column.key];
      csvRow[column.header] = typeof value === 'string' ?
        this.sanitizeCsvText(value) :
        value;
      return csvRow;
    }, {});
  }

  private sanitizeCsvText(value: string): string {
    const normalized = value.replace(/[\r\n\t]+/g, ' ');
    return /^\s*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  }

  private sumCounts(frequencies: VariableFrequencyDto[]): number {
    return frequencies.reduce((sum, frequency) => sum + frequency.count, 0);
  }

  private calculatePercentage(count: number, total: number): number {
    return total > 0 ? (count / total) * 100 : 0;
  }

  private roundPercentage(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private formatStatusSummary(
    statusCounts: Array<{ status: number; count: number; percentage: number }>
  ): string {
    return statusCounts.map(statusCount => `${this.getStatusLabel(statusCount.status)}: ${statusCount.count} (${this.roundPercentage(statusCount.percentage)}%)`).join(', ');
  }

  private getStatusLabel(status: number): string {
    return statusNumberToString(status) || status.toString();
  }

  private normalizePagingOptions(options: {
    page?: number | string;
    pageSize?: number | string;
    search?: string;
    onlyEmpty?: boolean | string;
    includeSchemaCodes?: boolean | string;
    sortBy?: string;
    sortDirection?: string;
  }): NormalizedVariableAnalysisPaging {
    const page = Math.max(
      this.DEFAULT_PAGE,
      Math.floor(Number(options.page) || this.DEFAULT_PAGE)
    );
    const requestedPageSize = Math.floor(
      Number(options.pageSize) || this.DEFAULT_PAGE_SIZE
    );
    const pageSize = Math.max(
      1,
      Math.min(requestedPageSize, this.MAX_PAGE_SIZE)
    );
    const search = (options.search || '').trim().toLowerCase();
    const onlyEmpty = this.normalizeBooleanOption(options.onlyEmpty);
    const includeSchemaCodes = this.normalizeBooleanOption(
      options.includeSchemaCodes
    );
    const sortBy = this.normalizeSortBy(options.sortBy);
    const sortDirection = this.normalizeSortDirection(options.sortDirection);

    return {
      page,
      pageSize,
      search,
      onlyEmpty,
      includeSchemaCodes,
      sortBy,
      sortDirection
    };
  }

  private normalizeSortBy(sortBy?: string): VariableAnalysisSortBy {
    return this.SORTABLE_FIELDS.has(sortBy as VariableAnalysisSortBy) ?
      sortBy as VariableAnalysisSortBy :
      this.DEFAULT_SORT_BY;
  }

  private normalizeSortDirection(
    sortDirection?: string
  ): VariableAnalysisSortDirection {
    return sortDirection === 'desc' || sortDirection === 'asc' ?
      sortDirection :
      this.DEFAULT_SORT_DIRECTION;
  }

  private normalizeFilterOptions(options: {
    search?: string;
    onlyEmpty?: boolean | string;
    includeSchemaCodes?: boolean | string;
  }): NormalizedVariableAnalysisFilter {
    return {
      search: (options.search || '').trim().toLowerCase(),
      onlyEmpty: this.normalizeBooleanOption(options.onlyEmpty),
      includeSchemaCodes: this.normalizeBooleanOption(
        options.includeSchemaCodes
      )
    };
  }

  private normalizeBooleanOption(value?: boolean | string): boolean {
    return value === true || value === 'true';
  }

  private matchesPagingFilter(
    combo: VariableCombo,
    paging: NormalizedVariableAnalysisPaging
  ): boolean {
    return this.matchesFilter(combo, paging);
  }

  private matchesFilter(
    combo: VariableCombo,
    filter: NormalizedVariableAnalysisFilter
  ): boolean {
    if (filter.search) {
      const unitName = combo.unitName.toLowerCase();
      const variableId = combo.variableId.toLowerCase();
      if (
        !unitName.includes(filter.search) &&
        !variableId.includes(filter.search)
      ) {
        return false;
      }
    }

    if (filter.onlyEmpty && (combo.emptyCount || 0) <= 0) {
      return false;
    }

    return true;
  }

  private getComboKey(combo: { unitId: number; variableId: string }): string {
    return `${combo.unitId}:${combo.variableId}`;
  }

  private withSchemaCodeVisibility(
    result: VariableAnalysisResultDto,
    includeSchemaCodes: boolean
  ): VariableAnalysisResultDto {
    const frequencies = Object.fromEntries(
      Object.entries(result.frequencies).map(([comboKey, rows]) => [
        comboKey,
        this.getVisibleFrequencyRows(rows, includeSchemaCodes)
      ])
    );

    return {
      ...result,
      frequencies
    };
  }

  private getVisibleFrequencyRows(
    rows: VariableFrequencyDto[],
    includeSchemaCodes: boolean
  ): VariableFrequencyDto[] {
    if (!includeSchemaCodes) {
      return rows.filter(row => !row.isSchemaSupplemental);
    }

    return [...rows].sort((a, b) => {
      const aHasSchemaOrder = Number.isFinite(a.schemaOrder);
      const bHasSchemaOrder = Number.isFinite(b.schemaOrder);

      if (aHasSchemaOrder && bHasSchemaOrder) {
        return (a.schemaOrder as number) - (b.schemaOrder as number);
      }

      if (aHasSchemaOrder !== bHasSchemaOrder) {
        return aHasSchemaOrder ? -1 : 1;
      }

      return 0;
    });
  }

  private async deleteCachedResult(
    dataCacheKey?: string,
    returnvalue?: unknown
  ): Promise<void> {
    const cacheKey = this.getResultCacheKey(returnvalue, dataCacheKey);
    if (cacheKey) {
      await this.deleteChunkedCachedResult(cacheKey);
      await this.cacheService.delete(cacheKey);
    }
  }

  private async deleteChunkedCachedResult(cacheKey: string): Promise<void> {
    const cachedValue =
      await this.cacheService.get<VariableAnalysisResultCacheManifest>(
        cacheKey
      );
    if (!this.isChunkedResultManifest(cachedValue)) {
      return;
    }

    await Promise.all([
      ...Array.from({ length: cachedValue.variableComboChunks }, (_, index) => this.cacheService.delete(this.getVariableComboChunkKey(cacheKey, index))
      ),
      ...Array.from({ length: cachedValue.frequencyChunks }, (_, index) => this.cacheService.delete(this.getFrequencyChunkKey(cacheKey, index))
      )
    ]);
  }

  private getVariableComboChunkKey(cacheKey: string, index: number): string {
    return `${cacheKey}:variable-combos:${index}`;
  }

  private getFrequencyChunkKey(cacheKey: string, index: number): string {
    return `${cacheKey}:frequencies:${index}`;
  }
}
