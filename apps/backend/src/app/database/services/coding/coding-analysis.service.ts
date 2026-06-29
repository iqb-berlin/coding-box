import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import { CodingJobService, ResponseMatchingFlag } from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CacheService } from '../../../cache/cache.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { createAggregationSummary } from './aggregation-metrics.util';
import {
  CODING_ANALYSIS_CACHE_KEY_PREFIX,
  getCodingAnalysisCacheKey,
  getCodingAnalysisRunMarkerKey
} from './coding-analysis-cache-key.util';
import {
  createDuplicateValuePageCache,
  createEmptyResponsePageCache,
  createDuplicateValuePageCacheFromChunks,
  createDuplicateValueChunkCaches,
  createEmptyResponseChunkCaches,
  createEmptyResponsePageCacheFromChunks,
  createResponseAnalysisFromCachedParts,
  createResponseAnalysisSummaryCache,
  DuplicateValueChunkCache,
  DuplicateValuePageCache,
  EmptyResponseChunkCache,
  EmptyResponsePageCache,
  getRequiredResponseAnalysisChunkIndexes,
  getResponseAnalysisDuplicateChunkCacheKey,
  getResponseAnalysisDerivedCachePattern,
  getResponseAnalysisDuplicatePageCacheKey,
  getResponseAnalysisEmptyChunkCacheKey,
  getResponseAnalysisEmptyPageCacheKey,
  getResponseAnalysisSummaryCacheKey,
  ResponseAnalysisSummaryCache
} from './response-analysis-page-cache.util';

export interface AggregationSettingsResult {
  success: boolean;
  threshold: number;
  flags: ResponseMatchingFlag[];
  aggregationActive: boolean;
  revertedResponses: number;
  message: string;
}

