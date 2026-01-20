import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  AccessLevelGuard,
  RequireAccessLevel
} from '../workspace/access-level.guard';
import { ReplayStatisticsService } from '../../database/services/test-results';
import { ReplayStatistics } from '../../database/entities/replay-statistics.entity';

/**
 * Controller for managing replay statistics
 */
@ApiTags('replay-statistics')
@Controller('admin/workspace/:workspace_id/replay-statistics')
export class ReplayStatisticsController {
  constructor(
    private readonly replayStatisticsService: ReplayStatisticsService
  ) {}

  /**
   * Store replay statistics
   */
  @ApiOperation({ summary: 'Store replay statistics' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({
    status: 201,
    description: 'Replay statistics stored successfully'
  })
  @Post()
  async storeReplayStatistics(
    @Param('workspace_id') workspaceId: string,
      @Body()
                           data: {
                             unitId: string;
                             bookletId?: string;
                             testPersonLogin?: string;
                             testPersonCode?: string;
                             durationMilliseconds: number;
                             replayUrl?: string;
                             success?: boolean;
                             errorMessage?: string;
                           }
  ): Promise<ReplayStatistics> {
    return this.replayStatisticsService.storeReplayStatistics({
      workspaceId: Number(workspaceId),
      ...data
    });
  }

  /**
   * Get all replay statistics for a workspace
   */
  @ApiOperation({ summary: 'Get all replay statistics for a workspace' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({
    status: 200,
    description: 'Replay statistics retrieved successfully'
  })
  @Get()
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayStatistics(
    @Param('workspace_id') workspaceId: string
  ): Promise<ReplayStatistics[]> {
    return this.replayStatisticsService.getReplayStatistics(
      Number(workspaceId)
    );
  }

  /**
   * Get replay frequency by unit
   */
  @ApiOperation({ summary: 'Get replay frequency by unit' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit number of returned units (top by count)'
  })
  @ApiResponse({
    status: 200,
    description: 'Replay frequency retrieved successfully'
  })
  @Get('frequency')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayFrequencyByUnit(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string,
      @Query('limit') limit?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayFrequencyByUnit(
      Number(workspaceId),
      {
        from,
        to,
        lastDays,
        limit
      }
    );
  }

  /**
   * Get replay duration statistics
   */
  @ApiOperation({ summary: 'Get replay duration statistics' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'unitId',
    required: false,
    description: 'Filter by unit ID'
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiResponse({
    status: 200,
    description: 'Replay duration statistics retrieved successfully'
  })
  @Get('duration')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayDurationStatistics(
    @Param('workspace_id') workspaceId: string,
      @Query('unitId') unitId?: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string
  ): Promise<{
        min: number;
        max: number;
        average: number;
        distribution: Record<string, number>;
        unitAverages?: Record<string, number>;
      }> {
    return this.replayStatisticsService.getReplayDurationStatistics(
      Number(workspaceId),
      unitId,
      {
        from,
        to,
        lastDays
      }
    );
  }

  /**
   * Get replay distribution by day
   */
  @ApiOperation({ summary: 'Get replay distribution by day' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiResponse({
    status: 200,
    description: 'Replay distribution by day retrieved successfully'
  })
  @Get('distribution/day')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayDistributionByDay(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayDistributionByDay(
      Number(workspaceId),
      {
        from,
        to,
        lastDays
      }
    );
  }

  /**
   * Get replay distribution by hour
   */
  @ApiOperation({ summary: 'Get replay distribution by hour' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiResponse({
    status: 200,
    description: 'Replay distribution by hour retrieved successfully'
  })
  @Get('distribution/hour')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayDistributionByHour(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayDistributionByHour(
      Number(workspaceId),
      {
        from,
        to,
        lastDays
      }
    );
  }

  /**
   * Get replay error statistics
   */
  @ApiOperation({ summary: 'Get replay error statistics' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit number of common errors returned (default 10)'
  })
  @ApiResponse({
    status: 200,
    description: 'Replay error statistics retrieved successfully'
  })
  @Get('errors')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getReplayErrorStatistics(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string,
      @Query('limit') limit?: string
  ): Promise<{
        successRate: number;
        totalReplays: number;
        successfulReplays: number;
        failedReplays: number;
        commonErrors: Array<{ message: string; count: number }>;
      }> {
    return this.replayStatisticsService.getReplayErrorStatistics(
      Number(workspaceId),
      {
        from,
        to,
        lastDays,
        limit
      }
    );
  }

  /**
   * Get failure distribution by unit
   */
  @ApiOperation({ summary: 'Get failure distribution by unit' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit number of returned units (top by count)'
  })
  @ApiResponse({
    status: 200,
    description: 'Failure distribution by unit retrieved successfully'
  })
  @Get('failures/unit')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getFailureDistributionByUnit(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string,
      @Query('limit') limit?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByUnit(
      Number(workspaceId),
      {
        from,
        to,
        lastDays,
        limit
      }
    );
  }

  /**
   * Get failure distribution by day
   */
  @ApiOperation({ summary: 'Get failure distribution by day' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiResponse({
    status: 200,
    description: 'Failure distribution by day retrieved successfully'
  })
  @Get('failures/day')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getFailureDistributionByDay(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByDay(
      Number(workspaceId),
      {
        from,
        to,
        lastDays
      }
    );
  }

  /**
   * Get failure distribution by hour
   */
  @ApiOperation({ summary: 'Get failure distribution by hour' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO timestamp (inclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'ISO timestamp (exclusive) to filter replay statistics'
  })
  @ApiQuery({
    name: 'lastDays',
    required: false,
    description:
      'Convenience filter: last N days (overrides from/to if provided)'
  })
  @ApiResponse({
    status: 200,
    description: 'Failure distribution by hour retrieved successfully'
  })
  @Get('failures/hour')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getFailureDistributionByHour(
    @Param('workspace_id') workspaceId: string,
      @Query('from') from?: string,
      @Query('to') to?: string,
      @Query('lastDays') lastDays?: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByHour(
      Number(workspaceId),
      {
        from,
        to,
        lastDays
      }
    );
  }
}
