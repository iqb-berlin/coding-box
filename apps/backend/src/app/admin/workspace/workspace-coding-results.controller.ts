import {
  Controller,
  Param,
  Post,
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
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';

@ApiTags('Admin Workspace Coding Results')
@Controller('admin/workspace')
export class WorkspaceCodingResultsController {
  constructor(
    private workspaceCodingService: WorkspaceCodingService
  ) { }

  @Post(':workspace_id/coding/jobs/:jobId/apply-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: Number,
    description: 'Coding job ID to apply results for'
  })
  @ApiOkResponse({
    description: 'Coding results applied successfully to response database.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the application was successful'
        },
        updatedResponsesCount: {
          type: 'number',
          description: 'Number of responses updated'
        },
        skippedReviewCount: {
          type: 'number',
          description: 'Number of responses skipped for manual review'
        },
        messageKey: {
          type: 'string',
          description: 'Translation key for the message'
        },
        messageParams: {
          type: 'object',
          description: 'Parameters for the translation'
        }
      }
    }
  })
  async applyCodingResults(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: number
  ): Promise<{
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        messageKey: string;
        messageParams?: Record<string, unknown>;
      }> {
    return this.workspaceCodingService.applyCodingResults(workspace_id, jobId);
  }

  @Post(':workspace_id/coding/jobs/bulk-apply-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Bulk apply coding results for all jobs without issues.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the bulk operation was successful'
        },
        jobsProcessed: {
          type: 'number',
          description: 'Number of jobs processed'
        },
        totalUpdatedResponses: {
          type: 'number',
          description: 'Total number of responses updated across all jobs'
        },
        totalSkippedReview: {
          type: 'number',
          description: 'Total number of responses skipped for manual review'
        },
        message: {
          type: 'string',
          description: 'Summary message of the bulk operation'
        },
        results: {
          type: 'array',
          description: 'Detailed results for each job',
          items: {
            type: 'object',
            properties: {
              jobId: { type: 'number', description: 'Job ID' },
              jobName: { type: 'string', description: 'Job name' },
              hasIssues: {
                type: 'boolean',
                description: 'Whether the job has coding issues'
              },
              skipped: {
                type: 'boolean',
                description: 'Whether the job was skipped'
              },
              result: {
                type: 'object',
                description: 'Apply result (only present if not skipped)',
                properties: {
                  success: { type: 'boolean' },
                  updatedResponsesCount: { type: 'number' },
                  skippedReviewCount: { type: 'number' },
                  message: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  })
  async bulkApplyCodingResults(@WorkspaceId() workspace_id: number): Promise<{
    success: boolean;
    jobsProcessed: number;
    totalUpdatedResponses: number;
    totalSkippedReview: number;
    message: string;
    results: Array<{
      jobId: number;
      jobName: string;
      hasIssues: boolean;
      skipped: boolean;
      result?: {
        success: boolean;
        updatedResponsesCount: number;
        skippedReviewCount: number;
        message: string;
      };
    }>;
  }> {
    return this.workspaceCodingService.bulkApplyCodingResults(workspace_id);
  }
}
