import { Injectable, Logger } from '@nestjs/common';
// Rebuild trigger
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
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
      this.logger.log(
        `Getting response analysis for workspace ${workspaceId} with threshold ${threshold}`
      );

      const matchingFlags = await this.codingJobService.getResponseMatchingMode(
        workspaceId
      );

      // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
      const effectiveThreshold = matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION) ? 2 : threshold;

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

      if (!fullAnalysis) {
        if (!isCalculating) {
          // If no analysis and no job running, trigger one (or return empty with isCalculating=false and let frontend trigger)
          // For better UX, let's trigger it automatically if missing
          await this.startAnalysis(workspaceId, matchingFlags, effectiveThreshold);
          return {
            ...this.createEmptyAnalysisResult(matchingFlags),
            isCalculating: true,
            progress
          };
        }
        return {
          ...this.createEmptyAnalysisResult(matchingFlags),
          isCalculating: true,
          progress
        };
      }

      // Slice the results for pagination
      const emptyStart = (emptyPage - 1) * emptyLimit;
      const emptyItems = fullAnalysis.emptyResponses.items.slice(emptyStart, emptyStart + emptyLimit);

      const duplicateStart = (duplicatePage - 1) * duplicateLimit;
      const duplicateGroups = fullAnalysis.duplicateValues.groups.slice(duplicateStart, duplicateStart + duplicateLimit);

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
    if (!matchingFlags) {
      matchingFlags = await this.codingJobService.getResponseMatchingMode(workspaceId);
    }
    if (!threshold) {
      // Default or fetch
      threshold = 2; // Simplification, ideally fetch from settings if needed or use default
    }
    // If NO_AGGREGATION is set, we want to see all duplicates regardless of the requested threshold
    const effectiveThreshold = matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION) ? 2 : threshold;

    const cacheKey = this.getCacheKey(workspaceId, matchingFlags, effectiveThreshold);

    // Check if job already running
    const activeJob = await this.jobQueueService.getActiveCodingAnalysisJob(workspaceId);
    if (activeJob) {
      this.logger.log(`Analysis job already running for workspace ${workspaceId} (Job ID: ${activeJob.id})`);
      return;
    }

    await this.jobQueueService.addCodingAnalysisJob({
      workspaceId,
      matchingFlags: matchingFlags as unknown as string[],
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

  /**
   * Apply aggregation to duplicate responses based on threshold
   * For each duplicate group meeting the threshold, one response is kept as the "master"
   * and others are marked by setting their status_v2 to CODING_COMPLETE with a special code
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
    this.logger.log(
      `Applying duplicate aggregation for workspace ${workspaceId} with threshold ${threshold}, mode: ${aggregateMode}`
    );

    if (!aggregateMode) {
      // Revert aggregation: Reset all responses with code_v2 = -99 to NULL
      this.logger.log(`Reverting duplicate aggregation for workspace ${workspaceId}`);

      // Invalidate existing cache before operation
      this.invalidateCache(workspaceId);

      // Better approach for safe update across relations:
      // 1. Find IDs of aggregated responses in workspace
      // 2. Update by IDs

      const aggregatedResponses = await this.responseRepository
        .createQueryBuilder('response')
        .select('response.id', 'id')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('response.code_v2 = :aggregatedCode', { aggregatedCode: -111 })
        .getRawMany();

      if (aggregatedResponses.length === 0) {
        return {
          success: true,
          aggregatedGroups: 0,
          aggregatedResponses: 0,
          uniqueCodingCases: 0,
          message: 'Aggregation deactivated. No aggregated responses found to revert.'
        };
      }

      const responseIds = aggregatedResponses.map(r => r.id);

      // Perform update in chunks
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

      // Invalidate cache
      await this.invalidateCache(workspaceId);
      await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
      await this.codingStatisticsService.invalidateCache(workspaceId);

      return {
        success: true,
        aggregatedGroups: 0, // Not relevant for revert
        aggregatedResponses: responseIds.length,
        uniqueCodingCases: 0, // Client will reload stats
        message: `Aggregation deactivated. Reverted ${responseIds.length} aggregated responses.`
      };
    }

    if (threshold < 2) {
      return {
        success: false,
        aggregatedGroups: 0,
        aggregatedResponses: 0,
        uniqueCodingCases: 0,
        message: 'Threshold must be at least 2'
      };
    }

    try {
      // Get the current response analysis
      const analysis = await this.getResponseAnalysis(workspaceId);

      // Filter groups that meet the threshold
      const groupsToAggregate = analysis.duplicateValues.groups.filter(
        group => group.occurrences.length >= threshold
      );

      if (groupsToAggregate.length === 0) {
        return {
          success: true,
          aggregatedGroups: 0,
          aggregatedResponses: 0,
          uniqueCodingCases: analysis.duplicateValues.totalResponses,
          message: `No duplicate groups meet the threshold of ${threshold}`
        };
      }

      this.logger.log(
        `Found ${groupsToAggregate.length} duplicate groups meeting threshold ${threshold}`
      );

      // Start transaction
      const queryRunner = this.responseRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction('READ COMMITTED');

      try {
        let totalAggregatedResponses = 0;

        // For each group, keep the first response as master and mark others as aggregated
        for (const group of groupsToAggregate) {
          // Sort occurrences by responseId to ensure consistent master selection
          const sortedOccurrences = [...group.occurrences].sort(
            (a, b) => a.responseId - b.responseId
          );

          // First response is the master, rest are aggregated
          const masterResponseId = sortedOccurrences[0].responseId;
          const responsesToAggregate = sortedOccurrences.slice(1);

          this.logger.log(
            `Group ${group.unitName}/${group.variableId}/${group.normalizedValue}: ` +
            `Master: ${masterResponseId}, Aggregating: ${responsesToAggregate.length} responses`
          );

          // Update aggregated responses
          // Use code_v2 = -99 to indicate this is an aggregated duplicate
          // Use status_v2 = CODING_COMPLETE to mark it as processed
          const updatePromises = responsesToAggregate.map(occurrence => queryRunner.manager.update(
            ResponseEntity,
            occurrence.responseId,
            {
              code_v2: -111, // Special code for aggregated duplicates
              score_v2: 0,
              status_v2: statusStringToNumber('CODING_COMPLETE')
            }
          )
          );

          await Promise.all(updatePromises);
          totalAggregatedResponses += responsesToAggregate.length;
        }

        await queryRunner.commitTransaction();

        // Save threshold as workspace setting
        await this.codingJobService.setAggregationThreshold(workspaceId, threshold);

        // Invalidate cache since data changed
        this.invalidateCache(workspaceId);

        // Calculate unique coding cases after aggregation
        const uniqueCodingCases = analysis.duplicateValues.totalResponses - totalAggregatedResponses;

        this.logger.log(
          `Successfully aggregated ${totalAggregatedResponses} responses in ${groupsToAggregate.length} groups`
        );

        // Invalidate the cache for incomplete variables so UI reflects the aggregation immediately
        await this.codingValidationService.invalidateIncompleteVariablesCache(workspaceId);
        await this.codingStatisticsService.invalidateCache(workspaceId);

        return {
          success: true,
          aggregatedGroups: groupsToAggregate.length,
          aggregatedResponses: totalAggregatedResponses,
          uniqueCodingCases,
          message: `Successfully aggregated ${totalAggregatedResponses} responses in ${groupsToAggregate.length} groups`
        };
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(
          `Error aggregating duplicate responses: ${error.message}`,
          error.stack
        );
        throw new Error(
          `Failed to aggregate duplicate responses: ${error.message}`
        );
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      this.logger.error(
        `Error in applyDuplicateAggregation: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        aggregatedGroups: 0,
        aggregatedResponses: 0,
        uniqueCodingCases: 0,
        message: `Error: ${error.message}`
      };
    }
  }

  private createEmptyAnalysisResult(
    matchingFlags: ResponseMatchingFlag[]
  ): ResponseAnalysisDto {
    const result: ResponseAnalysisDto = {
      emptyResponses: {
        total: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: !matchingFlags.includes(
          ResponseMatchingFlag.NO_AGGREGATION
        )
      },
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

  private getCacheKey(
    workspaceId: number,
    matchingFlags: ResponseMatchingFlag[],
    threshold: number
  ): string {
    return `${this.CACHE_KEY_PREFIX}:${workspaceId}_${[...matchingFlags].sort().join(',')}_t${threshold}`;
  }
}
