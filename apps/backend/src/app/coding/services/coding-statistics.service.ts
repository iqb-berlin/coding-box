import {
  Injectable, Logger, OnApplicationBootstrap
} from '@nestjs/common';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { CodingStatistics } from '../../common';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber } from '../../workspaces/utils/response-status-converter';

import { WorkspaceEventsService } from '../../workspaces/services/workspace-events.service';

@Injectable()
export class CodingStatisticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CodingStatisticsService.name);
  private readonly CACHE_KEY_PREFIX = 'coding-statistics';
  private readonly CACHE_TTL_SECONDS = 0; // No expiration (TTL=0 means no EX flag in Redis) - persist until explicitly invalidated

  constructor(
    private workspacesFacadeService: WorkspacesFacadeService,
    private cacheService: CacheService,
    private workspaceEventsService: WorkspaceEventsService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.workspaceEventsService.testFilesChanged$.subscribe(async workspaceId => {
      this.logger.log(`Received test files changed event for workspace ${workspaceId}`);
      await this.invalidateCache(workspaceId);
      await this.invalidateIncompleteVariablesCache(workspaceId);
    });

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
    return this.workspacesFacadeService.getWorkspaceIdsWithResponses(codedStatuses);
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

      const statusCountResults = await this.workspacesFacadeService.getResponseStatusCounts(
        workspace_id,
        codedStatuses,
        statusColumn,
        whereCondition,
        unitsWithVariables
      );

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
    const unitFiles = await this.workspacesFacadeService.findFilesByType(workspace_id, 'Unit');

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
      totalSharedResponses: number;
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
          totalSharedResponses: codes.length,
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
        totalSharedResponses: codes.length,
        validPairs: validCodes.length,
        interpretation
      });
    }

    return results;
  }
}
