import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Body,
  Delete,
  Req
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import {
  CoderTrainingResultsApplyService,
  CoderTrainingService,
  TrainingCohensKappaStatistics
} from '../../database/services/coding';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../database/entities/job-definition.entity';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  ApplyTrainingDiscussionResultsRequestDto,
  ApplyTrainingDiscussionResultsResultDto,
  TrainingDiscussionApplyPreviewDto,
  TrainingDiscussionApplySource
} from '../../../../../../api-dto/coding/training-discussion-apply.dto';
import { TrainingComparisonFreshnessDto } from '../../../../../../api-dto/coding/training-comparison-freshness.dto';
import {
  TrainingCodingComparisonPageDto,
  TrainingComparisonFiltersDto,
  TrainingComparisonMatchFilter,
  TrainingComparisonNotesFilter,
  TrainingComparisonSortBy,
  TrainingComparisonSortDirection,
  WithinTrainingCodingComparisonPageDto
} from '../../../../../../api-dto/coding/training-comparison.dto';

const trainingComparisonSummarySchema = {
  type: 'object',
  properties: {
    visibleRows: { type: 'number' },
    comparableRows: { type: 'number' },
    matchingRows: { type: 'number' },
    matchingPercentage: { type: 'number' },
    incompleteRows: { type: 'number' },
    notComparableRows: { type: 'number' },
    deviationRows: { type: 'number' },
    completionRate: { type: 'number' }
  }
};

const trainingComparisonCoderSchema = {
  type: 'object',
  properties: {
    trainingId: { type: 'number', description: 'Training ID' },
    trainingLabel: { type: 'string', description: 'Training label' },
    coderId: { type: 'number', description: 'Coder (Job) ID' },
    coderName: { type: 'string', description: 'Coder name' }
  }
};

const trainingComparisonCoderResultSchema = {
  type: 'object',
  properties: {
    ...trainingComparisonCoderSchema.properties,
    code: { type: 'string', nullable: true },
    score: { type: 'number', nullable: true },
    notes: { type: 'string', nullable: true },
    codingIssueOption: { type: 'number', nullable: true }
  }
};

const withinTrainingComparisonCoderSchema = {
  type: 'object',
  properties: {
    jobId: { type: 'number', description: 'Job ID' },
    coderName: { type: 'string', description: 'Coder name' }
  }
};

const withinTrainingComparisonCoderResultSchema = {
  type: 'object',
  properties: {
    ...withinTrainingComparisonCoderSchema.properties,
    code: { type: 'string', nullable: true },
    score: { type: 'number', nullable: true },
    notes: { type: 'string', nullable: true },
    codingIssueOption: { type: 'number', nullable: true }
  }
};

const trainingCodingComparisonRowSchema = {
  type: 'object',
  properties: {
    responseId: { type: 'number' },
    unitName: { type: 'string', description: 'Name of the unit' },
    variableId: { type: 'string', description: 'Variable ID' },
    personCode: { type: 'string', description: 'Person code' },
    personLogin: { type: 'string', description: 'Person login' },
    personGroup: { type: 'string', description: 'Person group' },
    bookletName: { type: 'string', description: 'Test booklet name' },
    testPerson: { type: 'string', description: 'Test person details' },
    coders: {
      type: 'array',
      items: trainingComparisonCoderResultSchema
    }
  }
};

const withinTrainingCodingComparisonRowSchema = {
  type: 'object',
  properties: {
    ...trainingCodingComparisonRowSchema.properties,
    givenAnswer: { type: 'string', description: 'Given answer' },
    replayCode: { type: 'number', nullable: true },
    replayScore: { type: 'number', nullable: true },
    discussionCode: { type: 'number', nullable: true },
    discussionScore: { type: 'number', nullable: true },
    discussionNotes: { type: 'string', nullable: true },
    discussionManagerUserId: { type: 'number', nullable: true },
    discussionManagerName: { type: 'string', nullable: true },
    discussionSource: { type: 'string', enum: ['manual', 'auto_agreement'], nullable: true },
    coders: {
      type: 'array',
      items: withinTrainingComparisonCoderResultSchema
    }
  }
};

