import {
  Controller,
  Get,
  Param,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { BullJobManagementService } from '../../database/services/jobs';
import { CodingStatisticsService } from '../../database/services/coding';
import { CodingStatistics } from '../../database/services/shared';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingJobController {
  constructor(
    private bullJobManagementService: BullJobManagementService,
    private codingStatisticsService: CodingStatisticsService
  ) { }

  @Get(':workspace_id/coding/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job'
  })
  @ApiOkResponse({
    description: 'Job status retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            'pending',
            'processing',
            'completed',
            'failed',
            'cancelled',
            'paused'
          ],
          description: 'Current status of the job'
        },
        progress: {
          type: 'number',
          description: 'Progress percentage (0-100)'
        },
        result: {
          type: 'object',
          description:
            'Result of the job (only available when status is completed)',
          properties: {
            totalResponses: { type: 'number' },
            statusCounts: {
              type: 'object',
              additionalProperties: { type: 'number' }
            }
          }
        },
        error: {
          type: 'string',
          description: 'Error message (only available when status is failed)'
        }
      }
    }
  })
  async getJobStatus(@Param('jobId') jobId: string): Promise<
  | {
    status: string;
    progress: number;
    result?: CodingStatistics;
    error?: string;
  }
  | { error: string }
  > {
    const status = await this.codingStatisticsService.getJobStatus(jobId);
    if (!status) {
      return { error: `Job with ID ${jobId} not found` };
    }
    return status;
  }

  @Get(':workspace_id/coding/job/:jobId/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to cancel'
  })
  @ApiOkResponse({
    description: 'Job cancellation request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the cancellation request was successful'
        },
        message: {
          type: 'string',
          description:
            'Message describing the result of the cancellation request'
        }
      }
    }
  })
  async cancelJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingStatisticsService.cancelJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/delete')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to delete'
  })
  @ApiOkResponse({
    description: 'Job deletion request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the deletion request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the deletion request'
        }
      }
    }
  })
  async deleteJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.codingStatisticsService.deleteJob(jobId);
  }

  @Get(':workspace_id/coding/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of all jobs retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Unique identifier for the job'
          },
          status: {
            type: 'string',
            enum: [
              'pending',
              'processing',
              'completed',
              'failed',
              'cancelled',
              'paused'
            ],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description:
              'Result of the job (only available when status is completed)',
            properties: {
              totalResponses: { type: 'number' },
              statusCounts: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          },
          error: {
            type: 'string',
            description: 'Error message (only available when status is failed)'
          },
          workspaceId: {
            type: 'number',
            description: 'ID of the workspace the job belongs to'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was created'
          }
        }
      }
    }
  })
  async getAllJobs(@WorkspaceId() workspace_id: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
    autoCoderRun?: number;
  }[]
  > {
    return this.bullJobManagementService.getBullJobs(workspace_id);
  }

  @Get(':workspace_id/coding/bull-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of jobs from Redis Bull retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'Unique identifier for the job'
          },
          status: {
            type: 'string',
            enum: [
              'pending',
              'processing',
              'completed',
              'failed',
              'cancelled',
              'paused'
            ],
            description: 'Current status of the job'
          },
          progress: {
            type: 'number',
            description: 'Progress percentage (0-100)'
          },
          result: {
            type: 'object',
            description:
              'Result of the job (only available when status is completed)',
            properties: {
              totalResponses: { type: 'number' },
              statusCounts: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          },
          error: {
            type: 'string',
            description: 'Error message (only available when status is failed)'
          },
          workspaceId: {
            type: 'number',
            description: 'ID of the workspace the job belongs to'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was created'
          },
          groupNames: {
            type: 'string',
            description: 'Group names for the job'
          },
          durationMs: {
            type: 'number',
            description: 'Duration of the job in milliseconds'
          },
          completedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time when the job was completed'
          }
        }
      }
    }
  })
  async getBullJobs(@WorkspaceId() workspace_id: number): Promise<
  {
    jobId: string;
    status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'paused';
    progress: number;
    result?: CodingStatistics;
    error?: string;
    workspaceId?: number;
    createdAt?: Date;
    groupNames?: string;
    durationMs?: number;
    completedAt?: Date;
  }[]
  > {
    return this.bullJobManagementService.getBullJobs(workspace_id);
  }

  @Get(':workspace_id/coding/job/:jobId/pause')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to pause'
  })
  @ApiOkResponse({
    description: 'Job pause request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the pause request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the pause request'
        }
      }
    }
  })
  async pauseJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.pauseJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/resume')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the background job to resume'
  })
  @ApiOkResponse({
    description: 'Job resume request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the resume request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the resume request'
        }
      }
    }
  })
  async resumeJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.bullJobManagementService.resumeJob(jobId);
  }

  @Get(':workspace_id/coding/job/:jobId/restart')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'ID of the failed background job to restart'
  })
  @ApiOkResponse({
    description: 'Job restart request processed.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the restart request was successful'
        },
        message: {
          type: 'string',
          description: 'Message describing the result of the restart request'
        },
        jobId: {
          type: 'string',
          description: 'ID of the new job created from the restart'
        }
      }
    }
  })
  async restartJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    return this.bullJobManagementService.restartJob(jobId);
  }
}
