import {
  Inject, Injectable, Logger, OnApplicationBootstrap, forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatistics } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from '../jobs/bull-job-management.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  normalizeExclusionBookletId,
  normalizeExclusionUnitId,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  CODING_STATISTICS_CACHE_VERSIONS,
  getCodingStatisticsCacheKey,
  type CodingStatisticsVersion
} from './coding-statistics-cache-key.util';
import { getEffectiveCodingStatusExpression } from '../../utils/effective-coding-status-expression.util';

@Injectable()
export class CodingStatisticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CodingStatisticsService.name);
  private readonly CACHE_TTL_SECONDS = 0; // No expiration (TTL=0 means no EX flag in Redis) - persist until explicitly invalidated

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService,
    private bullJobManagementService: BullJobManagementService,
    private workspaceCoreService: WorkspaceCoreService,
    private workspaceExclusionService: WorkspaceExclusionService,
    @Inject(forwardRef(() => WorkspaceFilesService))
    private workspaceFilesService: WorkspaceFilesService
  ) { }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Application bootstrap: Loading coding statistics for all workspaces...');
    try {
      const workspaceIds = await this.getWorkspaceIdsWithResponses();
      this.logger.log(`Found ${workspaceIds.length} workspaces with responses, preloading statistics...`);

      const preloadPromises = workspaceIds.map(workspaceId => this.getCodingStatistics(workspaceId).catch(error => {
        this.logger.error(`Failed to preload statistics for workspace ${workspaceId}: ${error.message}`);
      })
      );

      await Promise.allSettled(preloadPromises);
      this.logger.log('Finished preloading coding statistics for all workspaces');
    } catch (error) {
      this.logger.error(`Error during application bootstrap: ${error.message}`);
    }
  }

  private async getWorkspaceIdsWithResponses(): Promise<number[]> {
    const codedStatuses = [statusStringToNumber('NOT_REACHED') || 1, statusStringToNumber('DISPLAYED') || 2, statusStringToNumber('VALUE_CHANGED') || 3];
    const result = await this.responseRepository.query(`
      SELECT DISTINCT person.workspace_id
      FROM response
      INNER JOIN unit ON response.unitid = unit.id
      INNER JOIN booklet ON unit.bookletid = booklet.id
      INNER JOIN persons person ON booklet.personid = person.id
      WHERE response.status = ANY($1)
        AND person.consider = $2
    `, [codedStatuses, true]);

    return result.map(row => parseInt(row.workspace_id, 10)).filter(id => !Number.isNaN(id));
  }

  async getCodingStatistics(workspace_id: number, version: CodingStatisticsVersion = 'v1', skipCache: boolean = false): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id} (version: ${version})${skipCache ? ' (skipping cache)' : ''}`);

    const cacheKey = getCodingStatisticsCacheKey(workspace_id, version);
    if (!skipCache) {
      const cachedResult = await this.cacheService.get<CodingStatistics>(cacheKey);
      if (cachedResult) {
        this.logger.log(`Returning cached statistics for workspace ${workspace_id}`);
        return this.normalizeStatistics(cachedResult);
      }
    }

    const statistics: CodingStatistics = {
      totalResponses: 0,
      baseResponseCount: 0,
      derivedResponseCount: 0,
      derivedVariableCount: 0,
      derivedStatusCounts: {},
      statusCounts: {}
    };

    try {
      const [unitVariables, derivedVariables] = await Promise.all([
        this.getUnitVariables(workspace_id),
        this.getDerivedVariables(workspace_id)
      ]);

      const { globalIgnoredUnits, ignoredBooklets, testletIgnoredUnits } = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);
      const globalIgnoredSet = new Set(globalIgnoredUnits);

      const unitsWithVariables = Object.keys(unitVariables).filter(u => !globalIgnoredSet.has(u.toUpperCase()));
      const validVariablePairKeys = unitsWithVariables.flatMap(unitName => unitVariables[unitName].map(
        variableId => this.toVariablePairKey(unitName, variableId)
      ));
      const validVariablePairKeySet = new Set(validVariablePairKeys);
      const derivedVariablePairKeys = Object.entries(derivedVariables)
        .filter(([unitName]) => !globalIgnoredSet.has(unitName.toUpperCase()))
        .flatMap(([unitName, variableIds]) => variableIds.map(
          variableId => this.toVariablePairKey(unitName, variableId)
        ))
        .filter(pairKey => validVariablePairKeySet.has(pairKey));
      statistics.derivedVariableCount = derivedVariablePairKeys.length;

      if (validVariablePairKeys.length === 0) {
        this.logger.log(`No units with variables found for workspace ${workspace_id}`);
        await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
        return statistics;
      }

      this.logger.log(
        `Filtering coding statistics to ${validVariablePairKeys.length} unit-variable pairs ` +
        `from ${unitsWithVariables.length} units (${derivedVariablePairKeys.length} derived pairs)`
      );

      const codedStatuses = [statusStringToNumber('NOT_REACHED') || 1, statusStringToNumber('DISPLAYED') || 2, statusStringToNumber('VALUE_CHANGED') || 3];

      const statusColumn = getEffectiveCodingStatusExpression(version);
      let whereCondition = `(${statusColumn}) IS NOT NULL`;

      const variablePairExpression = "(unit.name || E'\\u001F' || response.variableid)";
      const derivedExpression = 'CASE WHEN response.is_autocoder_generated = TRUE THEN true ELSE false END';
      const normalizedUnitExpression = "REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i')";

      let paramIndex = 5;
      const queryParams: (number | string | number[] | string[] | boolean)[] = [
        codedStatuses,
        workspace_id,
        true,
        validVariablePairKeys
      ];

      if (globalIgnoredUnits.length > 0) {
        whereCondition += ` AND ${normalizedUnitExpression} != ALL($${paramIndex})`;
        queryParams.push(globalIgnoredUnits.map(normalizeExclusionUnitId));
        paramIndex += 1;
      }

      if (ignoredBooklets.length > 0) {
        whereCondition += ` AND UPPER(bookletinfo.name) != ALL($${paramIndex})`;
        queryParams.push(ignoredBooklets.map(normalizeExclusionBookletId));
        paramIndex += 1;
      }

      if (testletIgnoredUnits.length > 0) {
        const conditions = testletIgnoredUnits.map(t => {
          const condition = `NOT (UPPER(bookletinfo.name) = $${paramIndex} AND ${normalizedUnitExpression} = $${paramIndex + 1})`;
          queryParams.push(normalizeExclusionBookletId(t.bookletId), normalizeExclusionUnitId(t.unitId));
          paramIndex += 2;
          return condition;
        }).join(' AND ');
        whereCondition += ` AND (${conditions})`;
      }

      const statusCountResults = await this.responseRepository.query(`
        SELECT
          ${statusColumn} as "statusValue",
          ${derivedExpression} as "isDerived",
          COUNT(response.id) as count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN bookletinfo ON booklet.infoid = bookletinfo.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE response.status = ANY($1)
          AND ${whereCondition}
          AND person.workspace_id = $2
          AND person.consider = $3
          AND (
            ${variablePairExpression} = ANY($4::text[])
            OR response.is_autocoder_generated = TRUE
          )
        GROUP BY ${statusColumn}, ${derivedExpression}
      `, queryParams);

      let totalResponses = 0;
      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        const validCount = Number.isNaN(count) ? 0 : count;
        const statusValue = String(result.statusValue);
        statistics.statusCounts[statusValue] = (statistics.statusCounts[statusValue] || 0) + validCount;
        if (result.isDerived === true || result.isDerived === 'true') {
          statistics.derivedResponseCount += validCount;
          statistics.derivedStatusCounts[statusValue] = (statistics.derivedStatusCounts[statusValue] || 0) + validCount;
        } else {
          statistics.baseResponseCount += validCount;
        }
        totalResponses += validCount;
        this.logger.debug(`Coded status ${result.statusValue}: ${validCount} responses`);
      });

      statistics.totalResponses = totalResponses;

      this.logger.log(
        `Computed coding statistics for workspace ${workspace_id}: ${totalResponses} total coded responses ` +
        `(${statistics.baseResponseCount} base, ${statistics.derivedResponseCount} derived) ` +
        `from ${unitsWithVariables.length} units, ${Object.keys(statistics.statusCounts).length} different status types`
      );

      await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
      this.logger.log(`Computed and cached statistics for workspace ${workspace_id}`);

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }

  private async getUnitVariables(workspace_id: number): Promise<Record<string, string[]>> {
    const unitVariableMap = await this.workspaceFilesService.getUnitVariableMap(workspace_id);
    return this.mapToRecord(unitVariableMap);
  }

  private async getDerivedVariables(workspace_id: number): Promise<Record<string, string[]>> {
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspace_id);
    return this.mapToRecord(derivedVariableMap);
  }

  private mapToRecord(variableMap: Map<string, Set<string>>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    variableMap.forEach((variables, unitName) => {
      result[unitName] = Array.from(variables);
    });
    return result;
  }

  private toVariablePairKey(unitName: string, variableId: string): string {
    return `${unitName}\u001F${variableId}`;
  }

  private normalizeStatistics(statistics: CodingStatistics): CodingStatistics {
    return {
      totalResponses: statistics.totalResponses || 0,
      baseResponseCount: statistics.baseResponseCount || 0,
      derivedResponseCount: statistics.derivedResponseCount || 0,
      derivedVariableCount: statistics.derivedVariableCount || 0,
      derivedStatusCounts: statistics.derivedStatusCounts || {},
      statusCounts: statistics.statusCounts || {}
    };
  }

  async invalidateCache(workspace_id: number, version?: CodingStatisticsVersion): Promise<void> {
    if (version) {
      const cacheKey = getCodingStatisticsCacheKey(workspace_id, version);
      await this.cacheService.delete(cacheKey);
      this.logger.log(`Invalidated coding statistics cache for workspace ${workspace_id} (version: ${version})`);
    } else {
      const deletePromises = CODING_STATISTICS_CACHE_VERSIONS.map(v => {
        const cacheKey = getCodingStatisticsCacheKey(workspace_id, v);
        return this.cacheService.delete(cacheKey);
      });
      await Promise.all(deletePromises);
      this.logger.log(`Invalidated all coding statistics caches for workspace ${workspace_id}`);
    }
  }

  async invalidateIncompleteVariablesCache(workspace_id: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables_v3:${workspace_id}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated incomplete variables cache for workspace ${workspace_id}`);
  }

  async refreshStatistics(workspace_id: number, version: CodingStatisticsVersion = 'v1'): Promise<CodingStatistics> {
    this.logger.log(`Refreshing coding statistics for workspace ${workspace_id}`);
    return this.getCodingStatistics(workspace_id, version, true); // skipCache = true
  }

  async getJobStatus(
    jobId: string
  ): Promise<{
      status:
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'paused';
      progress: number;
      result?: CodingStatistics;
      error?: string;
    } | null> {
    try {
      let bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);

      if (!bullJob) {
        bullJob = (await this.jobQueueService.getCodingStatisticsJob(
          jobId
        )) as never;
      }

      if (bullJob) {
        const state = await bullJob.getState();
        const progress = (await bullJob.progress()) || 0;

        const status = this.bullJobManagementService.mapJobStateToStatus(state);
        const { result, error } =
          this.bullJobManagementService.extractJobResult(bullJob, state);

        return {
          status,
          progress: typeof progress === 'number' ? progress : 0,
          result: result as CodingStatistics,
          error
        };
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error getting job status: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  async getCodingStatisticsJobStatus(
    jobId: string
  ): Promise<{
      status:
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'paused';
      progress: number;
      result?: CodingStatistics;
      error?: string;
    } | null> {
    try {
      const bullJob = await this.jobQueueService.getCodingStatisticsJob(jobId);
      if (!bullJob) {
        return null;
      }

      const state = await bullJob.getState();
      const progress = (await bullJob.progress()) || 0;
      const status = this.bullJobManagementService.mapJobStateToStatus(state);
      const { result, error } =
        this.bullJobManagementService.extractJobResult(bullJob, state);

      return {
        status,
        progress: typeof progress === 'number' ? progress : 0,
        result: result as CodingStatistics,
        error
      };
    } catch (error) {
      this.logger.error(
        `Error getting coding statistics job status: ${error.message}`,
        error.stack
      );
      return null;
    }
  }

  async createCodingStatisticsJob(
    workspaceId: number,
    version: CodingStatisticsVersion = 'v1'
  ): Promise<{ jobId: string; message: string }> {
    try {
      const cacheKey = getCodingStatisticsCacheKey(workspaceId, version);
      const cachedResult = await this.cacheService.get<CodingStatistics>(
        cacheKey
      );
      if (cachedResult) {
        this.logger.log(
          `Cached coding statistics exist for workspace ${workspaceId} (version: ${version}), returning empty jobId to use cache`
        );
        return { jobId: '', message: 'Using cached coding statistics' };
      }
      // We don't delete the cache here because we just checked it. If it was there, we returned.
      // If it's not there, we don't need to delete it.
      // However, the original code deleted it. Let's keep deleting it just in case of race conditions or partial writes?
      // Actually, if we are starting a job, we should probably clear any stale cache just to be sure.
      await this.cacheService.delete(cacheKey);

      await this.jobQueueService.assertNoDependencyConflicts('coding-statistics', workspaceId);

      this.logger.log(
        `No cached coding statistics for workspace ${workspaceId} (version: ${version}), creating job to recalculate`
      );

      const job = await this.jobQueueService.addCodingStatisticsJob(
        workspaceId,
        version
      );
      this.logger.log(
        `Created coding statistics job ${job.id} for workspace ${workspaceId}`
      );
      return {
        jobId: job.id.toString(),
        message: 'Created coding statistics job - no cache available'
      };
    } catch (error) {
      this.logger.error(
        `Error creating coding statistics job: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  async cancelJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const state = await bullJob.getState();
      if (state === 'completed' || state === 'failed') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${state}`
        };
      }

      if (state === 'active') {
        return {
          success: false,
          message: `Job with ID ${jobId} is currently being processed and cannot be cancelled. Please wait for it to complete or use pause instead.`
        };
      }

      const result = await this.jobQueueService.cancelTestPersonCodingJob(
        jobId
      );
      if (result) {
        this.logger.log(`Job ${jobId} has been cancelled successfully`);
        return {
          success: true,
          message: `Job ${jobId} has been cancelled successfully`
        };
      }
      return { success: false, message: `Failed to cancel job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error cancelling job: ${error.message}`
      };
    }
  }

  async deleteJob(
    jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const bullJob = await this.jobQueueService.getTestPersonCodingJob(jobId);
      if (!bullJob) {
        return { success: false, message: `Job with ID ${jobId} not found` };
      }

      const result = await this.jobQueueService.deleteTestPersonCodingJob(
        jobId
      );
      if (result) {
        this.logger.log(`Job ${jobId} has been deleted successfully`);
        return {
          success: true,
          message: `Job ${jobId} has been deleted successfully`
        };
      }
      return { success: false, message: `Failed to delete job ${jobId}` };
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error deleting job: ${error.message}`
      };
    }
  }

  /**
   * Calculate Cohen's Kappa for inter-rater agreement between coders
   * @param coderPairs Array of coder pairs with their coding data
   * @param level Calculation level: 'code' for code-level kappa, 'score' for score-level kappa
   * @returns Cohen's Kappa coefficient and related statistics
   */
  calculateCohensKappa(
    coderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      unitName?: string;
      variableId?: string;
      codes: Array<{ code1: number | null; code2: number | null }>;
      scores?: Array<{ score1: number | null; score2: number | null }>;
    }>,
    level: 'code' | 'score' = 'code'
  ): Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      unitName?: string;
      variableId?: string;
      kappa: number;
      agreement: number;
      totalItems: number;
      validPairs: number;
      interpretation: string;
    }> {
    const results = [];

    for (const pair of coderPairs) {
      // Select data based on calculation level
      const dataToUse = level === 'score' && pair.scores ?
        pair.scores.map(s => ({ code1: s.score1, code2: s.score2 })) :
        pair.codes;

      // Filter out pairs where either coder has null value
      const validCodes = dataToUse.filter(c => c.code1 !== null && c.code2 !== null);

      if (validCodes.length === 0) {
        results.push({
          coder1Id: pair.coder1Id,
          coder1Name: pair.coder1Name,
          coder2Id: pair.coder2Id,
          coder2Name: pair.coder2Name,
          unitName: pair.unitName,
          variableId: pair.variableId,
          kappa: null,
          agreement: 0,
          totalItems: dataToUse.length,
          validPairs: 0,
          interpretation: 'No valid coding pairs'
        });
        continue;
      }

      // Create confusion matrix
      const codeSet = new Set<number>();
      validCodes.forEach(c => {
        codeSet.add(c.code1!);
        codeSet.add(c.code2!);
      });
      const uniqueCodesArr = Array.from(codeSet).sort((a, b) => a - b);

      const matrix: number[][] = [];
      for (let i = 0; i < uniqueCodesArr.length; i++) {
        matrix[i] = new Array(uniqueCodesArr.length).fill(0);
      }

      // Fill confusion matrix
      validCodes.forEach(c => {
        const rowIndex = uniqueCodesArr.indexOf(c.code1!);
        const colIndex = uniqueCodesArr.indexOf(c.code2!);
        matrix[rowIndex][colIndex] += 1;
      });

      // Calculate observed agreement (Po)
      let observedAgreement = 0;
      for (let i = 0; i < uniqueCodesArr.length; i++) {
        observedAgreement += matrix[i][i];
      }
      observedAgreement /= validCodes.length;

      // Calculate expected agreement by chance (Pe)
      let expectedAgreement = 0;
      const rowTotals = matrix.map(row => row.reduce((sum, val) => sum + val, 0));
      const colTotals = matrix[0].map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0)
      );

      for (let i = 0; i < uniqueCodesArr.length; i++) {
        expectedAgreement += (rowTotals[i] * colTotals[i]) / (validCodes.length * validCodes.length);
      }

      // Calculate Cohen's Kappa
      // Reference: R eatPrep meanKappa function
      // https://github.com/sachseka/eatPrep/blob/8dc0b54748c095508c20fde07843e61b73a42141/R/rater_functions.R#L98
      // R implementation sets kappa = 1 when coders agree perfectly:
      // if(is.na(kap[["value"]])) { if(identical(dat.ij[,1],dat.ij[,2])) { kap[["value"]] <- 1 } }
      let kappa: number;
      if (observedAgreement === 1) {
        // Perfect observed agreement - coders agree on all items
        kappa = 1;
      } else if (expectedAgreement === 1) {
        // Perfect expected agreement
        kappa = 1;
      } else {
        // Standard Cohen's Kappa formula: κ = (Po - Pe) / (1 - Pe)
        kappa = (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
      }

      // Handle edge cases (fallback for NaN/Infinite values)
      if (Number.isNaN(kappa) || !Number.isFinite(kappa)) {
        kappa = 0;
      }

      // Interpret Kappa value
      let interpretation: string;
      if (kappa < 0) {
        interpretation = 'kappa.poor';
      } else if (kappa < 0.2) {
        interpretation = 'kappa.slight';
      } else if (kappa < 0.4) {
        interpretation = 'kappa.fair';
      } else if (kappa < 0.6) {
        interpretation = 'kappa.moderate';
      } else if (kappa < 0.81) {
        interpretation = 'kappa.substantial';
      } else if (kappa <= 0.95) {
        interpretation = 'kappa.good';
      } else {
        interpretation = 'kappa.almost_perfect';
      }

      results.push({
        coder1Id: pair.coder1Id,
        coder1Name: pair.coder1Name,
        coder2Id: pair.coder2Id,
        coder2Name: pair.coder2Name,
        unitName: pair.unitName,
        variableId: pair.variableId,
        kappa: Math.round(kappa * 1000) / 1000, // Round to 3 decimal places
        agreement: Math.round(observedAgreement * 1000) / 1000,
        totalItems: dataToUse.length,
        validPairs: validCodes.length,
        interpretation
      });
    }

    return results;
  }
}
