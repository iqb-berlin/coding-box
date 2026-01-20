import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import FileUpload from '../../entities/file_upload.entity';
import { CodingStatistics } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { BullJobManagementService } from '../jobs/bull-job-management.service';

@Injectable()
export class CodingStatisticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CodingStatisticsService.name);
  private readonly CACHE_KEY_PREFIX = 'coding-statistics';
  private readonly CACHE_TTL_SECONDS = 0; // No expiration (TTL=0 means no EX flag in Redis) - persist until explicitly invalidated

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService,
    private jobQueueService: JobQueueService,
    private bullJobManagementService: BullJobManagementService
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

  async getCodingStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1', skipCache: boolean = false): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id} (version: ${version})${skipCache ? ' (skipping cache)' : ''}`);

    const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}:${version}`;
    if (!skipCache) {
      const cachedResult = await this.cacheService.get<CodingStatistics>(cacheKey);
      if (cachedResult) {
        this.logger.log(`Returning cached statistics for workspace ${workspace_id}`);
        return cachedResult;
      }
    }

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const unitVariables = await this.getUnitVariables(workspace_id);
      const unitsWithVariables = Object.keys(unitVariables);

      if (unitsWithVariables.length === 0) {
        this.logger.log(`No units with variables found for workspace ${workspace_id}`);
        await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
        return statistics;
      }

      this.logger.log(`Filtering coding statistics to ${unitsWithVariables.length} units that have defined variables`);

      const codedStatuses = [statusStringToNumber('NOT_REACHED') || 1, statusStringToNumber('DISPLAYED') || 2, statusStringToNumber('VALUE_CHANGED') || 3];

      let statusColumn = 'response.status_v1';
      let whereCondition = 'response.status_v1 IS NOT NULL';

      if (version === 'v2') {
        statusColumn = 'COALESCE(response.status_v2, response.status_v1)';
        whereCondition = '(COALESCE(response.status_v2, response.status_v1)) IS NOT NULL';
      } else if (version === 'v3') {
        statusColumn = 'COALESCE(response.status_v3, response.status_v2, response.status_v1)';
        whereCondition = '(COALESCE(response.status_v3, response.status_v2, response.status_v1)) IS NOT NULL';
      }

      const statusCountResults = await this.responseRepository.query(`
        SELECT
          ${statusColumn} as "statusValue",
          COUNT(response.id) as count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE response.status = ANY($1)
          AND ${whereCondition}
          AND person.workspace_id = $2
          AND person.consider = $3
          AND unit.name = ANY($4)
        GROUP BY ${statusColumn}
      `, [codedStatuses, workspace_id, true, unitsWithVariables]);

      let totalResponses = 0;
      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        const validCount = Number.isNaN(count) ? 0 : count;
        statistics.statusCounts[result.statusValue] = validCount;
        totalResponses += validCount;
        this.logger.debug(`Coded status ${result.statusValue}: ${validCount} responses`);
      });

      statistics.totalResponses = totalResponses;

      this.logger.log(`Computed coding statistics for workspace ${workspace_id}: ${totalResponses} total coded responses from ${unitsWithVariables.length} units, ${Object.keys(statistics.statusCounts).length} different status types`);

      await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
      this.logger.log(`Computed and cached statistics for workspace ${workspace_id}`);

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }

  private async getUnitVariables(workspace_id: number): Promise<Record<string, string[]>> {
    const fileUploadRepository = this.responseRepository.manager.getRepository(FileUpload);
    const unitFiles = await fileUploadRepository.find({
      where: { workspace_id, file_type: 'Unit' }
    });

    const unitVariables: Record<string, string[]> = {};

    for (const unitFile of unitFiles) {
      try {
        const parseStringPromise = (await import('xml2js')).parseStringPromise;
        const parsedXml = await parseStringPromise(unitFile.data.toString(), { explicitArray: false });

        if (parsedXml.Unit && parsedXml.Unit.Metadata && parsedXml.Unit.Metadata.Id) {
          const unitName = parsedXml.Unit.Metadata.Id;
          const variables: string[] = [];

          if (parsedXml.Unit.BaseVariables && parsedXml.Unit.BaseVariables.Variable) {
            const baseVariables = Array.isArray(parsedXml.Unit.BaseVariables.Variable) ?
              parsedXml.Unit.BaseVariables.Variable :
              [parsedXml.Unit.BaseVariables.Variable];

            for (const variable of baseVariables) {
              if (variable.$?.alias && variable.$?.type !== 'no-value') {
                variables.push(variable.$.alias);
              }
            }
          }

          if (variables.length > 0) {
            unitVariables[unitName] = variables;
          }
        }
      } catch (error) {
        this.logger.warn(`Error parsing unit file ${unitFile.file_id}: ${error.message}`);
      }
    }

    return unitVariables;
  }

  async invalidateCache(workspace_id: number, version?: 'v1' | 'v2' | 'v3'): Promise<void> {
    if (version) {
      const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}:${version}`;
      await this.cacheService.delete(cacheKey);
      this.logger.log(`Invalidated coding statistics cache for workspace ${workspace_id} (version: ${version})`);
    } else {
      // Invalidate all versions
      const versions: ('v1' | 'v2' | 'v3')[] = ['v1', 'v2', 'v3'];
      const deletePromises = versions.map(v => {
        const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}:${v}`;
        return this.cacheService.delete(cacheKey);
      });
      await Promise.all(deletePromises);
      this.logger.log(`Invalidated all coding statistics caches for workspace ${workspace_id}`);
    }
  }

  async invalidateIncompleteVariablesCache(workspace_id: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables:${workspace_id}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated incomplete variables cache for workspace ${workspace_id}`);
  }

  async refreshStatistics(workspace_id: number, version: 'v1' | 'v2' | 'v3' = 'v1'): Promise<CodingStatistics> {
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

  async createCodingStatisticsJob(
    workspaceId: number
  ): Promise<{ jobId: string; message: string }> {
    try {
      const cacheKey = `coding-statistics:${workspaceId}`;
      const cachedResult = await this.cacheService.get<CodingStatistics>(
        cacheKey
      );
      if (cachedResult) {
        this.logger.log(
          `Cached coding statistics exist for workspace ${workspaceId}, returning empty jobId to use cache`
        );
        return { jobId: '', message: 'Using cached coding statistics' };
      }
      await this.cacheService.delete(cacheKey); // Clear any stale cache
      this.logger.log(
        `No cached coding statistics for workspace ${workspaceId}, creating job to recalculate`
      );

      const job = await this.jobQueueService.addCodingStatisticsJob(
        workspaceId
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
   * @returns Cohen's Kappa coefficient and related statistics
   */
  calculateCohensKappa(coderPairs: Array<{
    coder1Id: number;
    coder1Name: string;
    coder2Id: number;
    coder2Name: string;
    codes: Array<{ code1: number | null; code2: number | null }>;
  }>): Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      kappa: number;
      agreement: number;
      totalItems: number;
      validPairs: number;
      interpretation: string;
    }> {
    const results = [];

    for (const pair of coderPairs) {
      const { codes } = pair;

      // Filter out pairs where either coder has null code
      const validCodes = codes.filter(c => c.code1 !== null && c.code2 !== null);

      if (validCodes.length === 0) {
        results.push({
          coder1Id: pair.coder1Id,
          coder1Name: pair.coder1Name,
          coder2Id: pair.coder2Id,
          coder2Name: pair.coder2Name,
          kappa: null,
          agreement: 0,
          totalItems: codes.length,
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
      const uniqueCodes = Array.from(codeSet).sort();

      const matrix: number[][] = [];
      for (let i = 0; i < uniqueCodes.length; i++) {
        matrix[i] = new Array(uniqueCodes.length).fill(0);
      }

      // Fill confusion matrix
      validCodes.forEach(c => {
        const rowIndex = uniqueCodes.indexOf(c.code1!);
        const colIndex = uniqueCodes.indexOf(c.code2!);
        matrix[rowIndex][colIndex] += 1;
      });

      // Calculate observed agreement (Po)
      let observedAgreement = 0;
      for (let i = 0; i < uniqueCodes.length; i++) {
        observedAgreement += matrix[i][i];
      }
      observedAgreement /= validCodes.length;

      // Calculate expected agreement by chance (Pe)
      let expectedAgreement = 0;
      const rowTotals = matrix.map(row => row.reduce((sum, val) => sum + val, 0));
      const colTotals = matrix[0].map((_, colIndex) => matrix.reduce((sum, row) => sum + row[colIndex], 0)
      );

      for (let i = 0; i < uniqueCodes.length; i++) {
        expectedAgreement += (rowTotals[i] * colTotals[i]) / (validCodes.length * validCodes.length);
      }

      // Calculate Cohen's Kappa
      let kappa: number;
      if (expectedAgreement === 1) {
        kappa = 1; // Perfect expected agreement
      } else {
        kappa = (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
      }

      // Handle edge cases
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
      } else if (kappa < 0.8) {
        interpretation = 'kappa.substantial';
      } else {
        interpretation = 'kappa.almost_perfect';
      }

      results.push({
        coder1Id: pair.coder1Id,
        coder1Name: pair.coder1Name,
        coder2Id: pair.coder2Id,
        coder2Name: pair.coder2Name,
        kappa: Math.round(kappa * 1000) / 1000, // Round to 3 decimal places
        agreement: Math.round(observedAgreement * 1000) / 1000,
        totalItems: codes.length,
        validPairs: validCodes.length,
        interpretation
      });
    }

    return results;
  }
}
