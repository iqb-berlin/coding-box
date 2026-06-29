import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import {
  REPLAY_STATISTICS_SOURCE_EXTERNAL,
  REPLAY_STATISTICS_SOURCE_INTERNAL,
  ReplayStatistics,
  ReplayStatisticsSource
} from '../../entities/replay-statistics.entity';

type ReplayTimingMap = Record<string, number | null>;
export type ReplayStatisticsSourceSummary = {
  internal: number;
  external: number;
  total: number;
};

/**
 * Service for managing replay statistics
 * Provides methods for storing and retrieving replay statistics data
 */
@Injectable()
export class ReplayStatisticsService {
  private readonly logger = new Logger(ReplayStatisticsService.name);

  private static readonly MAX_TIMING_VALUE_MS = 86_400_000;
  private static readonly MAX_IDENTIFIER_LENGTH = 255;
  private static readonly MAX_MESSAGE_LENGTH = 2000;

  private static readonly CLIENT_TIMING_KEYS = new Set([
    'routeToVisibleMs',
    'loadToVisibleMs',
    'routeToPayloadRequestMs',
    'payloadMs',
    'payloadToVisibleMs',
    'payloadToPlayerReadyMs',
    'playerReadyToVisibleMs'
  ]);

  private static readonly SERVER_TIMING_KEYS = new Set([
    'assetsFindUnitDefMs',
    'assetsFindUnitMs',
    'assetsGetVocsMs',
    'assetsExtractPlayerIdMs',
    'assetsFindPlayerMs',
    'assetsTotalMs',
    'responseFindUnitResponseMs',
    'responseTotalMs',
    'payloadFindUnitDefMs',
    'payloadFindUnitMs',
    'payloadGetVocsMs',
    'payloadExtractPlayerIdMs',
    'payloadFindPlayerMs',
    'payloadFindUnitResponseMs',
    'payloadTotalMs'
  ]);

