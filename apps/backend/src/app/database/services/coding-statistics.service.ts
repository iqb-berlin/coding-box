import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import { CodingStatistics } from './shared-types';
import { CacheService } from '../../cache/cache.service';
import { statusStringToNumber } from '../utils/response-status-converter';

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
        GROUP BY response.status_v1
      `, [valuedChangedStatus, workspace_id, true]);

      let totalResponses = 0;

      statusCountResults.forEach(result => {
        const count = parseInt(result.count, 10);
        const validCount = Number.isNaN(count) ? 0 : count;
        statistics.statusCounts[result.statusValue] = validCount;
        totalResponses += validCount;
        this.logger.debug(`Coded status ${result.statusValue}: ${validCount} responses`);
      });

      statistics.totalResponses = totalResponses;

      this.logger.log(`Computed coding statistics for workspace ${workspace_id}: ${totalResponses} total coded responses, ${Object.keys(statistics.statusCounts).length} different status types`);

      await this.cacheService.set(cacheKey, statistics, this.CACHE_TTL_SECONDS);
      this.logger.log(`Computed and cached statistics for workspace ${workspace_id}`);

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }
}
