import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Body
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingReviewService } from '../../database/services/coding';
import {
  DoubleCodedReviewResponse,
  DoubleCodedResolutionResponse
} from './dto/workspace-coding.interfaces';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingReviewController {
  constructor(
    private codingReviewService: CodingReviewService
  ) { }

  @Get(':workspace_id/coding/double-coded-review')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 50, max: 100)',
    type: Number
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder trainings from the review list (default: false)',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Double-coded variables retrieved for review',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              personLogin: { type: 'string', description: 'Person login' },
              personCode: { type: 'string', description: 'Person code' },
              bookletName: { type: 'string', description: 'Booklet name' },
              givenAnswer: {
                type: 'string',
                description: 'The given answer by the test person'
              },
              coderResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coderId: { type: 'number', description: 'Coder user ID' },
                    coderName: { type: 'string', description: 'Coder name' },
                    jobId: { type: 'number', description: 'Coding job ID' },
                    jobName: { type: 'string', description: 'Name of the coding job' },
                    code: {
                      type: 'number',
                      nullable: true,
                      description: 'Code given by the coder'
                    },
                    score: {
                      type: 'number',
                      nullable: true,
                      description: 'Score given by the coder'
                    },
                    notes: {
                      type: 'string',
                      nullable: true,
                      description: 'Notes from the coder'
                    },
                    codedAt: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When the coding was done'
                    }
                  }
                },
                description: 'Results from all coders who coded this variable'
              }
            }
          }
        },
        total: {
          type: 'number',
          description: 'Total number of double-coded variables'
        },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getDoubleCodedVariablesForReview(
    @WorkspaceId() workspace_id: number,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 50,
                   @Query('onlyConflicts') onlyConflicts?: string,
                   @Query('excludeTrainings') excludeTrainings?: string
  ): Promise<DoubleCodedReviewResponse> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 items per page for review
    const isOnlyConflicts = onlyConflicts === 'true';
    const isExcludeTrainings = excludeTrainings === 'true';

    return this.codingReviewService.getDoubleCodedVariablesForReview(
      workspace_id,
      validPage,
      validLimit,
      isOnlyConflicts,
      isExcludeTrainings
    );
  }

  @Post(':workspace_id/coding/double-coded-review/apply-resolutions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Apply resolutions for double-coded variables',
    schema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              selectedJobId: {
                type: 'number',
                description: 'Selected coding job ID'
              },
              resolutionComment: {
                type: 'string',
                nullable: true,
                description: 'Optional resolution comment'
              }
            },
            required: ['responseId', 'selectedJobId']
          }
        }
      },
      required: ['decisions']
    }
  })
  @ApiOkResponse({
    description: 'Resolutions applied successfully',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the operation was successful'
        },
        appliedCount: {
          type: 'number',
          description: 'Number of resolutions applied'
        },
        failedCount: {
          type: 'number',
          description: 'Number of resolutions that failed'
        },
        skippedCount: {
          type: 'number',
          description: 'Number of resolutions skipped'
        },
        message: { type: 'string', description: 'Summary message' }
      }
    }
  })
  async applyDoubleCodedResolutions(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     decisions: Array<{
                       responseId: number;
                       selectedJobId: number;
                       resolutionComment?: string;
                     }>;
                   }
  ): Promise<DoubleCodedResolutionResponse> {
    return this.codingReviewService.applyDoubleCodedResolutions(
      workspace_id,
      body.decisions
    );
  }
}
