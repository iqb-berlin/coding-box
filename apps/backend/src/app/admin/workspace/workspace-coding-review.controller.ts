import {
  Controller,
  Delete,
  Get,
  UnauthorizedException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Body,
  Req
} from '@nestjs/common';
import { Request } from 'express';
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
  DoubleCodedResolutionDecision,
  DoubleCodedReviewResponse,
  DoubleCodedResolutionResponse
} from './dto/workspace-coding.interfaces';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { SaveDoubleCodedReviewDraftDto } from '../../../../../../api-dto/coding/double-coded-review.dto';

const doubleCodedManagerDecisionSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const, nullable: true },
    responseId: { type: 'number' as const },
    managerUserId: { type: 'number' as const, nullable: true },
    managerKey: { type: 'string' as const, nullable: true },
    managerName: { type: 'string' as const },
    state: {
      type: 'string' as const,
      enum: ['draft', 'applied', 'superseded']
    },
    code: { type: 'number' as const, nullable: true },
    selectedCode: { type: 'number' as const, nullable: true },
    score: { type: 'number' as const, nullable: true },
    comment: { type: 'string' as const, nullable: true },
    createdAt: { type: 'string' as const, format: 'date-time', nullable: true },
    updatedAt: { type: 'string' as const, format: 'date-time', nullable: true },
    finalizedAt: {
      type: 'string' as const,
      format: 'date-time',
      nullable: true
    },
    legacy: { type: 'boolean' as const }
  },
  required: [
    'id',
    'responseId',
    'managerUserId',
    'managerKey',
    'managerName',
    'state',
    'code',
    'selectedCode',
    'score',
    'comment',
    'createdAt',
    'updatedAt',
    'finalizedAt',
    'legacy'
  ]
};

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingReviewController {
  constructor(private codingReviewService: CodingReviewService) {}

  @Get(':workspace_id/coding/double-coded-review')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
    description:
      'Exclude coder trainings from the review list (default: false)',
    type: Boolean
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Search string to filter by unit name, variable id, person login or person code',
    type: String
  })
  @ApiQuery({
    name: 'coderId',
    required: false,
    description: 'Filter by specific coder ID',
    type: Number
  })
  @ApiQuery({
    name: 'resolvedFilter',
    required: false,
    description: 'Filter by resolution status (all, resolved, unresolved)',
    type: String
  })
  @ApiQuery({
    name: 'agreementFilter',
    required: false,
    description: 'Filter by agreement status (all, match, differ)',
    type: String
  })
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Comma-separated list of coding job definition IDs to include',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Comma-separated list of coder training IDs to include',
    type: String
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
              sourceUnitId: {
                type: 'number',
                description:
                  'Coding job unit used as the authoritative review-code source'
              },
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              personLogin: { type: 'string', description: 'Person login' },
              personCode: { type: 'string', description: 'Person code' },
              bookletName: { type: 'string', description: 'Booklet name' },
              givenAnswer: {
                type: 'string',
                description: 'The given answer by the test person'
              },
              isResolved: {
                type: 'boolean',
                description: 'Whether the variable is already resolved'
              },
              appliedCode: {
                type: 'number',
                nullable: true,
                description: 'Code that has been applied to the response'
              },
              appliedScore: {
                type: 'number',
                nullable: true,
                description: 'Score that has been applied to the response'
              },
              appliedComment: {
                type: 'string',
                nullable: true,
                description:
                  'Optional supervisor comment saved with the applied decision'
              },
              availableCodes: {
                type: 'array',
                description:
                  'Codes currently selectable for the final review decision',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'number' },
                    label: { type: 'string' },
                    score: { type: 'number', nullable: true },
                    source: { type: 'string', enum: ['schema', 'general'] },
                    commentRequired: { type: 'boolean' }
                  }
                }
              },
              managerDrafts: {
                type: 'array',
                description: 'Current shared manager drafts',
                items: doubleCodedManagerDecisionSchema
              },
              managerHistory: {
                type: 'array',
                description: 'Finalized manager decisions',
                items: doubleCodedManagerDecisionSchema
              },
              coderResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coderId: { type: 'number', description: 'Coder user ID' },
                    coderName: { type: 'string', description: 'Coder name' },
                    jobId: { type: 'number', description: 'Coding job ID' },
                    jobName: {
                      type: 'string',
                      description: 'Name of the coding job'
                    },
                    code: {
                      type: 'number',
                      nullable: true,
                      description: 'Code given by the coder'
                    },
                    codingIssueOption: {
                      type: 'number',
                      nullable: true,
                      description:
                        'General coding issue option selected by the coder'
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
                   @Query('excludeTrainings') excludeTrainings?: string,
                   @Query('search') search?: string,
                   @Query('coderId') coderId?: number,
                   @Query('statusFilter') statusFilter?: string,
                   @Query('resolvedFilter') resolvedFilter?: string,
                   @Query('agreementFilter') agreementFilter?: 'all' | 'match' | 'differ',
                   @Query('jobDefinitionIds') jobDefinitionIds?: string,
                   @Query('coderTrainingIds') coderTrainingIds?: string
  ): Promise<DoubleCodedReviewResponse> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 items per page for review
    const isOnlyConflicts = onlyConflicts === 'true';
    const isExcludeTrainings = excludeTrainings === 'true';
    const selectedJobDefinitionIds = this.parseIdList(jobDefinitionIds);
    const selectedCoderTrainingIds = this.parseIdList(coderTrainingIds);

    return this.codingReviewService.getDoubleCodedVariablesForReview(
      workspace_id,
      validPage,
      validLimit,
      isOnlyConflicts,
      isExcludeTrainings,
      search,
      coderId,
      statusFilter,
      resolvedFilter,
      agreementFilter,
      selectedJobDefinitionIds,
      selectedCoderTrainingIds
    );
  }

  private parseIdList(rawIds?: string): number[] | undefined {
    if (!rawIds) {
      return undefined;
    }

    const parsedIds = rawIds
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !Number.isNaN(id));

    return parsedIds.length > 0 ? parsedIds : undefined;
  }

  @Post(':workspace_id/coding/double-coded-review/apply-resolutions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
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
                nullable: true,
                description:
                  'Selected coding job ID for an existing coder result'
              },
              sourceUnitId: {
                type: 'number',
                description:
                  'Authoritative review-code source for every selection'
              },
              code: {
                type: 'number',
                nullable: true,
                description:
                  'Explicit final replay code when no coder result is selected'
              },
              score: {
                type: 'number',
                nullable: true,
                description:
                  'Replay score echoed by the client; regular-code scores are validated and derived from the coding scheme'
              },
              resolutionComment: {
                type: 'string',
                nullable: true,
                description: 'Optional resolution comment'
              }
            },
            required: ['responseId', 'sourceUnitId']
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
        message: { type: 'string', description: 'Summary message' },
        results: {
          type: 'array',
          description: 'Per-response apply result',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number' },
              status: {
                type: 'string',
                enum: ['applied', 'failed', 'skipped']
              },
              message: { type: 'string', nullable: true }
            },
            required: ['responseId', 'status']
          }
        }
      }
    }
  })
  async applyDoubleCodedResolutions(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     decisions: DoubleCodedResolutionDecision[];
                   },
                   @Req() req: Request
  ): Promise<DoubleCodedResolutionResponse> {
    const manager = this.getRequestManager(req);
    return this.codingReviewService.applyDoubleCodedResolutions(
      workspace_id,
      body.decisions,
      manager
    );
  }

  @Put(':workspace_id/coding/double-coded-review/:responseId/draft')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'responseId', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sourceUnitId: {
          type: 'number',
          description:
            'Authoritative review-code source returned with the review row'
        },
        code: { type: 'number', description: 'Selected final code' },
        score: {
          type: 'number',
          nullable: true,
          description:
            'Client score; the server derives the authoritative schema score'
        },
        comment: { type: 'string', nullable: true }
      },
      required: ['sourceUnitId', 'code']
    }
  })
  @ApiOkResponse({
    description: 'Shared manager draft saved',
    schema: doubleCodedManagerDecisionSchema
  })
  async saveDoubleCodedReviewDraft(
  @WorkspaceId() workspace_id: number,
    @Param('responseId') responseId: number,
    @Body() body: SaveDoubleCodedReviewDraftDto,
    @Req() req: Request
  ) {
    const manager = this.getRequestManager(req);
    return this.codingReviewService.saveDoubleCodedReviewDraft(
      workspace_id,
      Number(responseId),
      manager.userId,
      manager.name,
      body
    );
  }

  @Delete(':workspace_id/coding/double-coded-review/:responseId/draft')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'responseId', type: Number })
  @ApiOkResponse({
    description: 'Own manager draft deleted',
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' } },
      required: ['success']
    }
  })
  async deleteDoubleCodedReviewDraft(
  @WorkspaceId() workspace_id: number,
    @Param('responseId') responseId: number,
    @Req() req: Request
  ) {
    const manager = this.getRequestManager(req);
    return this.codingReviewService.deleteDoubleCodedReviewDraft(
      workspace_id,
      Number(responseId),
      manager.userId
    );
  }

  private getRequestManager(req: Request): { userId: number; name: string } {
    const user = (
      req as Request & {
        user?: {
          id?: string | number;
          username?: string;
          preferred_username?: string;
          name?: string;
        };
      }
    ).user;
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedException(
        'Authenticated manager identity is missing'
      );
    }
    return {
      userId,
      name:
        user?.preferred_username ||
        user?.username ||
        user?.name ||
        `Manager ${userId}`
    };
  }
}