const createTrainingComparisonPageSchema = (
  dataItemSchema: Record<string, unknown>,
  coderSchema: Record<string, unknown>
) => ({
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: dataItemSchema
    },
    total: { type: 'number' },
    page: { type: 'number' },
    limit: { type: 'number' },
    totalPages: { type: 'number' },
    summary: trainingComparisonSummarySchema,
    availableCoders: {
      type: 'array',
      items: coderSchema
    }
  }
});

@ApiTags('Admin Workspace Coder Training')
@Controller('admin/workspace')
export class WorkspaceCoderTrainingController {
  constructor(
    private coderTrainingService: CoderTrainingService,
    private coderTrainingResultsApplyService: CoderTrainingResultsApplyService
  ) { }

  private parsePositiveIntQuery(
    value: string | undefined,
    name: string,
    defaultValue?: number,
    maxValue?: number
  ): number {
    if (value === undefined || value === '') {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new BadRequestException(`${name} must be a positive integer`);
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }

    return maxValue ? Math.min(parsed, maxValue) : parsed;
  }

  private parsePositiveIntCsv(value: string | undefined, name: string): number[] | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value.trim() === '') {
      return [];
    }

    return value.split(',')
      .map(item => {
        const parsed = Number(item.trim());
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new BadRequestException(`${name} must contain positive integers`);
        }
        return parsed;
      });
  }

  private parseStringCsv(value: string | undefined): string[] | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value.trim() === '') {
      return [];
    }

    return value.split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  private parseBooleanQuery(value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    throw new BadRequestException('Boolean query values must be "true" or "false"');
  }

  private parseComparisonSortBy(value: string | undefined): TrainingComparisonSortBy | undefined {
    if (!value) {
      return undefined;
    }
    if ([
      'responseId',
      'unitName',
      'variableId',
      'personLogin',
      'personGroup',
      'bookletName'
    ].includes(value)) {
      return value as TrainingComparisonSortBy;
    }
    throw new BadRequestException('sortBy is not supported for training comparisons');
  }

  private parseComparisonSortDirection(value: string | undefined): TrainingComparisonSortDirection | undefined {
    if (!value) {
      return undefined;
    }
    if (value === 'asc' || value === 'desc') {
      return value;
    }
    throw new BadRequestException('sortDirection must be "asc" or "desc"');
  }

  private parseComparisonMatchFilter(value: string | undefined): TrainingComparisonMatchFilter | undefined {
    if (!value) {
      return undefined;
    }
    if (value === 'all' || value === 'match' || value === 'differ') {
      return value;
    }
    throw new BadRequestException('match must be one of "all", "match", or "differ"');
  }

  private parseComparisonNotesFilter(value: string | undefined): TrainingComparisonNotesFilter | undefined {
    if (!value) {
      return undefined;
    }
    if (value === 'all' || value === 'none' || value === 'with-notes') {
      return value;
    }
    throw new BadRequestException('notesMode must be one of "all", "none", or "with-notes"');
  }

  private buildComparisonFilters(
    unitName: string | undefined,
    variableId: string | undefined,
    personLogin: string | undefined,
    personGroup: string | undefined,
    bookletName: string | undefined,
    match: string | undefined,
    notesMode: string | undefined,
    regexSearch: string | undefined
  ): TrainingComparisonFiltersDto {
    return {
      unitName,
      variableId,
      personLogin,
      personGroup,
      bookletName,
      match: this.parseComparisonMatchFilter(match),
      notesMode: this.parseComparisonNotesFilter(notesMode),
      regexSearch: this.parseBooleanQuery(regexSearch)
    };
  }

  @Post(':workspace_id/coding/coder-training-packages')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'Generate coder training packages based on CODING_INCOMPLETE responses for specific variable and unit combinations',
    schema: {
      type: 'object',
      properties: {
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Coder training packages generated successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          coderId: { type: 'number' },
          coderName: { type: 'string' },
          responses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                responseId: { type: 'number' },
                unitAlias: { type: 'string' },
                variableId: { type: 'string' },
                unitName: { type: 'string' },
                value: { type: 'string' },
                personLogin: { type: 'string' },
                personCode: { type: 'string' },
                personGroup: { type: 'string' },
                bookletName: { type: 'string' },
                variable: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  async generateCoderTrainingPackages(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                       includeDeriveError?: boolean;
                     }[];
                   }
  ): Promise<
      {
        coderId: number;
        coderName: string;
        responses: {
          responseId: number;
          unitAlias: string;
          variableId: string;
          unitName: string;
          value: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
          bookletName: string;
          variable: string;
        }[];
      }[]
      > {
    return this.coderTrainingService.generateCoderTrainingPackages(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs
    );
  }

  @Get(':workspace_id/coding/coder-trainings')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of coder trainings retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Training ID' },
          workspace_id: { type: 'number', description: 'Workspace ID' },
          label: { type: 'string', description: 'Training label' },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Last update date'
          },
          jobsCount: {
            type: 'number',
            description: 'Number of coding jobs in this training'
          },
          case_ordering_mode: {
            type: 'string',
            enum: ['continuous', 'alternating'],
            description: 'Global case ordering mode for this training'
          },
          show_score: {
            type: 'boolean',
            description: 'Whether score values are shown in coding jobs created for this training'
          },
          allow_comments: {
            type: 'boolean',
            description: 'Whether comments are allowed in coding jobs created for this training'
          },
          suppress_general_instructions: {
            type: 'boolean',
            description: 'Whether general variable instructions are hidden in coding jobs created for this training'
          }
        }
      }
    }
  })
  async getCoderTrainings(@WorkspaceId() workspace_id: number): Promise<
  {
    id: number;
    workspace_id: number;
    label: string;
    created_at: Date;
    updated_at: Date;
    jobsCount: number;
    case_ordering_mode?: 'continuous' | 'alternating';
    case_selection_mode?: string;
    reference_training_ids?: number[];
    reference_mode?: string | null;
    show_score?: boolean;
    allow_comments?: boolean;
    suppress_general_instructions?: boolean;
  }[]
  > {
    return this.coderTrainingService.getCoderTrainings(workspace_id);
  }

  @Get(':workspace_id/coding/training-response-ids')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingIds',
    description: 'Comma-separated training IDs',
    required: true,
    example: '1,2,3'
  })
  @ApiOkResponse({
    description: 'Response IDs grouped by variable (unitAlias:variableId)',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'number' }
      },
      example: { 'unit1:var1': [1, 2, 3], 'unit1:var2': [4, 5, 6] }
    }
  })
  async getTrainingResponseIds(
    @WorkspaceId() workspace_id: number,
      @Query('trainingIds') trainingIdsParam: string
  ): Promise<Record<string, number[]>> {
    const trainingIds = trainingIdsParam ?
      trainingIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(n => !Number.isNaN(n)) :
      [];
    return this.coderTrainingService.getTrainingResponseIds(workspace_id, trainingIds);
  }

  @Post(':workspace_id/coding/coder-training-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create persistent coding jobs for coder training',
    schema: {
      type: 'object',
      properties: {
        trainingLabel: {
          type: 'string',
          description: 'Label for the coder training session'
        },
        missingsProfileId: {
          type: 'number',
          description:
            'ID of the missings profile to assign to all created coding jobs'
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        assignedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              sampleCount: { type: 'number' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        assignedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        showScore: {
          type: 'boolean',
          description: 'Whether score values are shown in coding jobs created for this training'
        },
        allowComments: {
          type: 'boolean',
          description: 'Whether comments are allowed in coding jobs created for this training'
        },
        suppressGeneralInstructions: {
          type: 'boolean',
          description: 'Whether general variable instructions are hidden in coding jobs created for this training'
        }
      },
      required: ['trainingLabel', 'selectedCoders', 'variableConfigs']
    }
  })
  @ApiOkResponse({
    description: 'Coding jobs created successfully for coder training',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              jobId: { type: 'number' },
              jobName: { type: 'string' }
            }
          }
        },
        trainingId: {
          type: 'number',
          description: 'ID of the created coder training session'
        }
      }
    }
  })
  async createCoderTrainingJobs(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     trainingLabel: string;
                     missingsProfileId?: number;
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                       includeDeriveError?: boolean;
                     }[];
                     assignedVariables?: JobDefinitionVariable[];
                     assignedVariableBundles?: JobDefinitionVariableBundle[];
                     caseOrderingMode?: 'continuous' | 'alternating';
                     caseSelectionMode?: 'oldest_first' | 'newest_first' | 'random' | 'random_per_testgroup' | 'random_testgroups';
                     referenceTrainingIds?: number[];
                     referenceMode?: 'same' | 'different';
                     showScore?: boolean;
                     allowComments?: boolean;
                     suppressGeneralInstructions?: boolean;
                   }
  ): Promise<{
        success: boolean;
        jobsCreated: number;
        message: string;
        jobs: {
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
        }[];
        trainingId?: number;
      }> {
    return this.coderTrainingService.createCoderTrainingJobs(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs,
      body.trainingLabel,
      body.missingsProfileId,
      body.assignedVariables,
      body.assignedVariableBundles,
      body.caseOrderingMode,
      body.caseSelectionMode,
      body.referenceTrainingIds,
      body.referenceMode,
      body.showScore,
      body.allowComments,
      body.suppressGeneralInstructions
    );
  }

  @Get(':workspace_id/coding/compare-training-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingIds',
    required: true,
    description: 'Comma-separated list of training IDs to compare',
    type: String
  })
  @ApiOkResponse({
    description: 'Comparison of coding results across training components',
    schema: createTrainingComparisonPageSchema(
      trainingCodingComparisonRowSchema,
      trainingComparisonCoderSchema
    )
  })
  async compareTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingIds') trainingIdsQuery: string | undefined,
      @Query('page') page: string | undefined,
      @Query('limit') limit: string | undefined,
      @Query('sortBy') sortBy: string | undefined,
      @Query('sortDirection') sortDirection: string | undefined,
      @Query('coderKeys') coderKeys: string | undefined,
      @Query('unitName') unitName: string | undefined,
      @Query('variableId') variableId: string | undefined,
      @Query('personLogin') personLogin: string | undefined,
      @Query('personGroup') personGroup: string | undefined,
      @Query('bookletName') bookletName: string | undefined,
      @Query('match') match: string | undefined,
      @Query('notesMode') notesMode: string | undefined,
      @Query('regexSearch') regexSearch: string | undefined
  ): Promise<TrainingCodingComparisonPageDto> {
    const trainingIds = this.parsePositiveIntCsv(trainingIdsQuery, 'trainingIds') ?? [];

    if (trainingIds.length === 0) {
      throw new BadRequestException('At least one valid training ID must be provided');
    }

    return this.coderTrainingService.getTrainingCodingComparisonPage(
      workspace_id,
      trainingIds,
      {
        page: this.parsePositiveIntQuery(page, 'page', 1),
        limit: this.parsePositiveIntQuery(limit, 'limit', 50, 500),
        sortBy: this.parseComparisonSortBy(sortBy),
        sortDirection: this.parseComparisonSortDirection(sortDirection),
        selectedCoderKeys: this.parseStringCsv(coderKeys),
        filters: this.buildComparisonFilters(
          unitName,
          variableId,
          personLogin,
          personGroup,
          bookletName,
          match,
          notesMode,
          regexSearch
        )
      }
    );
  }

  @Get(':workspace_id/coding/compare-within-training')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingId',
    required: true,
    description: 'ID of the training to compare coders within',
    type: Number
  })
  @ApiOkResponse({
    description:
      'Comparison of coding results within a single training by individual coders',
    schema: createTrainingComparisonPageSchema(
      withinTrainingCodingComparisonRowSchema,
      withinTrainingComparisonCoderSchema
    )
  })
  async compareWithinTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingId') trainingIdParam: string,
      @Query('page') page: string | undefined,
      @Query('limit') limit: string | undefined,
      @Query('sortBy') sortBy: string | undefined,
      @Query('sortDirection') sortDirection: string | undefined,
      @Query('jobIds') jobIds: string | undefined,
      @Query('unitName') unitName: string | undefined,
      @Query('variableId') variableId: string | undefined,
      @Query('personLogin') personLogin: string | undefined,
      @Query('personGroup') personGroup: string | undefined,
      @Query('bookletName') bookletName: string | undefined,
      @Query('match') match: string | undefined,
      @Query('notesMode') notesMode: string | undefined,
      @Query('regexSearch') regexSearch: string | undefined
  ): Promise<WithinTrainingCodingComparisonPageDto> {
    const trainingId = this.parsePositiveIntQuery(trainingIdParam, 'trainingId');
    if (!trainingId || trainingId <= 0) {
      throw new BadRequestException('Valid training ID must be provided');
    }

    return this.coderTrainingService.getWithinTrainingCodingComparisonPage(
      workspace_id,
      trainingId,
      {
        page: this.parsePositiveIntQuery(page, 'page', 1),
        limit: this.parsePositiveIntQuery(limit, 'limit', 50, 500),
        sortBy: this.parseComparisonSortBy(sortBy),
        sortDirection: this.parseComparisonSortDirection(sortDirection),
        selectedJobIds: this.parsePositiveIntCsv(jobIds, 'jobIds'),
        filters: this.buildComparisonFilters(
          unitName,
          variableId,
          personLogin,
          personGroup,
          bookletName,
          match,
          notesMode,
          regexSearch
        )
      }
    );
  }

  @Post(':workspace_id/coding/coder-trainings/:trainingId/discussion-result')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiBody({
    description: 'Persist or clear discussion result for a response in coder training comparison',
    schema: {
      type: 'object',
      properties: {
        responseId: { type: 'number' },
        code: { type: 'number', nullable: true },
        score: {
          type: 'number',
          nullable: true,
          description: 'Deprecated input; score is derived on the server from coding scheme, missings, or stored results.'
        },
        notes: { type: 'string', nullable: true }
      },
      required: ['responseId']
    }
  })
  async saveDiscussionResult(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: { responseId: number; code: number | null; score: number | null; notes?: string | null },
      @Req() req: Request
  ): Promise<{
        success: boolean;
        code: number | null;
        score: number | null;
        notes: string | null;
        source: 'manual' | 'auto_agreement' | null;
        managerUserId: number | null;
        managerName: string | null;
      }> {
    const reqUser = (req as Request & {
      user?: { id?: string | number; username?: string; preferred_username?: string; name?: string };
    }).user;
    const managerUserId = reqUser?.id !== undefined && reqUser?.id !== null ? Number(reqUser.id) : null;
    const managerName = reqUser?.preferred_username || reqUser?.username || reqUser?.name || null;

    return this.coderTrainingService.saveDiscussionResult(
      workspace_id,
      Number(trainingId),
      Number(body.responseId),
      Number.isNaN(managerUserId) ? null : managerUserId,
      managerName,
      body.code,
      body.notes
    );
  }

  @Post(':workspace_id/coding/coder-trainings/:trainingId/apply-discussion-results-preview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiBody({
    description: 'Preview applying training discussion results to final v2 response results.',
    schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['manual', 'auto_agreement']
        }
      },
      required: ['source']
    }
  })
  async previewApplyDiscussionResults(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body('source') source: TrainingDiscussionApplySource
  ): Promise<TrainingDiscussionApplyPreviewDto> {
    return this.coderTrainingResultsApplyService.previewTrainingDiscussionResults(
      workspace_id,
      Number(trainingId),
      source
    );
  }

  @Post(':workspace_id/coding/coder-trainings/:trainingId/apply-discussion-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiBody({
    description: 'Apply training discussion results to final v2 response results.',
    schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['manual', 'auto_agreement']
        },
        existingResultStrategy: {
          type: 'string',
          enum: ['skip', 'overwrite']
        },
        jobConflictStrategy: {
          type: 'string',
          enum: ['skip', 'removeFromJobs']
        }
      },
      required: ['source']
    }
  })
  async applyDiscussionResults(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: ApplyTrainingDiscussionResultsRequestDto
  ): Promise<ApplyTrainingDiscussionResultsResultDto> {
    return this.coderTrainingResultsApplyService.applyTrainingDiscussionResults(
      workspace_id,
      Number(trainingId),
      body
    );
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to update'
  })
  @ApiBody({
    description: 'Updated coder training configuration',
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        missingsProfileId: { type: 'number' },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        assignedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              sampleCount: { type: 'number' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        assignedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
        caseSelectionMode: { type: 'string', enum: ['oldest_first', 'newest_first', 'random', 'random_per_testgroup', 'random_testgroups'] },
        referenceTrainingIds: { type: 'array', items: { type: 'number' } },
        referenceMode: { type: 'string', enum: ['same', 'different'] },
        showScore: {
          type: 'boolean',
          description: 'Whether score values are shown in coding jobs created for this training'
        },
        allowComments: {
          type: 'boolean',
          description: 'Whether comments are allowed in coding jobs created for this training'
        },
        suppressGeneralInstructions: {
          type: 'boolean',
          description: 'Whether general variable instructions are hidden in coding jobs created for this training'
        }
      },
      required: ['label', 'selectedCoders', 'variableConfigs']
    }
  })
  @ApiOkResponse({
    description: 'Coder training updated successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        jobsCreated: { type: 'number' }
      }
    }
  })
  async updateCoderTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: {
        label: string;
        missingsProfileId?: number;
        selectedCoders: { id: number; name: string }[];
        variableConfigs: {
          variableId: string;
          unitId: string;
          sampleCount: number;
          includeDeriveError?: boolean;
        }[];
        assignedVariables?: JobDefinitionVariable[];
        assignedVariableBundles?: JobDefinitionVariableBundle[];
        caseOrderingMode?: 'continuous' | 'alternating';
        caseSelectionMode?: 'oldest_first' | 'newest_first' | 'random' | 'random_per_testgroup' | 'random_testgroups';
        referenceTrainingIds?: number[];
        referenceMode?: 'same' | 'different';
        showScore?: boolean;
        allowComments?: boolean;
        suppressGeneralInstructions?: boolean;
      }
  ): Promise<{ success: boolean; message: string; jobsCreated?: number }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.updateCoderTraining(
      workspace_id,
      trainingId,
      body.label,
      body.selectedCoders,
      body.variableConfigs,
      body.missingsProfileId,
      body.assignedVariables,
      body.assignedVariableBundles,
      body.caseOrderingMode,
      body.caseSelectionMode,
      body.referenceTrainingIds,
      body.referenceMode,
      body.showScore,
      body.allowComments,
      body.suppressGeneralInstructions
    );
  }

  @Get(':workspace_id/coding/coder-trainings/:trainingId/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiOkResponse({
    description: 'List of coding jobs for the specified coder training.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job ID' },
          name: { type: 'string', description: 'Job name' },
          description: { type: 'string', description: 'Job description' },
          status: { type: 'string', description: 'Job status' },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          coder: {
            type: 'object',
            properties: {
              userId: { type: 'number', description: 'Coder user ID' },
              username: { type: 'string', description: 'Coder username' }
            }
          },
          unitsCount: {
            type: 'number',
            description: 'Number of coding units in the job'
          }
        }
      }
    }
  })
  async getCodingJobsForTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<
      Array<{
        id: number;
        name: string;
        description?: string;
        status: string;
        created_at: Date;
        coder: {
          userId: number;
          username: string;
        };
        unitsCount: number;
      }>
      > {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.getCodingJobsForTraining(
      workspace_id,
      trainingId
    );
  }

  @Delete(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to delete'
  })
  @ApiOkResponse({
    description: 'Coder training deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the deletion was successful'
        },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })
  async deleteCoderTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.deleteCoderTraining(
      workspace_id,
      trainingId
    );
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId/label')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to update'
  })
  @ApiBody({
    description: 'New label for the coder training',
    schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'New label for the coder training'
        }
      },
      required: ['label']
    }
  })
  @ApiOkResponse({
    description: 'Coder training label updated successfully.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the update was successful'
        },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })
  async updateCoderTrainingLabel(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: { label: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    if (!body.label || body.label.trim().length === 0) {
      throw new Error('Valid label must be provided');
    }

    return this.coderTrainingService.updateCoderTrainingLabel(
      workspace_id,
      trainingId,
      body.label.trim()
    );
  }

  @Get(':workspace_id/coding/coder-trainings/:trainingId/comparison-freshness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiOkResponse({
    description: 'Freshness token for cached within-training comparison data',
    schema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'number' },
        trainingId: { type: 'number' },
        version: { type: 'string' },
        jobCount: { type: 'number' },
        unitCount: { type: 'number' },
        responseCount: { type: 'number' },
        discussionResultCount: { type: 'number' },
        latestTrainingChange: { type: 'string', nullable: true },
        latestJobChange: { type: 'string', nullable: true },
        latestUnitChange: { type: 'string', nullable: true },
        latestDiscussionChange: { type: 'string', nullable: true }
      }
    }
  })
  async getTrainingComparisonFreshness(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<TrainingComparisonFreshnessDto> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.getWithinTrainingComparisonFreshness(
      workspace_id,
      trainingId
    );
  }

  @Get([
    ':workspace_id/coding/coder-trainings/:trainingId/cohens-kappa',
    ':workspace_id/coding/coder-trainings/:trainingId/interrater-reliability'
  ])
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'level',
    required: false,
    enum: ['code', 'score'],
    description: 'Calculation level: code for code-level kappa (default), score for score-level kappa',
    type: String
  })
  @ApiOkResponse({
    description: 'Cohen, Brennan-Prediger and Fleiss inter-rater reliability statistics for the coder training',
    schema: {
      type: 'object',
      properties: {
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              meanKappa: { type: 'number', nullable: true },
              meanBrennanPredigerKappa: { type: 'number', nullable: true },
              fleissKappa: { type: 'number', nullable: true },
              fleissCaseCount: { type: 'number' },
              meanAgreement: { type: 'number', nullable: true },
              caseCount: { type: 'number', description: 'Distinct valid cases for this variable' },
              validPairCount: { type: 'number', description: 'Sum of valid pair values across coder pairs' },
              coderPairCount: { type: 'number', description: 'Coder pairs with valid values' },
              coderPairs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coder1Id: { type: 'number' },
                    coder1Name: { type: 'string' },
                    coder2Id: { type: 'number' },
                    coder2Name: { type: 'string' },
                    kappa: { type: 'number', nullable: true },
                    brennanPredigerKappa: { type: 'number', nullable: true },
                    agreement: { type: 'number' },
                    totalItems: { type: 'number' },
                    validPairs: { type: 'number' },
                    interpretation: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: { type: 'number' },
            totalCoderPairs: { type: 'number' },
            averageKappa: { type: 'number', nullable: true },
            averageBrennanPredigerKappa: { type: 'number', nullable: true },
            variablesIncluded: { type: 'number' },
            codersIncluded: { type: 'number' },
            weightingMethod: {
              type: 'string',
              enum: ['weighted', 'unweighted'],
              description: 'Method used to calculate mean kappa'
            },
            calculationLevel: {
              type: 'string',
              enum: ['code', 'score'],
              description: 'Value level used for kappa calculation'
            }
          }
        }
      }
    }
  })
  async getTrainingCohensKappa(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Query('weightedMean') weightedMean?: string,
      @Query('level') level?: 'code' | 'score',
      @Query('jobIds') jobIds?: string
  ): Promise<TrainingCohensKappaStatistics> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    const useWeightedMean = weightedMean !== 'false'; // Default true
    const calculationLevel = level || 'code'; // Default to code level
    const selectedJobIds = this.parsePositiveIntCsv(jobIds, 'jobIds');

    return this.coderTrainingService.getWithinTrainingCohensKappa(workspace_id, trainingId, {
      weightedMean: useWeightedMean,
      level: calculationLevel,
      selectedJobIds
    });
  }
}
