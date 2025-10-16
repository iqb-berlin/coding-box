import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../entities/response.entity';
import { CodingStatistics } from './shared-types';

@Injectable()
export class CodingStatisticsService {
  private readonly logger = new Logger(CodingStatisticsService.name);

  private statisticsCache: Map<number, { data: CodingStatistics; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) {}

  async getCodingStatistics(workspace_id: number): Promise<CodingStatistics> {
    this.logger.log(`Getting coding statistics for workspace ${workspace_id}`);

    const cachedResult = this.statisticsCache.get(workspace_id);
    if (cachedResult && (Date.now() - cachedResult.timestamp) < this.CACHE_TTL_MS) {
      this.logger.log(`Returning cached statistics for workspace ${workspace_id}`);
      return cachedResult.data;
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

      this.statisticsCache.set(workspace_id, {
        data: statistics,
        timestamp: Date.now()
      });

      return statistics;
    } catch (error) {
      this.logger.error(`Error getting coding statistics: ${error.message}`);
      return statistics;
    }
  }

  async createCodingStatisticsJob(workspaceId: number): Promise<{ jobId: string; message: string }> {
    this.logger.log(`Creating coding statistics job for workspace ${workspaceId}`);
    // This will be implemented in the JobQueueService
    throw new Error('Method not implemented yet - needs JobQueueService integration');
  }
}
