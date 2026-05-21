import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import {
  ResponseAnalysisDto,
  EmptyResponseDto,
  DuplicateValueGroupDto,
  EmptyResponseAnalysisDto,
  DuplicateValueAnalysisDto
} from '../../../../../../../api-dto/coding/response-analysis.dto';
import {
  CodingJobService,
  ResponseMatchingFlag
} from './coding-job.service';
import { CodingValidationService } from './coding-validation.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CacheService } from '../../../cache/cache.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { createAggregationSummary } from './aggregation-metrics.util';

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
  private readonly CACHE_KEY_PREFIX = 'response-analysis';

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
  ) { }

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
  ): Promise<ResponseAnalysisDto & { isCalculating?: boolean; progress?: number }> {
    try {
      const requestedThreshold = this.normalizeThreshold(threshold);
      this.logger.log(
        `Getting response analysis for workspace ${workspaceId} with threshold ${requestedThreshold}`
      );

      const matchingFlags = await this.codingJobService.getResponseMatchingMode(
        workspaceId
      );

      // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
      const effectiveThreshold = matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
        2 :
        requestedThreshold;

      // Check cache for the FULL analysis for this threshold
      const cacheKey = this.getCacheKey(workspaceId, matchingFlags, effectiveThreshold);
      const fullAnalysis = await this.cacheService.get<ResponseAnalysisDto>(cacheKey);

      // Check if a job is currently running
      const activeJob = await this.jobQueueService.getActiveCodingAnalysisJob(workspaceId);
      const isCalculating = !!activeJob;
      let progress = 0;
      if (activeJob) {
        progress = await activeJob.progress();
      }

      if (fullAnalysis && !fullAnalysis.aggregationSummary) {
        await this.invalidateCache(workspaceId);
        if (!isCalculating) {
          await this.startAnalysis(workspaceId, matchingFlags, effectiveThreshold);
        }
        return {
          ...this.createEmptyAnalysisResult(matchingFlags, effectiveThreshold),
          isCalculating: true,
          progress
        };
      }

      if (!fullAnalysis) {
        if (!isCalculating) {
          // If no analysis and no job running, trigger one (or return empty with isCalculating=false and let frontend trigger)
          // For better UX, let's trigger it automatically if missing
          await this.startAnalysis(workspaceId, matchingFlags, effectiveThreshold);
          return {
            ...this.createEmptyAnalysisResult(matchingFlags, effectiveThreshold),
            isCalculating: true,
            progress
          };
        }
        return {
          ...this.createEmptyAnalysisResult(matchingFlags, effectiveThreshold),
          isCalculating: true,
          progress
        };
      }

      // Slice the results for pagination
      const emptyStart = (emptyPage - 1) * emptyLimit;
      const emptyItems = fullAnalysis.emptyResponses.items.slice(
        emptyStart,
        emptyStart + emptyLimit
      );

      const duplicateStart = (duplicatePage - 1) * duplicateLimit;
      const duplicateGroups = fullAnalysis.duplicateValues.groups.slice(
        duplicateStart,
        duplicateStart + duplicateLimit
      );

      return {
        ...fullAnalysis,
        emptyResponses: {
          ...fullAnalysis.emptyResponses,
          items: emptyItems,
          page: emptyPage,
          pageSize: emptyLimit
        } as EmptyResponseAnalysisDto,
        duplicateValues: {
          ...fullAnalysis.duplicateValues,
          groups: duplicateGroups,
          page: duplicatePage,
          pageSize: duplicateLimit
        } as DuplicateValueAnalysisDto,
        isCalculating,
        progress
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing responses for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to analyze responses: ${error.message}`);
    }
  }

  async startAnalysis(
    workspaceId: number,
    matchingFlags?: ResponseMatchingFlag[],
    threshold?: number
  ): Promise<void> {
    const activeMatchingFlags = matchingFlags ||
      await this.codingJobService.getResponseMatchingMode(workspaceId);
    const savedThreshold = threshold === undefined ?
      await this.codingJobService.getAggregationThreshold(workspaceId) :
      threshold;
    const activeThreshold = this.normalizeThreshold(savedThreshold ?? 2);

    // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
    const effectiveThreshold = activeMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION) ?
      2 :
      activeThreshold;

    const cacheKey = this.getCacheKey(workspaceId, activeMatchingFlags, effectiveThreshold);

    // Check if job already running
    const activeJob = await this.jobQueueService.getActiveCodingAnalysisJob(workspaceId);
    if (activeJob) {
      this.logger.log(`Analysis job already running for workspace ${workspaceId} (Job ID: ${activeJob.id})`);
      return;
    }

    await this.jobQueueService.addCodingAnalysisJob({
      workspaceId,
      matchingFlags: activeMatchingFlags as unknown as string[],
      threshold: effectiveThreshold,
      cacheKey
    });
    this.logger.log(`Triggered background response analysis for workspace ${workspaceId}`);
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

  async getAggregationSettings(workspaceId: number): Promise<AggregationSettingsResult> {
    const [threshold, flags] = await Promise.all([
      this.codingJobService.getAggregationThreshold(workspaceId),
      this.codingJobService.getResponseMatchingMode(workspaceId)
    ]);
    const normalizedThreshold = this.normalizeThreshold(threshold ?? 2);
    const normalizedFlags = this.codingJobService.normalizeResponseMatchingFlags(flags);

    return {
      success: true,
      threshold: normalizedThreshold,
      flags: normalizedFlags,
      aggregationActive: !normalizedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
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
    const currentFlags = flags ?? await this.codingJobService.getResponseMatchingMode(workspaceId);
    const normalizedFlags = this.codingJobService.normalizeResponseMatchingFlags(currentFlags);

    try {
      await this.codingJobService.setAggregationThreshold(workspaceId, validThreshold);
      const savedFlags = await this.codingJobService.setResponseMatchingMode(workspaceId, normalizedFlags);
      const revertedCount = await this.revertMaterializedDuplicateAggregation(workspaceId);
      await this.invalidateAggregationDependentCaches(workspaceId);

      return {
        success: true,
        threshold: validThreshold,
        flags: savedFlags,
        aggregationActive: !savedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
        revertedResponses: revertedCount,
        message: revertedCount > 0 ?
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
        aggregationActive: !normalizedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
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
    const currentFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
    const nextFlags = aggregateMode ?
      currentFlags.filter(flag => flag !== ResponseMatchingFlag.NO_AGGREGATION) :
      [ResponseMatchingFlag.NO_AGGREGATION];
    const result = await this.saveAggregationSettings(workspaceId, threshold, nextFlags);

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
    threshold: number | null = null
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
      analysisTimestamp: new Date().toISOString()
    };

    return result;
  }

  /**
   * Invalidates all cached analysis results for a given workspace
   */
  async invalidateCache(workspaceId: number): Promise<void> {
    this.logger.log(`Invalidating response analysis cache for workspace ${workspaceId}`);
    // "response-analysis:1_*" matches all variations (flags, thresholds) for workspace 1
    const pattern = `${this.CACHE_KEY_PREFIX}:${workspaceId}_*`;
    await this.cacheService.deleteByPattern(pattern);
  }

  private async invalidateAggregationDependentCaches(workspaceId: number): Promise<void> {
    await this.invalidateCache(workspaceId);
    await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
    await this.codingStatisticsService.invalidateCache(workspaceId);
  }

  private getCacheKey(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number
  ): string {
    return `${this.CACHE_KEY_PREFIX}:${workspaceId}_${[...matchingFlags].sort().join(',')}_t${threshold}`;
  }

  private normalizeThreshold(threshold: number | null | undefined): number {
    const parsed = Number(threshold);
    if (!Number.isFinite(parsed)) {
      return 2;
    }
    return Math.min(100, Math.max(2, Math.round(parsed)));
  }

  private async revertMaterializedDuplicateAggregation(workspaceId: number): Promise<number> {
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
