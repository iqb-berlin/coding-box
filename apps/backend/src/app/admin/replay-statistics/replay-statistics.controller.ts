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
  ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReplayStatisticsService } from '../../database/services/replay-statistics.service';
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
  @ApiResponse({ status: 201, description: 'Replay statistics stored successfully' })
  @Post()
  @UseGuards(JwtAuthGuard)
  async storeReplayStatistics(
    @Param('workspace_id') workspaceId: string,
      @Body() data: {
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
  @ApiResponse({ status: 200, description: 'Replay statistics retrieved successfully' })
  @Get()
  @UseGuards(JwtAuthGuard)
  async getReplayStatistics(
    @Param('workspace_id') workspaceId: string
  ): Promise<ReplayStatistics[]> {
    return this.replayStatisticsService.getReplayStatistics(Number(workspaceId));
  }

  /**
   * Get replay frequency by unit
   */
  @ApiOperation({ summary: 'Get replay frequency by unit' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Replay frequency retrieved successfully' })
  @Get('frequency')
  @UseGuards(JwtAuthGuard)
  async getReplayFrequencyByUnit(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayFrequencyByUnit(Number(workspaceId));
  }

  /**
   * Get replay duration statistics
   */
  @ApiOperation({ summary: 'Get replay duration statistics' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiQuery({ name: 'unitId', required: false, description: 'Filter by unit ID' })
  @ApiResponse({ status: 200, description: 'Replay duration statistics retrieved successfully' })
  @Get('duration')
  @UseGuards(JwtAuthGuard)
  async getReplayDurationStatistics(
    @Param('workspace_id') workspaceId: string,
      @Query('unitId') unitId?: string
  ): Promise<{
        min: number;
        max: number;
        average: number;
        distribution: Record<string, number>;
        unitAverages?: Record<string, number>;
      }> {
    return this.replayStatisticsService.getReplayDurationStatistics(
      Number(workspaceId),
      unitId
    );
  }

  /**
   * Get replay distribution by day
   */
  @ApiOperation({ summary: 'Get replay distribution by day' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Replay distribution by day retrieved successfully' })
  @Get('distribution/day')
  @UseGuards(JwtAuthGuard)
  async getReplayDistributionByDay(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayDistributionByDay(Number(workspaceId));
  }

  /**
   * Get replay distribution by hour
   */
  @ApiOperation({ summary: 'Get replay distribution by hour' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Replay distribution by hour retrieved successfully' })
  @Get('distribution/hour')
  @UseGuards(JwtAuthGuard)
  async getReplayDistributionByHour(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getReplayDistributionByHour(Number(workspaceId));
  }

  /**
   * Get replay error statistics
   */
  @ApiOperation({ summary: 'Get replay error statistics' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Replay error statistics retrieved successfully' })
  @Get('errors')
  @UseGuards(JwtAuthGuard)
  async getReplayErrorStatistics(
    @Param('workspace_id') workspaceId: string
  ): Promise<{
        successRate: number;
        totalReplays: number;
        successfulReplays: number;
        failedReplays: number;
        commonErrors: Array<{ message: string; count: number }>;
      }> {
    return this.replayStatisticsService.getReplayErrorStatistics(Number(workspaceId));
  }

  /**
   * Get failure distribution by unit
   */
  @ApiOperation({ summary: 'Get failure distribution by unit' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Failure distribution by unit retrieved successfully' })
  @Get('failures/unit')
  @UseGuards(JwtAuthGuard)
  async getFailureDistributionByUnit(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByUnit(Number(workspaceId));
  }

  /**
   * Get failure distribution by day
   */
  @ApiOperation({ summary: 'Get failure distribution by day' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Failure distribution by day retrieved successfully' })
  @Get('failures/day')
  @UseGuards(JwtAuthGuard)
  async getFailureDistributionByDay(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByDay(Number(workspaceId));
  }

  /**
   * Get failure distribution by hour
   */
  @ApiOperation({ summary: 'Get failure distribution by hour' })
  @ApiParam({ name: 'workspace_id', description: 'ID of the workspace' })
  @ApiResponse({ status: 200, description: 'Failure distribution by hour retrieved successfully' })
  @Get('failures/hour')
  @UseGuards(JwtAuthGuard)
  async getFailureDistributionByHour(
    @Param('workspace_id') workspaceId: string
  ): Promise<Record<string, number>> {
    return this.replayStatisticsService.getFailureDistributionByHour(Number(workspaceId));
  }
}