  private applyTimeFilters(
    qb: SelectQueryBuilder<ReplayStatistics>,
    options?: { from?: string; to?: string; lastDays?: string }
  ): void {
    if (!options) {
      return;
    }

    const { from, to, lastDays } = options;

    if (lastDays) {
      const days = parseInt(lastDays, 10);
      if (!Number.isNaN(days) && days > 0) {
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        qb.andWhere('stats.timestamp >= :from', {
          from: fromDate.toISOString()
        });
      }
      return;
    }

    if (from) {
      qb.andWhere('stats.timestamp >= :from', { from });
    }

    if (to) {
      qb.andWhere('stats.timestamp < :to', { to });
    }
  }

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
    clientTimings?: Record<string, unknown>;
    serverTimings?: Record<string, unknown>;
    replaySource?: ReplayStatisticsSource;
  }): Promise<ReplayStatistics> {
    try {
      const mappedData = {
        workspace_id: data.workspaceId,
        unit_id: this.truncateString(
          data.unitId,
          ReplayStatisticsService.MAX_IDENTIFIER_LENGTH
        ) || 'unknown',
        booklet_id: this.truncateString(
          data.bookletId,
          ReplayStatisticsService.MAX_IDENTIFIER_LENGTH
        ),
        test_person_login: this.truncateString(
          data.testPersonLogin,
          ReplayStatisticsService.MAX_IDENTIFIER_LENGTH
        ),
        test_person_code: this.truncateString(
          data.testPersonCode,
          ReplayStatisticsService.MAX_IDENTIFIER_LENGTH
        ),
        duration_milliseconds: this.normalizeDurationMilliseconds(
          data.durationMilliseconds
        ),
        replay_url: this.truncateString(
          data.replayUrl,
          ReplayStatisticsService.MAX_MESSAGE_LENGTH
        ),
        replay_source: data.replaySource || REPLAY_STATISTICS_SOURCE_INTERNAL,
        success: data.success !== undefined ? data.success : true,
        error_message: this.truncateString(
          data.errorMessage,
          ReplayStatisticsService.MAX_MESSAGE_LENGTH
        ),
        client_timings: this.sanitizeTimingMap(
          data.clientTimings,
          ReplayStatisticsService.CLIENT_TIMING_KEYS
        ),
        server_timings: this.sanitizeTimingMap(
          data.serverTimings,
          ReplayStatisticsService.SERVER_TIMING_KEYS
        )
      };

      const replayStatistics =
        this.replayStatisticsRepository.create(mappedData);
      return await this.replayStatisticsRepository.save(replayStatistics);
    } catch (error) {
      this.logger.error(
        `Error storing replay statistics: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  private normalizeDurationMilliseconds(durationMilliseconds: number): number {
    if (!Number.isFinite(durationMilliseconds)) {
      return 0;
    }
    return Math.max(
      0,
      Math.min(Math.trunc(durationMilliseconds), 2147483647)
    );
  }

  private truncateString(value: string | undefined, maxLength: number): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private sanitizeTimingMap(
    timings: Record<string, unknown> | undefined,
    allowedKeys: Set<string>
  ): ReplayTimingMap | undefined {
    if (!timings || typeof timings !== 'object' || Array.isArray(timings)) {
      return undefined;
    }

    const sanitized: ReplayTimingMap = {};

    allowedKeys.forEach(key => {
      const value = timings[key];
      if (value === null) {
        sanitized[key] = null;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        sanitized[key] = Number(
          Math.max(
            0,
            Math.min(value, ReplayStatisticsService.MAX_TIMING_VALUE_MS)
          ).toFixed(2)
        );
      }
    });

    return Object.keys(sanitized).length ? sanitized : undefined;
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
      this.logger.error(
        `Error retrieving replay statistics: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get replay counts by source
   * @param workspaceId The ID of the workspace
   * @returns Counts for internal and externally token-authenticated replays
   */
  async getReplaySourceSummary(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<ReplayStatisticsSourceSummary> {
    try {
      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select([
          'stats.replay_source as source',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(qb, options);

      const result = await qb
        .groupBy('stats.replay_source')
        .getRawMany();

      const summary: ReplayStatisticsSourceSummary = {
        internal: 0,
        external: 0,
        total: 0
      };

      result.forEach(row => {
        const source = row.source as ReplayStatisticsSource;
        const count = parseInt(row.count, 10);
        if (
          source === REPLAY_STATISTICS_SOURCE_INTERNAL ||
          source === REPLAY_STATISTICS_SOURCE_EXTERNAL
        ) {
          summary[source] = count;
          summary.total += count;
        }
      });

      return summary;
    } catch (error) {
      this.logger.error(
        `Error calculating replay source summary: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get replay frequency by unit
   * @param workspaceId The ID of the workspace
   * @returns Object with unit IDs as keys and replay counts as values
   */
  async getReplayFrequencyByUnit(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string; limit?: string }
  ): Promise<Record<string, number>> {
    try {
      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select(['stats.unit_id', 'COUNT(*) as count'])
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(qb, options);

      qb.groupBy('stats.unit_id').orderBy('count', 'DESC');

      const limit = options?.limit ? parseInt(options.limit, 10) : undefined;
      if (limit && !Number.isNaN(limit) && limit > 0) {
        qb.limit(limit);
      }

      const result = await qb.getRawMany();

      const frequency: Record<string, number> = {};
      result.forEach(row => {
        frequency[row.stats_unit_id] = parseInt(row.count, 10);
      });

      return frequency;
    } catch (error) {
      this.logger.error(
        `Error calculating replay frequency: ${error.message}`,
        error.stack
      );
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
    unitId?: string,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<{
      min: number;
      max: number;
      average: number;
      distribution: Record<string, number>;
      unitAverages?: Record<string, number>;
    }> {
    try {
      const baseQuery = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(baseQuery, options);

      if (unitId) {
        baseQuery.andWhere('stats.unit_id = :unitId', { unitId });
      }

      const aggregateQuery = baseQuery
        .clone()
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

      const distributionRows = await baseQuery
        .clone()
        .select([
          'FLOOR(stats.duration_milliseconds / 10000) * 10000 as bucket_start',
          'COUNT(*) as count'
        ])
        .groupBy('bucket_start')
        .orderBy('bucket_start', 'ASC')
        .getRawMany();

      const distribution: Record<string, number> = {};
      distributionRows.forEach(row => {
        const bucketStart = parseInt(row.bucket_start, 10);
        const bucketKey = `${bucketStart}-${bucketStart + 10000}`;
        distribution[bucketKey] = parseInt(row.count, 10);
      });

      let unitAverages: Record<string, number> | undefined;
      if (!unitId) {
        const unitAveragesQuery = this.replayStatisticsRepository
          .createQueryBuilder('stats')
          .select([
            'stats.unit_id',
            'AVG(stats.duration_milliseconds) as average'
          ])
          .where('stats.workspace_id = :workspaceId', { workspaceId })
          .groupBy('stats.unit_id');

        this.applyTimeFilters(unitAveragesQuery, options);

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
      this.logger.error(
        `Error calculating duration statistics: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get replay distribution by day
   * @param workspaceId The ID of the workspace
   * @returns Object with days as keys and replay counts as values
   */
  async getReplayDistributionByDay(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<Record<string, number>> {
    try {
      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select(['DATE(stats.timestamp) as day', 'COUNT(*) as count'])
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(qb, options);

      const result = await qb
        .groupBy('DATE(stats.timestamp)')
        .orderBy('day', 'ASC')
        .getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.day] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(
        `Error calculating replay distribution by day: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get replay distribution by hour
   * @param workspaceId The ID of the workspace
   * @returns Object with hours (0-23) as keys and replay counts as values
   */
  async getReplayDistributionByHour(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<Record<string, number>> {
    try {
      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select([
          'EXTRACT(HOUR FROM stats.timestamp) as hour',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(qb, options);

      const result = await qb
        .groupBy('EXTRACT(HOUR FROM stats.timestamp)')
        .getRawMany();

      result.forEach(row => {
        hourDistribution[row.hour.toString()] = parseInt(row.count, 10);
      });

      return hourDistribution;
    } catch (error) {
      this.logger.error(
        `Error calculating replay distribution by hour: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get replay error statistics
   * @param workspaceId The ID of the workspace
   * @returns Object with error statistics
   */
  async getReplayErrorStatistics(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string; limit?: string }
  ): Promise<{
      successRate: number;
      totalReplays: number;
      successfulReplays: number;
      failedReplays: number;
      commonErrors: Array<{ message: string; count: number }>;
    }> {
    try {
      const overallQb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select([
          'COUNT(*) as total',
          'COUNT(CASE WHEN stats.success = true THEN 1 END) as successful',
          'COUNT(CASE WHEN stats.success = false THEN 1 END) as failed'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      this.applyTimeFilters(overallQb, options);

      const overallStats = await overallQb.getRawOne();

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

      const errorsQb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select(['stats.error_message as message', 'COUNT(*) as count'])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false')
        .andWhere('stats.error_message IS NOT NULL')
        .andWhere("stats.error_message != ''");

      this.applyTimeFilters(errorsQb, options);

      const limit = options?.limit ? parseInt(options.limit, 10) : 10;
      const safeLimit = !Number.isNaN(limit) && limit > 0 ? limit : 10;

      const errorResult = await errorsQb
        .groupBy('stats.error_message')
        .orderBy('count', 'DESC')
        .limit(safeLimit)
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
      this.logger.error(
        `Error calculating replay error statistics: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get failure distribution by unit
   * @param workspaceId The ID of the workspace
   * @returns Object with units as keys and failure counts as values
   */
  async getFailureDistributionByUnit(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string; limit?: string }
  ): Promise<Record<string, number>> {
    try {
      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select(['stats.unit_id', 'COUNT(*) as count'])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false');

      this.applyTimeFilters(qb, options);

      qb.groupBy('stats.unit_id').orderBy('count', 'DESC');

      const limit = options?.limit ? parseInt(options.limit, 10) : undefined;
      if (limit && !Number.isNaN(limit) && limit > 0) {
        qb.limit(limit);
      }

      const result = await qb.getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.stats_unit_id] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(
        `Error calculating failure distribution by unit: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get failure distribution by day
   * @param workspaceId The ID of the workspace
   * @returns Object with days as keys and failure counts as values
   */
  async getFailureDistributionByDay(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<Record<string, number>> {
    try {
      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select(['DATE(stats.timestamp) as day', 'COUNT(*) as count'])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false');

      this.applyTimeFilters(qb, options);

      const result = await qb
        .groupBy('DATE(stats.timestamp)')
        .orderBy('day', 'ASC')
        .getRawMany();

      const distribution: Record<string, number> = {};
      result.forEach(row => {
        distribution[row.day] = parseInt(row.count, 10);
      });

      return distribution;
    } catch (error) {
      this.logger.error(
        `Error calculating failure distribution by day: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Get failure distribution by hour
   * @param workspaceId The ID of the workspace
   * @returns Object with hours (0-23) as keys and failure counts as values
   */
  async getFailureDistributionByHour(
    workspaceId: number,
    options?: { from?: string; to?: string; lastDays?: string }
  ): Promise<Record<string, number>> {
    try {
      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      const qb = this.replayStatisticsRepository
        .createQueryBuilder('stats')
        .select([
          'EXTRACT(HOUR FROM stats.timestamp) as hour',
          'COUNT(*) as count'
        ])
        .where('stats.workspace_id = :workspaceId', { workspaceId })
        .andWhere('stats.success = false');

      this.applyTimeFilters(qb, options);

      const result = await qb
        .groupBy('EXTRACT(HOUR FROM stats.timestamp)')
        .getRawMany();

      result.forEach(row => {
        hourDistribution[row.hour.toString()] = parseInt(row.count, 10);
      });

      return hourDistribution;
    } catch (error) {
      this.logger.error(
        `Error calculating failure distribution by hour: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
