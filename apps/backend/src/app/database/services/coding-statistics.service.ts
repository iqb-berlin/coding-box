import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import FileUpload from '../entities/file_upload.entity';
import { CodingStatistics } from './shared-types';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber } from '../utils/response-status-converter';

@Injectable()
export class CodingStatisticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CodingStatisticsService.name);
  private readonly CACHE_KEY_PREFIX = 'coding-statistics';
  private readonly CACHE_TTL_SECONDS = 0; // No expiration (TTL=0 means no EX flag in Redis) - persist until explicitly invalidated

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Application bootstrap: Loading coding statistics for all workspaces...');
    try {
      const workspaceIds = await this.getWorkspaceIdsWithResponses();
      this.logger.log(`Found ${workspaceIds.length} workspaces with responses, preloading statistics...`);

      const preloadPromises = workspaceIds.map(workspaceId => this.getCodingStatistics(workspaceId, true).catch(error => {
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
    const result = await this.responseRepository.query(`
      SELECT DISTINCT person.workspace_id
      FROM response
      INNER JOIN unit ON response.unitid = unit.id
      INNER JOIN booklet ON unit.bookletid = booklet.id
      INNER JOIN persons person ON booklet.personid = person.id
      WHERE response.status = $1
        AND person.consider = $2
    `, [statusStringToNumber('VALUE_CHANGED') || 3, true]);

    return result.map(row => parseInt(row.workspace_id, 10)).filter(id => !Number.isNaN(id));
  }

  async getCodingStatistics(workspace_id: number, skipCache: boolean = false): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}${skipCache ? ' (skipping cache)' : ''}`);

    const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}`;
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

      const valuedChangedStatus = statusStringToNumber('VALUE_CHANGED') || 3;
      const statusCountResults = await this.responseRepository.query(`
        SELECT
          response.status_v1 as "statusValue",
          COUNT(response.id) as count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE response.status = $1
          AND response.status_v1 IS NOT NULL
          AND person.workspace_id = $2
          AND person.consider = $3
          AND unit.name = ANY($4)
        GROUP BY response.status_v1
      `, [valuedChangedStatus, workspace_id, true, unitsWithVariables]);

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

  async invalidateCache(workspace_id: number): Promise<void> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated coding statistics cache for workspace ${workspace_id}`);
  }

  async invalidateIncompleteVariablesCache(workspace_id: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables:${workspace_id}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated incomplete variables cache for workspace ${workspace_id}`);
  }

  async refreshStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Refreshing coding statistics for workspace ${workspace_id}`);
    return this.getCodingStatistics(workspace_id, true); // skipCache = true
  }
}
