import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import { CodingStatistics } from './shared-types';
import { CacheService } from '../../cache/cache.service';

@Injectable()
export class CodingStatisticsService {
  private readonly logger = new Logger(CodingStatisticsService.name);
  private readonly CACHE_KEY_PREFIX = 'coding-statistics';
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours cache TTL

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private cacheService: CacheService
  ) {}

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    // Try to get from Redis cache first
    const cacheKey = `${this.CACHE_KEY_PREFIX}:${workspace_id}`;
    const cachedResult = await this.cacheService.get<CodingStatistics>(cacheKey);
    if (cachedResult) {
      this.logger.log(`Returning cached statistics for workspace ${workspace_id}`);
      return cachedResult;
    }

    const statistics: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    try {
      const statusCountResults = await this.responseRepository.query(`
        SELECT
          response.status_v1 as "statusValue",
          COUNT(response.id) as count
        FROM response
        INNER JOIN unit ON response.unitid = unit.id
        INNER JOIN booklet ON unit.bookletid = booklet.id
        INNER JOIN persons person ON booklet.personid = person.id
        WHERE response.status = $1
          AND person.workspace_id = $2
          AND person.consider = $3
        GROUP BY response.status_v1
      `, ['VALUE_CHANGED', workspace_id, true]);

      let totalResponses = 0;

      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        const validCount = Number.isNaN(count) ? 0 : count;
        statistics.statusCounts[result.statusValue] = validCount;
        totalResponses += validCount;
      });

      statistics.totalResponses = totalResponses;

      await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
      this.logger.log(`Computed and cached statistics for workspace ${workspace_id}`);

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }

  /**
   * Get the cache key for coding statistics
   * @param workspaceId The workspace ID
   * @returns The cache key
   */
  getCacheKey(workspaceId: number): string {
    return `${this.CACHE_KEY_PREFIX}:${workspaceId}`;
  }

  async createCodingStatisticsJob(workspaceId: number): Promise<{ jobId: string; message: string }> {
    this.logger.log(`Creating coding statistics job for workspace ${workspaceId}`);
    // This will be implemented in the JobQueueService
    throw new Error('Method not implemented yet - needs JobQueueService integration');
  }
}
