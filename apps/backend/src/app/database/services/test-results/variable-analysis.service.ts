import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  VariableAnalysisResultDto,
  VariableCombo
} from '../../../admin/variable-analysis/dto/variable-analysis-result.dto';
import { VariableAnalysisResultPageDto } from '../../../admin/variable-analysis/dto/variable-analysis-result-page.dto';
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
}

@Injectable()
export class VariableAnalysisService {
  private readonly logger = new Logger(VariableAnalysisService.name);
  private readonly RESULT_CACHE_KEY_PREFIX = 'variable-analysis';
  private readonly DEFAULT_PAGE = 1;
  private readonly DEFAULT_PAGE_SIZE = 50;
  private readonly MAX_PAGE_SIZE = 200;

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
    workspaceId?: number
  ): Promise<VariableAnalysisResultDto> {
    const job = await this.getCompletedAnalysisJob(jobId, workspaceId);

    const cacheKey = this.getResultCacheKey(job.returnvalue, job.data.cacheKey);

    if (cacheKey) {
      const cachedResult = await this.getCachedResult(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }

      throw new Error(`Job with ID ${jobId} has no cached results`);
    }

    if (!this.isVariableAnalysisResult(job.returnvalue)) {
      throw new Error(`Job with ID ${jobId} has no results`);
    }

    return job.returnvalue as VariableAnalysisResultDto;
  }

  async getAnalysisResultsPage(
    jobId: number | string,
    workspaceId?: number,
    options: {
      page?: number | string;
      pageSize?: number | string;
      search?: string;
      onlyEmpty?: boolean | string;
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

  private async getChunkedResultPage(
    cacheKey: string,
    manifest: VariableAnalysisResultCacheManifest,
    paging: NormalizedVariableAnalysisPaging
  ): Promise<VariableAnalysisResultPageDto | null> {
    const startIndex = (paging.page - 1) * paging.pageSize;
    const endIndex = startIndex + paging.pageSize;
    const variableCombos: VariableCombo[] = [];
    let matchedCount = 0;

    for (let index = 0; index < manifest.variableComboChunks; index += 1) {
      const chunk = await this.cacheService.get<VariableCombo[]>(
        this.getVariableComboChunkKey(cacheKey, index)
      );
      if (!chunk) {
        return null;
      }

      for (const combo of chunk) {
        if (!this.matchesPagingFilter(combo, paging)) {
          continue;
        }

        if (matchedCount >= startIndex && matchedCount < endIndex) {
          variableCombos.push(combo);
        }
        matchedCount += 1;
      }
    }

    const selectedComboKeys = new Set(
      variableCombos.map(combo => this.getComboKey(combo))
    );
    const frequencies = await this.getFrequenciesForCombos(
      cacheKey,
      manifest,
      selectedComboKeys
    );
    if (!frequencies) {
      return null;
    }

    return {
      variableCombos,
      frequencies,
      total: matchedCount,
      unfilteredTotal: manifest.total,
      page: paging.page,
      pageSize: paging.pageSize,
      totalPages: Math.ceil(matchedCount / paging.pageSize)
    };
  }

  private async getFrequenciesForCombos(
    cacheKey: string,
    manifest: VariableAnalysisResultCacheManifest,
    selectedComboKeys: Set<string>
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
          frequencies[key] = values;
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
    const startIndex = (paging.page - 1) * paging.pageSize;
    const variableCombos = filteredCombos.slice(
      startIndex,
      startIndex + paging.pageSize
    );
    const selectedComboKeys = new Set(
      variableCombos.map(combo => this.getComboKey(combo))
    );
    const frequencies: Record<string, VariableFrequencyDto[]> = {};

    selectedComboKeys.forEach(comboKey => {
      frequencies[comboKey] = result.frequencies[comboKey] || [];
    });

    return {
      variableCombos,
      frequencies,
      total: filteredCombos.length,
      unfilteredTotal: result.total,
      page: paging.page,
      pageSize: paging.pageSize,
      totalPages: Math.ceil(filteredCombos.length / paging.pageSize)
    };
  }

  private normalizePagingOptions(options: {
    page?: number | string;
    pageSize?: number | string;
    search?: string;
    onlyEmpty?: boolean | string;
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
    const onlyEmpty =
      options.onlyEmpty === true || options.onlyEmpty === 'true';

    return {
      page,
      pageSize,
      search,
      onlyEmpty
    };
  }

  private matchesPagingFilter(
    combo: VariableCombo,
    paging: NormalizedVariableAnalysisPaging
  ): boolean {
    if (paging.search) {
      const unitName = combo.unitName.toLowerCase();
      const variableId = combo.variableId.toLowerCase();
      if (
        !unitName.includes(paging.search) &&
        !variableId.includes(paging.search)
      ) {
        return false;
      }
    }

    if (paging.onlyEmpty && (combo.emptyCount || 0) <= 0) {
      return false;
    }

    return true;
  }

  private getComboKey(combo: { unitId: number; variableId: string }): string {
    return `${combo.unitId}:${combo.variableId}`;
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
