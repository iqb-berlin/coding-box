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
      // Map camelCase properties to snake_case properties to match the entity
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
      const statistics = await this.getReplayStatistics(workspaceId);
      return statistics.reduce((acc, stat) => {
        acc[stat.unit_id] = (acc[stat.unit_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
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
      const query = this.replayStatisticsRepository.createQueryBuilder('stats')
        .where('stats.workspace_id = :workspaceId', { workspaceId });

      if (unitId) {
        query.andWhere('stats.unit_id = :unitId', { unitId });
      }

      const statistics = await query.getMany();

      if (statistics.length === 0) {
        return {
          min: 0,
          max: 0,
          average: 0,
          distribution: {},
          unitAverages: {}
        };
      }

      // Calculate min, max, and average
      const durations = statistics.map(stat => stat.duration_milliseconds);
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;

      // Create duration distribution (in 10-second buckets)
      const distribution: Record<string, number> = {};
      durations.forEach(duration => {
        const bucket = Math.floor(duration / 10) * 10;
        const bucketKey = `${bucket}-${bucket + 10}`;
        distribution[bucketKey] = (distribution[bucketKey] || 0) + 1;
      });

      // Calculate average duration per unit if not filtering by unit
      let unitAverages: Record<string, number> | undefined;
      if (!unitId) {
        unitAverages = {};
        const unitDurations: Record<string, number[]> = {};

        statistics.forEach(stat => {
          if (!unitDurations[stat.unit_id]) {
            unitDurations[stat.unit_id] = [];
          }
          unitDurations[stat.unit_id].push(stat.duration_milliseconds);
        });

        Object.entries(unitDurations).forEach(([unitKey, durationArray]) => {
          unitAverages![unitKey] = durationArray.reduce((sum, duration) => sum + duration, 0) / durationArray.length;
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
      const statistics = await this.getReplayStatistics(workspaceId);

      // Group replays by day (YYYY-MM-DD format)
      return statistics.reduce((acc, stat) => {
        // Format the date as YYYY-MM-DD
        const day = stat.timestamp.toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
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
      const statistics = await this.getReplayStatistics(workspaceId);

      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      // Count replays by hour
      statistics.forEach(stat => {
        const hour = stat.timestamp.getHours().toString();
        hourDistribution[hour] += 1;
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
      const statistics = await this.getReplayStatistics(workspaceId);

      if (statistics.length === 0) {
        return {
          successRate: 0,
          totalReplays: 0,
          successfulReplays: 0,
          failedReplays: 0,
          commonErrors: []
        };
      }

      const totalReplays = statistics.length;
      const successfulReplays = statistics.filter(stat => stat.success).length;
      const failedReplays = totalReplays - successfulReplays;
      const successRate = (successfulReplays / totalReplays) * 100;

      // Count occurrences of each error message
      const errorCounts: Record<string, number> = {};
      statistics.forEach(stat => {
        if (!stat.success && stat.error_message) {
          errorCounts[stat.error_message] = (errorCounts[stat.error_message] || 0) + 1;
        }
      });

      // Convert to array and sort by count (descending)
      const commonErrors = Object.entries(errorCounts)
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Get top 10 most common errors

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
      const statistics = await this.getReplayStatistics(workspaceId);

      // Filter for failed replays only
      const failedReplays = statistics.filter(stat => !stat.success);

      // Group failures by unit
      return failedReplays.reduce((acc, stat) => {
        const unitId = stat.unit_id;
        acc[unitId] = (acc[unitId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
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
      const statistics = await this.getReplayStatistics(workspaceId);

      // Filter for failed replays only
      const failedReplays = statistics.filter(stat => !stat.success);

      // Group failures by day (YYYY-MM-DD format)
      return failedReplays.reduce((acc, stat) => {
        // Format the date as YYYY-MM-DD
        const day = stat.timestamp.toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
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
      const statistics = await this.getReplayStatistics(workspaceId);

      // Filter for failed replays only
      const failedReplays = statistics.filter(stat => !stat.success);

      // Initialize all hours with 0 count
      const hourDistribution: Record<string, number> = {};
      for (let i = 0; i < 24; i++) {
        hourDistribution[i.toString()] = 0;
      }

      // Count failures by hour
      failedReplays.forEach(stat => {
        const hour = stat.timestamp.getHours().toString();
        hourDistribution[hour] += 1;
      });

      return hourDistribution;
    } catch (error) {
      this.logger.error(`Error calculating failure distribution by hour: ${error.message}`, error.stack);
      throw error;
    }
  }
}
