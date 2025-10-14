import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReplayStatistics } from '../entities/replay-statistics.entity';

/**
 * Service for managing replay statistics
 * Provides methods for storing and retrieving replay statistics data
 */
@Injectable()
export class ReplayStatisticsService {
  private readonly logger = new Logger(ReplayStatisticsService.name);

  constructor(
    @InjectRepository(ReplayStatistics)
    private replayStatisticsRepository: Repository<ReplayStatistics>
  ) {}

  /**
   * Store replay statistics data
   * @param data Replay statistics data to store
   * @returns The stored replay statistics entity
   */
  async storeReplayStatistics(data: {
    workspaceId: number;
    unitId: string;
    bookletId?: string;
    testPersonLogin?: string;
    testPersonCode?: string;
    durationMilliseconds: number;
    replayUrl?: string;
    success?: boolean;
    errorMessage?: string;
  }): Promise<ReplayStatistics> {
    try {
      const mappedData = {
        workspace_id: data.workspaceId,
        unit_id: data.unitId,
        booklet_id: data.bookletId,
        test_person_login: data.testPersonLogin,
        test_person_code: data.testPersonCode,
        duration_milliseconds: data.durationMilliseconds,
        replay_url: data.replayUrl,
        success: data.success !== undefined ? data.success : true,
        error_message: data.errorMessage
      };

      const replayStatistics = this.replayStatisticsRepository.create(mappedData);
      return await this.replayStatisticsRepository.save(replayStatistics);
    } catch (error) {
      this.logger.error(`Error storing replay statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay statistics for a workspace
   * @param workspaceId The ID of the workspace
   * @returns Array of replay statistics for the workspace
   */
  async getReplayStatistics(workspaceId: number): Promise<ReplayStatistics[]> {
    try {
      return await this.replayStatisticsRepository.find({
        where: { workspace_id: workspaceId },
        order: { timestamp: 'DESC' }
      });
    } catch (error) {
      this.logger.error(`Error retrieving replay statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay frequency by unit
   * @param workspaceId The ID of the workspace
   * @returns Object with unit IDs as keys and replay counts as values
   */
  async getReplayFrequencyByUnit(workspaceId: number): Promise<Record<string, number>> {
    try {
      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'stats.unit_id',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .groupBy('stats.unit_id')
        .getRawMany();

      const frequency: Record<string, number> = {};
      result.forEach(row => {
        frequency[row.stats_unit_id] = parseInt(row.count, 10);
      });

      return frequency;
    } catch (error) {
      this.logger.error(`Error calculating replay frequency: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay duration statistics
   * @param workspaceId The ID of the workspace
   * @param unitId Optional unit ID to filter by
   * @returns Object with min, max, average duration and distribution data
   */
  async getReplayDurationStatistics(
    workspaceId: number,
    unitId?: string
  ): Promise<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }> {
    try {
      const baseQuery = this.replayStatisticsRepository.createQueryBuilder('stats')
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      if (unitId) {
        baseQuery.andWhere('stats.unit_id = :unitId', { unitId });
      }

      const aggregateQuery = baseQuery.clone()
        .select([
          'MIN(stats.duration_milliseconds) as min',
          'MAX(stats.duration_milliseconds) as max',
          'AVG(stats.duration_milliseconds) as average',
          'COUNT(*) as count'
        ]);

      const aggregateResult = await aggregateQuery.getRawOne();

      if (!aggregateResult || aggregateResult.count === '0') {
        return {
          min: 0,
          max: 0,
          average: 0,
          distribution: {},
          unitAverages: {}
        };
      }

      const min = parseInt(aggregateResult.min, 10);
      const max = parseInt(aggregateResult.max, 10);
      const average = parseFloat(aggregateResult.average);

      const distribution: Record<string, number> = {};
      const chunkSize = 10000; // Process 10k records at a time
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const chunk = await baseQuery.clone()
          .select(['stats.duration_milliseconds'])
          .limit(chunkSize)
          .offset(offset)
          .getRawMany();

        if (chunk.length === 0) {
          hasMore = false;
          break;
        }

        chunk.forEach(row => {
          const duration = parseInt(row.stats_duration_milliseconds, 10);
          const bucket = Math.floor(duration / 10000) * 10000; // 10-second buckets in milliseconds
          const bucketKey = `${bucket}-${bucket + 10000}`;
          distribution[bucketKey] = (distribution[bucketKey] || 0) + 1;
        });

        offset += chunkSize;
        if (chunk.length < chunkSize) {
          hasMore = false;
        }
      }

      let unitAverages: Record<string, number> | undefined;
      if (!unitId) {
        const unitAveragesQuery = this.replayStatisticsRepository.createQueryBuilder('stats')
          .select([
            'stats.unit_id',
            'AVG(stats.duration_milliseconds) as average'
          ])
          .where('stats.workspace_id = :workspaceId', { workspaceId })
          .groupBy('stats.unit_id');

        const unitAveragesResult = await unitAveragesQuery.getRawMany();

        unitAverages = {};
        unitAveragesResult.forEach(row => {
          unitAverages![row.stats_unit_id] = parseFloat(row.average);
        });
      }

      return {
        min,
        max,
        average,
        distribution,
        unitAverages
      };
    } catch (error) {
      this.logger.error(`Error calculating duration statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay distribution by day
   * @param workspaceId The ID of the workspace
   * @returns Object with days as keys and replay counts as values
   */
  async getReplayDistributionByDay(workspaceId: number): Promise<Record<string, number>> {
    try {
      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'DATE(stats.timestamp) as day',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .groupBy('DATE(stats.timestamp)')
        .orderBy('day', 'ASC')
        .getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.day] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(`Error calculating replay distribution by day: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay distribution by hour
   * @param workspaceId The ID of the workspace
   * @returns Object with hours (0-23) as keys and replay counts as values
   */
  async getReplayDistributionByHour(workspaceId: number): Promise<Record<string, number>> {
    try {
      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'EXTRACT(HOUR FROM stats.timestamp) as hour',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .groupBy('EXTRACT(HOUR FROM stats.timestamp)')
        .getRawMany();

      result.forEach(row => {
        hourDistribution[row.hour.toString()] = parseInt(row.count, 10);
      });

      return hourDistribution;
    } catch (error) {
      this.logger.error(`Error calculating replay distribution by hour: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get replay error statistics
   * @param workspaceId The ID of the workspace
   * @returns Object with error statistics
   */
  async getReplayErrorStatistics(workspaceId: number): Promise<{
    successRate: number;
    totalReplays: number;
    successfulReplays: number;
    failedReplays: number;
    commonErrors: Array<{ message: string; count: number }>;
  }> {
    try {
      const overallStats = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'COUNT(*) as total',
          'COUNT(CASE WHEN stats.success = true THEN 1 END) as successful',
          'COUNT(CASE WHEN stats.success = false THEN 1 END) as failed'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .getRawOne();

      if (!overallStats || overallStats.total === '0') {
        return {
          successRate: 0,
          totalReplays: 0,
          successfulReplays: 0,
          failedReplays: 0,
          commonErrors: []
        };
      }

      const totalReplays = parseInt(overallStats.total, 10);
      const successfulReplays = parseInt(overallStats.successful, 10);
      const failedReplays = parseInt(overallStats.failed, 10);
      const successRate = (successfulReplays / totalReplays) * 100;

      const errorResult = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'stats.error_message as message',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false')
        .andWhere('stats.error_message IS NOT NULL')
        .andWhere('stats.error_message != \'\'')
        .groupBy('stats.error_message')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany();

      const commonErrors = errorResult.map(row => ({
        message: row.message,
        count: parseInt(row.count, 10)
      }));

      return {
        successRate,
        totalReplays,
        successfulReplays,
        failedReplays,
        commonErrors
      };
    } catch (error) {
      this.logger.error(`Error calculating replay error statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get failure distribution by unit
   * @param workspaceId The ID of the workspace
   * @returns Object with units as keys and failure counts as values
   */
  async getFailureDistributionByUnit(workspaceId: number): Promise<Record<string, number>> {
    try {
      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'stats.unit_id',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false')
        .groupBy('stats.unit_id')
        .getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.stats_unit_id] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(`Error calculating failure distribution by unit: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get failure distribution by day
   * @param workspaceId The ID of the workspace
   * @returns Object with days as keys and failure counts as values
   */
  async getFailureDistributionByDay(workspaceId: number): Promise<Record<string, number>> {
    try {
      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'DATE(stats.timestamp) as day',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false')
        .groupBy('DATE(stats.timestamp)')
        .orderBy('day', 'ASC')
        .getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.day] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(`Error calculating failure distribution by day: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get failure distribution by hour
   * @param workspaceId The ID of the workspace
   * @returns Object with hours (0-23) as keys and failure counts as values
   */
  async getFailureDistributionByHour(workspaceId: number): Promise<Record<string, number>> {
    try {
      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      const result = await this.replayStatisticsRepository.createQueryBuilder('stats')
        .select([
          'EXTRACT(HOUR FROM stats.timestamp) as hour',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false')
        .groupBy('EXTRACT(HOUR FROM stats.timestamp)')
        .getRawMany();

      result.forEach(row => {
        hourDistribution[row.hour.toString()] = parseInt(row.count, 10);
      });

      return hourDistribution;
    } catch (error) {
      this.logger.error(`Error calculating failure distribution by hour: ${error.message}`, error.stack);
      throw error;
    }
  }
}
