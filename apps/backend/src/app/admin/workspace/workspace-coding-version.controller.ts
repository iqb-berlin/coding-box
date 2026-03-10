import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  UseGuards,
  Body,
  ConflictException
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiConflictResponse
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingStatisticsService } from '../../database/services/coding';
import { JournalService } from '../../database/services/shared';
import { JobQueueService } from '../../job-queue/job-queue.service';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    id: string;
    name: string;
    workspace: string;
  };
}

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingVersionController {
  constructor(
    private codingStatisticsService: CodingStatisticsService,
    private journalService: JournalService,
    private jobQueueService: JobQueueService
  ) { }

  @Post(':workspace_id/coding/reset-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiBody({
    description: 'Reset coding version request',
    schema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          enum: ['v1', 'v2', 'v3'],
          description: 'Coding version to reset'
        },
        unitFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional unit names to filter by'
        },
        variableFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional variable IDs to filter by'
        }
      },
      required: ['version']
    }
  })
  @ApiOkResponse({
    description: 'Reset coding version job enqueued successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'ID of the background job'
        },
        message: {
          type: 'string',
          description: 'Summary message'
        }
      }
    }
  })
  @ApiConflictResponse({
    description: 'Another reset or auto-coding job is already running for this workspace'
  })
  async resetCodingVersion(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     version: 'v1' | 'v2' | 'v3';
                     unitFilters?: string[];
                     variableFilters?: string[];
                   },
                   @Req() request: RequestWithUser
  ): Promise<{ jobId: string; message: string }> {
    // Check for active jobs (mutual blocking with auto-coding)
    const { blocked, reason } = await this.jobQueueService.hasActiveJobsForWorkspace(workspace_id);
    if (blocked) {
      throw new ConflictException(reason);
    }

    const job = await this.jobQueueService.addResetCodingVersionJob({
      workspaceId: workspace_id,
      version: body.version,
      unitFilters: body.unitFilters,
      variableFilters: body.variableFilters
    });

    // Log to journal
    const userId = request.user?.id || 'unknown';
    await this.journalService.createEntry(
      userId,
      workspace_id,
      'RESET_VERSION',
      'CODING',
      workspace_id,
      {
        version: body.version,
        jobId: job.id.toString(),
        unitFilters: body.unitFilters || [],
        variableFilters: body.variableFilters || []
      }
    );

    return {
      jobId: job.id.toString(),
      message: `Reset coding version job enqueued for version ${body.version}`
    };
  }

  @Get(':workspace_id/coding/reset-version/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the reset job' })
  @ApiOkResponse({
    description: 'Reset job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed']
        },
        progress: { type: 'number' },
        result: {
          type: 'object',
          properties: {
            affectedResponseCount: { type: 'number' },
            cascadeResetVersions: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' }
          }
        },
        error: { type: 'string' }
      }
    }
  })
  async getResetJobStatus(
    @Param('jobId') jobId: string
  ): Promise<{
        status: string;
        progress: number;
        result?: {
          affectedResponseCount: number;
          cascadeResetVersions: ('v2' | 'v3')[];
          message: string;
        };
        error?: string;
      }> {
    const job = await this.jobQueueService.getResetCodingVersionJob(jobId);
    if (!job) {
      return { status: 'not_found', progress: 0, error: `Job with ID ${jobId} not found` };
    }

    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? job.progress() as number : 0;

    const statusMap: Record<string, string> = {
      waiting: 'pending',
      delayed: 'pending',
      active: 'processing',
      completed: 'completed',
      failed: 'failed'
    };

    const result: {
      status: string;
      progress: number;
      result?: {
        affectedResponseCount: number;
        cascadeResetVersions: ('v2' | 'v3')[];
        message: string;
      };
      error?: string;
    } = {
      status: statusMap[state] || state,
      progress
    };

    if (state === 'completed') {
      result.result = job.returnvalue;
    }

    if (state === 'failed') {
      result.error = job.failedReason || 'Unknown error';
    }

    return result;
  }

  @Get(':workspace_id/coding/reset-version/active')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Active reset job for this workspace (if any)',
    schema: {
      type: 'object',
      properties: {
        hasActiveJob: { type: 'boolean' },
        jobId: { type: 'string' },
        version: { type: 'string' },
        progress: { type: 'number' },
        status: { type: 'string' }
      }
    }
  })
  async getActiveResetJob(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        hasActiveJob: boolean;
        jobId?: string;
        version?: string;
        progress?: number;
        status?: string;
      }> {
    const job = await this.jobQueueService.getActiveResetCodingVersionJob(workspace_id);
    if (!job) {
      return { hasActiveJob: false };
    }

    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? job.progress() as number : 0;

    const statusMap: Record<string, string> = {
      waiting: 'pending',
      delayed: 'pending',
      active: 'processing'
    };

    return {
      hasActiveJob: true,
      jobId: job.id.toString(),
      version: job.data.version,
      progress,
      status: statusMap[state] || state
    };
  }
}