@Injectable()
export class CodingAnalysisService {
  private readonly logger = new Logger(CodingAnalysisService.name);
  private readonly slowResponseAnalysisThresholdMs = 3000;

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    private codingJobService: CodingJobService,
    private codingValidationService: CodingValidationService,
    private codingStatisticsService: CodingStatisticsService,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService
  ) {}

  /**
   * Analyzes responses for a workspace to identify:
   * 1. Empty responses (null or empty string values)
   * 2. Duplicate values (same normalized value across different testperson/variable combinations)
   *
   * Uses the response matching settings (ignore case, ignore whitespace) for normalization.
   */
  async getResponseAnalysis(
    workspaceId: number,
    threshold = 2,
    emptyPage = 1,
    emptyLimit = 50,
    duplicatePage = 1,
    duplicateLimit = 50
  ): Promise<
    ResponseAnalysisDto & { isCalculating?: boolean; progress?: number }
    > {
    const startedAt = Date.now();
    let timingStatus = 'failed';
    try {
      const requestedThreshold = this.normalizeThreshold(threshold);
      this.logger.log(
        `Getting response analysis for workspace ${workspaceId} with threshold ${requestedThreshold}`
      );

      const [matchingFlags, currentSourceRevision] = await Promise.all([
        this.codingJobService.getResponseMatchingMode(workspaceId),
        this.getWorkspaceResultsRevision(workspaceId)
      ]);

      // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
      const effectiveThreshold = matchingFlags.includes(
        ResponseMatchingFlag.NO_AGGREGATION
      ) ?
        2 :
        requestedThreshold;

      // Check cache for the FULL analysis for this threshold
      const cacheKey = this.getCacheKey(
        workspaceId,
        matchingFlags,
        effectiveThreshold
      );
      const summaryCache =
        await this.cacheService.get<ResponseAnalysisSummaryCache>(
          getResponseAnalysisSummaryCacheKey(cacheKey)
        );

      // Check if a job is currently running
      const activeJob =
        await this.jobQueueService.getActiveCodingAnalysisJob(workspaceId);
      const isCalculating = !!activeJob;
      let progress = 0;
      if (activeJob) {
        progress = await activeJob.progress();
      }

      const chunkedPageCaches = summaryCache ?
        await this.getResponseAnalysisPageCachesFromChunks(
          cacheKey,
          emptyPage,
          emptyLimit,
          duplicatePage,
          duplicateLimit,
          summaryCache
        ) :
        null;

      if (
        summaryCache &&
        chunkedPageCaches?.emptyPageCache &&
        chunkedPageCaches?.duplicatePageCache
      ) {
        const analysisIsStale = this.isAnalysisSourceRevisionStale(
          summaryCache,
          currentSourceRevision
        );
        if (analysisIsStale && !isCalculating) {
          await this.startAnalysis(
            workspaceId,
            matchingFlags,
            effectiveThreshold,
            {
              sourceRevision: currentSourceRevision
            }
          );
        }
        timingStatus = analysisIsStale ? 'stale-chunk-cache' : 'chunk-cache-hit';
        return createResponseAnalysisFromCachedParts(
          summaryCache,
          chunkedPageCaches.emptyPageCache,
          chunkedPageCaches.duplicatePageCache,
          currentSourceRevision,
          isCalculating || analysisIsStale,
          progress
        );
      }

      const [emptyPageCache, duplicatePageCache] = summaryCache ?
        await Promise.all([
          this.cacheService.get<EmptyResponsePageCache>(
            getResponseAnalysisEmptyPageCacheKey(
              cacheKey,
              emptyPage,
              emptyLimit
            )
          ),
          this.cacheService.get<DuplicateValuePageCache>(
            getResponseAnalysisDuplicatePageCacheKey(
              cacheKey,
              duplicatePage,
              duplicateLimit
            )
          )
        ]) :
        [null, null];

      if (summaryCache && emptyPageCache && duplicatePageCache) {
        const analysisIsStale = this.isAnalysisSourceRevisionStale(
          summaryCache,
          currentSourceRevision
        );
        if (analysisIsStale && !isCalculating) {
          await this.startAnalysis(
            workspaceId,
            matchingFlags,
            effectiveThreshold,
            {
              sourceRevision: currentSourceRevision
            }
          );
        }
        timingStatus = analysisIsStale ? 'stale-page-cache' : 'page-cache-hit';
        return createResponseAnalysisFromCachedParts(
          summaryCache,
          emptyPageCache,
          duplicatePageCache,
          currentSourceRevision,
          isCalculating || analysisIsStale,
          progress
        );
      }

      const fullAnalysis =
        await this.cacheService.get<ResponseAnalysisDto>(cacheKey);

      if (fullAnalysis && !fullAnalysis.aggregationSummary) {
        await this.invalidateCache(workspaceId);
        if (!isCalculating) {
          await this.startAnalysis(
            workspaceId,
            matchingFlags,
            effectiveThreshold,
            {
              sourceRevision: currentSourceRevision
            }
          );
        }
        timingStatus = 'legacy-cache-missing-summary';
        return {
          ...this.createEmptyAnalysisResult(
            matchingFlags,
            effectiveThreshold,
            currentSourceRevision
          ),
          isCalculating: true,
          progress
        };
      }

      if (!fullAnalysis) {
        if (!isCalculating) {
          // If no analysis and no job running, trigger one (or return empty with isCalculating=false and let frontend trigger)
          // For better UX, let's trigger it automatically if missing
          await this.startAnalysis(
            workspaceId,
            matchingFlags,
            effectiveThreshold,
            {
              sourceRevision: currentSourceRevision
            }
          );
          timingStatus = 'cache-miss-started';
          return {
            ...this.createEmptyAnalysisResult(
              matchingFlags,
              effectiveThreshold,
              currentSourceRevision
            ),
            isCalculating: true,
            progress
          };
        }
        timingStatus = 'cache-miss-existing-job';
        return {
          ...this.createEmptyAnalysisResult(
            matchingFlags,
            effectiveThreshold,
            currentSourceRevision
          ),
          isCalculating: true,
          progress
        };
      }

      const analysisIsStale = this.isAnalysisSourceRevisionStale(
        fullAnalysis,
        currentSourceRevision
      );
      if (analysisIsStale && !isCalculating) {
        await this.startAnalysis(
          workspaceId,
          matchingFlags,
          effectiveThreshold,
          {
            sourceRevision: currentSourceRevision
          }
        );
      }
      timingStatus = analysisIsStale ? 'stale-cache' : 'cache-hit';
      await this.writeResponseAnalysisDerivedCaches(
        cacheKey,
        fullAnalysis,
        emptyPage,
        emptyLimit,
        duplicatePage,
        duplicateLimit
      );

      return createResponseAnalysisFromCachedParts(
        createResponseAnalysisSummaryCache(fullAnalysis),
        createEmptyResponsePageCache(fullAnalysis, emptyPage, emptyLimit),
        createDuplicateValuePageCache(
          fullAnalysis,
          duplicatePage,
          duplicateLimit
        ),
        currentSourceRevision,
        isCalculating || analysisIsStale,
        progress
      );
    } catch (error) {
      this.logger.error(
        `Error analyzing responses for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to analyze responses: ${error.message}`);
    } finally {
      this.logResponseAnalysisTiming(
        'getResponseAnalysis',
        workspaceId,
        startedAt,
        timingStatus
      );
    }
  }

  async startAnalysis(
    workspaceId: number,
    matchingFlags?: ResponseMatchingFlag[],
    threshold?: number,
    options: { forceRefresh?: boolean; sourceRevision?: number } = {}
  ): Promise<void> {
    const activeMatchingFlags =
      matchingFlags ||
      (await this.codingJobService.getResponseMatchingMode(workspaceId));
    const savedThreshold =
      threshold === undefined ?
        await this.codingJobService.getAggregationThreshold(workspaceId) :
        threshold;
    const activeThreshold = this.normalizeThreshold(savedThreshold ?? 2);

    // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
    const effectiveThreshold = activeMatchingFlags.includes(
      ResponseMatchingFlag.NO_AGGREGATION
    ) ?
      2 :
      activeThreshold;

    const cacheKey = this.getCacheKey(
      workspaceId,
      activeMatchingFlags,
      effectiveThreshold
    );
    const sourceRevision =
      options.sourceRevision ??
      (await this.getWorkspaceResultsRevision(workspaceId));

    if (options.forceRefresh) {
      await Promise.all([
        this.cacheService.delete(cacheKey),
        this.cacheService.deleteByPattern(
          getResponseAnalysisDerivedCachePattern(cacheKey)
        )
      ]);
      this.logger.log(
        `Invalidated response analysis cache before restart for workspace ${workspaceId}`
      );
    }

    const reusableJob =
      await this.jobQueueService.getCodingAnalysisJobForCacheKey(
        workspaceId,
        cacheKey
      );
    if (reusableJob && !options.forceRefresh) {
      this.logger.log(
        `Reusing queued response analysis for workspace ${workspaceId} (Job ID: ${reusableJob.id})`
      );
      return;
    }

    // Check if another analysis for this workspace is already running.
    const activeJob =
      await this.jobQueueService.getActiveCodingAnalysisJob(workspaceId);
    if (activeJob && !options.forceRefresh) {
      this.logger.log(
        `Analysis job already running for workspace ${workspaceId} (Job ID: ${activeJob.id})`
      );
      return;
    }

    if (activeJob && options.forceRefresh) {
      this.logger.log(
        `Superseding active response analysis job for workspace ${workspaceId} (Job ID: ${activeJob.id})`
      );
    }

    const runId = randomUUID();
    await this.cacheService.set(
      getCodingAnalysisRunMarkerKey(cacheKey),
      runId,
      0
    );

    await this.jobQueueService.addCodingAnalysisJob({
      workspaceId,
      matchingFlags: activeMatchingFlags as unknown as string[],
      threshold: effectiveThreshold,
      cacheKey,
      runId,
      sourceRevision
    });
    this.logger.log(
      `Triggered background response analysis for workspace ${workspaceId}`
    );
  }

  private logResponseAnalysisTiming(
    operation: string,
    workspaceId: number,
    startedAt: number,
    status: string
  ): void {
    const durationMs = Date.now() - startedAt;
    const message = `${operation} for workspace ${workspaceId} finished in ${durationMs}ms (${status})`;
    if (durationMs >= this.slowResponseAnalysisThresholdMs) {
      this.logger.warn(message);
      return;
    }
    this.logger.debug(message);
  }

  private analyzeBatch(
    responses: ResponseEntity[],
    matchingFlags: ResponseMatchingFlag[],
    threshold: number,
    emptyResponses: EmptyResponseDto[],
    duplicateValueGroups: DuplicateValueGroupDto[]
  ) {
    // We group by Unit+Variable within this batch
    // Since our query chunked by Unit+Variable, we can treat this batch as a collection of complete groups

    // Group responses by unit+variable
    const responsesByUnitVariable = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      const value = response.value;
      const isEmptyValue =
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '') ||
        value === '[]';

      if (isEmptyValue) {
        if (response.status_v2 === null) {
          emptyResponses.push({
            unitName: response.unit?.name || '',
            unitAlias: response.unit?.alias || null,
            variableId: response.variableid,
            personLogin: response.unit?.booklet?.person?.login || '',
            personCode: response.unit?.booklet?.person?.code || '',
            personGroup: response.unit?.booklet?.person?.group || '',
            bookletName: response.unit?.booklet?.bookletinfo?.name || 'Unknown',
            responseId: response.id,
            value: response.value
          });
        }
        continue; // Skip empty for duplicates
      }

      // Prepare for Duplicate Check
      // Key needs to be unique per variable definition
      const key = `${response.unit?.name || response.unitid}_${response.variableid}`;
      if (!responsesByUnitVariable.has(key)) {
        responsesByUnitVariable.set(key, []);
      }
      responsesByUnitVariable.get(key)!.push(response);
    }

    // Duplicate Analysis for the batch
    for (const [, groupResponses] of responsesByUnitVariable.entries()) {
      if (groupResponses.length < threshold) continue;

      const valueGroups = new Map<string, ResponseEntity[]>();
      for (const response of groupResponses) {
        const normalizedValue = this.codingJobService.normalizeValue(
          response.value,
          matchingFlags
        );
        if (!valueGroups.has(normalizedValue)) {
          valueGroups.set(normalizedValue, []);
        }
        valueGroups.get(normalizedValue)!.push(response);
      }

      for (const [normalizedValue, valGroup] of valueGroups.entries()) {
        if (valGroup.length < threshold) continue;

        const first = valGroup[0];
        duplicateValueGroups.push({
          unitName: first.unit?.name || '',
          unitAlias: first.unit?.alias || null,
          variableId: first.variableid,
          normalizedValue,
          originalValue: first.value || '',
          occurrences: valGroup.map(r => ({
            personLogin: r.unit?.booklet?.person?.login || 'Unknown',
            personCode: r.unit?.booklet?.person?.code || '',
            bookletName: r.unit?.booklet?.bookletinfo?.name || 'Unknown',
            responseId: r.id,
            value: r.value || ''
          }))
        });
      }
    }
  }

  async getAggregationSettings(
    workspaceId: number
  ): Promise<AggregationSettingsResult> {
    const [threshold, flags] = await Promise.all([
      this.codingJobService.getAggregationThreshold(workspaceId),
      this.codingJobService.getResponseMatchingMode(workspaceId)
    ]);
    const normalizedThreshold = this.normalizeThreshold(threshold ?? 2);
    const normalizedFlags =
      this.codingJobService.normalizeResponseMatchingFlags(flags);

    return {
      success: true,
      threshold: normalizedThreshold,
      flags: normalizedFlags,
      aggregationActive: !normalizedFlags.includes(
        ResponseMatchingFlag.NO_AGGREGATION
      ),
      revertedResponses: 0,
      message: 'Aggregation settings loaded.'
    };
  }

  async saveAggregationSettings(
    workspaceId: number,
    threshold: number,
    flags?: ResponseMatchingFlag[]
  ): Promise<AggregationSettingsResult> {
    const validThreshold = this.normalizeThreshold(threshold);
    const currentFlags =
      flags ??
      (await this.codingJobService.getResponseMatchingMode(workspaceId));
    const normalizedFlags =
      this.codingJobService.normalizeResponseMatchingFlags(currentFlags);

    try {
      await this.codingJobService.setAggregationThreshold(
        workspaceId,
        validThreshold
      );
      const savedFlags = await this.codingJobService.setResponseMatchingMode(
        workspaceId,
        normalizedFlags
      );
      const revertedCount =
        await this.revertMaterializedDuplicateAggregation(workspaceId);
      await this.invalidateAggregationDependentCaches(workspaceId);

      return {
        success: true,
        threshold: validThreshold,
        flags: savedFlags,
        aggregationActive: !savedFlags.includes(
          ResponseMatchingFlag.NO_AGGREGATION
        ),
        revertedResponses: revertedCount,
        message:
          revertedCount > 0 ?
            `Aggregation settings saved. Reverted ${revertedCount} materialized duplicate responses.` :
            'Aggregation settings saved.'
      };
    } catch (error) {
      this.logger.error(
        `Error saving aggregation settings: ${error.message}`,
        error.stack
      );

      return {
        success: false,
        threshold: validThreshold,
        flags: normalizedFlags,
        aggregationActive: !normalizedFlags.includes(
          ResponseMatchingFlag.NO_AGGREGATION
        ),
        revertedResponses: 0,
        message: `Error saving aggregation settings: ${error.message}`
      };
    }
  }

  /**
   * Backwards-compatible wrapper for older clients. Aggregation is now represented
   * by settings and metrics instead of materialized response rows.
   */
  async applyDuplicateAggregation(
    workspaceId: number,
    threshold: number,
    aggregateMode: boolean
  ): Promise<{
      success: boolean;
      aggregatedGroups: number;
      aggregatedResponses: number;
      uniqueCodingCases: number;
      message: string;
    }> {
    const currentFlags =
      await this.codingJobService.getResponseMatchingMode(workspaceId);
    const nextFlags = aggregateMode ?
      currentFlags.filter(
        flag => flag !== ResponseMatchingFlag.NO_AGGREGATION
      ) :
      [ResponseMatchingFlag.NO_AGGREGATION];
    const result = await this.saveAggregationSettings(
      workspaceId,
      threshold,
      nextFlags
    );

    return {
      success: result.success,
      aggregatedGroups: 0,
      aggregatedResponses: result.revertedResponses,
      uniqueCodingCases: 0,
      message: result.message
    };
  }

  private createEmptyAnalysisResult(
    matchingFlags: ResponseMatchingFlag[],
    threshold: number | null = null,
    sourceRevision?: number
  ): ResponseAnalysisDto {
    const result: ResponseAnalysisDto = {
      emptyResponses: {
        total: 0,
        totalUncoded: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: createAggregationSummary(
        0,
        0,
        0,
        threshold,
        matchingFlags
      ),
      matchingFlags: matchingFlags as unknown as string[],
      analysisTimestamp: new Date().toISOString(),
      sourceRevision,
      currentSourceRevision: sourceRevision
    };

    return result;
  }

  private isAnalysisSourceRevisionStale(
    analysis: Pick<ResponseAnalysisDto, 'sourceRevision'>,
    currentSourceRevision: number
  ): boolean {
    return (
      analysis.sourceRevision !== undefined &&
      analysis.sourceRevision !== currentSourceRevision
    );
  }

  private async getWorkspaceResultsRevision(
    workspaceId: number
  ): Promise<number> {
    try {
      const rows = (await this.responseRepository.query(
        'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
        [workspaceId]
      )) as Array<{ revision: number | string }>;
      return Number(rows[0]?.revision || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve test result revision for response analysis: ${message}`
      );
      return 0;
    }
  }

  /**
   * Invalidates all cached analysis results for a given workspace
   */
  async invalidateCache(workspaceId: number): Promise<void> {
    this.logger.log(
      `Invalidating response analysis cache for workspace ${workspaceId}`
    );
    // "response-analysis:1_*" matches all variations (flags, thresholds) for workspace 1
    const pattern = `${CODING_ANALYSIS_CACHE_KEY_PREFIX}:${workspaceId}_*`;
    await this.cacheService.deleteByPattern(pattern);
  }

  private async invalidateAggregationDependentCaches(
    workspaceId: number
  ): Promise<void> {
    await this.invalidateCache(workspaceId);
    await this.codingValidationService.invalidateIncompleteVariablesCache(
      workspaceId
    );
    await this.codingStatisticsService.invalidateCache(workspaceId);
  }

  private async writeResponseAnalysisDerivedCaches(
    cacheKey: string,
    analysis: ResponseAnalysisDto,
    emptyPage: number,
    emptyLimit: number,
    duplicatePage: number,
    duplicateLimit: number
  ): Promise<void> {
    const writes: Promise<boolean>[] = [
      this.cacheService.set(
        getResponseAnalysisSummaryCacheKey(cacheKey),
        createResponseAnalysisSummaryCache(analysis)
      ),
      this.cacheService.set(
        getResponseAnalysisEmptyPageCacheKey(cacheKey, emptyPage, emptyLimit),
        createEmptyResponsePageCache(analysis, emptyPage, emptyLimit)
      ),
      this.cacheService.set(
        getResponseAnalysisDuplicatePageCacheKey(
          cacheKey,
          duplicatePage,
          duplicateLimit
        ),
        createDuplicateValuePageCache(analysis, duplicatePage, duplicateLimit)
      )
    ];

    for (const chunk of createEmptyResponseChunkCaches(analysis)) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisEmptyChunkCacheKey(cacheKey, chunk.chunkIndex),
          chunk
        )
      );
    }

    for (const chunk of createDuplicateValueChunkCaches(analysis)) {
      writes.push(
        this.cacheService.set(
          getResponseAnalysisDuplicateChunkCacheKey(cacheKey, chunk.chunkIndex),
          chunk
        )
      );
    }

    await Promise.all(writes);
  }

  private async getResponseAnalysisPageCachesFromChunks(
    cacheKey: string,
    emptyPage: number,
    emptyLimit: number,
    duplicatePage: number,
    duplicateLimit: number,
    summaryCache: ResponseAnalysisSummaryCache
  ): Promise<{
      emptyPageCache: EmptyResponsePageCache | null;
      duplicatePageCache: DuplicateValuePageCache | null;
    }> {
    const emptyOutOfRangePageCache =
      this.createOutOfRangeEmptyResponsePageCache(
        summaryCache.emptyResponses.total,
        emptyPage,
        emptyLimit
      );
    const duplicateOutOfRangePageCache =
      this.createOutOfRangeDuplicateValuePageCache(
        summaryCache.duplicateValues.total,
        duplicatePage,
        duplicateLimit
      );
    const emptyChunkIndexes = emptyOutOfRangePageCache ?
      [] :
      getRequiredResponseAnalysisChunkIndexes(emptyPage, emptyLimit);
    const duplicateChunkIndexes = duplicateOutOfRangePageCache ?
      [] :
      getRequiredResponseAnalysisChunkIndexes(duplicatePage, duplicateLimit);
    const emptyChunkReads: Promise<EmptyResponseChunkCache | null>[] = [];
    for (const chunkIndex of emptyChunkIndexes) {
      emptyChunkReads.push(
        this.cacheService.get<EmptyResponseChunkCache>(
          getResponseAnalysisEmptyChunkCacheKey(cacheKey, chunkIndex)
        )
      );
    }

    const duplicateChunkReads: Promise<DuplicateValueChunkCache | null>[] = [];
    for (const chunkIndex of duplicateChunkIndexes) {
      duplicateChunkReads.push(
        this.cacheService.get<DuplicateValueChunkCache>(
          getResponseAnalysisDuplicateChunkCacheKey(cacheKey, chunkIndex)
        )
      );
    }

    const [emptyChunks, duplicateChunks] = await Promise.all([
      Promise.all(emptyChunkReads),
      Promise.all(duplicateChunkReads)
    ]);

    if (
      emptyChunks.some(chunk => chunk === null) ||
      duplicateChunks.some(chunk => chunk === null)
    ) {
      return {
        emptyPageCache: null,
        duplicatePageCache: null
      };
    }

    return {
      emptyPageCache:
        emptyOutOfRangePageCache ??
        createEmptyResponsePageCacheFromChunks(
          emptyChunks as EmptyResponseChunkCache[],
          emptyPage,
          emptyLimit
        ),
      duplicatePageCache:
        duplicateOutOfRangePageCache ??
        createDuplicateValuePageCacheFromChunks(
          duplicateChunks as DuplicateValueChunkCache[],
          duplicatePage,
          duplicateLimit
        )
    };
  }

  private createOutOfRangeEmptyResponsePageCache(
    total: number,
    page: number,
    pageSize: number
  ): EmptyResponsePageCache | null {
    return (page - 1) * pageSize >= total ?
      { items: [], page, pageSize } :
      null;
  }

  private createOutOfRangeDuplicateValuePageCache(
    total: number,
    page: number,
    pageSize: number
  ): DuplicateValuePageCache | null {
    return (page - 1) * pageSize >= total ?
      { groups: [], page, pageSize } :
      null;
  }

  private getCacheKey(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number
  ): string {
    return getCodingAnalysisCacheKey(workspaceId, matchingFlags, threshold);
  }

  private normalizeThreshold(threshold: number | null | undefined): number {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(parsed)));
  }

  private async revertMaterializedDuplicateAggregation(
    workspaceId: number
  ): Promise<number> {
    const aggregatedResponses = await this.responseRepository
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
      .getRawMany();

    const responseIds = aggregatedResponses
      .map(r => Number(r.id))
      .filter(id => Number.isFinite(id));

    if (responseIds.length === 0) {
      return 0;
    }

    const chunkSize = 1000;
    for (let i = 0; i < responseIds.length; i += chunkSize) {
      const chunk = responseIds.slice(i, i + chunkSize);
      await this.responseRepository.update(
        { id: In(chunk) },
        {
          code_v2: null,
          score_v2: null,
          status_v2: null
        }
      );
    }

    return responseIds.length;
  }
}
