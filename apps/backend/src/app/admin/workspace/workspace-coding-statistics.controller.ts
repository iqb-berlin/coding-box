import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Body,
  Logger
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
import {
  CodingStatisticsService,
  CodingJobService,
  CodingProgressService,
  CodingReviewService,
  CodingFreshnessService,
  CodingProcessService
} from '../../database/services/coding';
import { PersonService } from '../../database/services/test-results';
import { CodingStatistics } from '../../database/services/shared';
import {
  CodingFreshnessJobResultDto,
  CodingFreshnessScopeDto,
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessVersion,
  StartCodingFreshnessJobDto
} from '../../../../../../api-dto/coding/coding-freshness.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';

type CodingStatisticsJobStatusResponse = {
  status: string;
  progress: number;
  result?: CodingStatistics;
  error?: string;
};

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingStatisticsController {
  private readonly logger = new Logger(WorkspaceCodingStatisticsController.name);
  constructor(
    private codingStatisticsService: CodingStatisticsService,
    private codingJobService: CodingJobService,
    private personService: PersonService,
    private codingProgressService: CodingProgressService,
    private codingReviewService: CodingReviewService,
    private codingFreshnessService: CodingFreshnessService,
    private codingProcessService: CodingProcessService,
    private jobQueueService: JobQueueService
  ) { }

  @Get(':workspace_id/coding/statistics')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to get statistics for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async getCodingStatistics(
    @WorkspaceId() workspace_id: number,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<CodingStatistics> {
    return this.codingStatisticsService.getCodingStatistics(
      workspace_id,
      version
    );
  }

  @Get(':workspace_id/coding/freshness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding freshness summary retrieved successfully.'
  })
  async getCodingFreshnessSummary(
    @WorkspaceId() workspace_id: number
  ): Promise<CodingFreshnessSummaryDto> {
    return this.codingFreshnessService.getSummary(workspace_id);
  }

  @Get(':workspace_id/coding/freshness/scope')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version(s) to include. Supports comma-separated values.',
    enum: ['v1', 'v2', 'v3']
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Freshness state(s) to include. Supports comma-separated values.',
    enum: ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED']
  })
  @ApiOkResponse({
    description: 'Coding freshness scope retrieved successfully.'
  })
  async getCodingFreshnessScope(
    @WorkspaceId() workspace_id: number,
      @Query('version') version?: string | string[],
      @Query('state') state?: string | string[]
  ): Promise<CodingFreshnessScopeDto> {
    return this.codingFreshnessService.getScope(
      workspace_id,
      this.parseVersions(version),
      this.parseStates(state)
    );
  }

  @Post(':workspace_id/coding/freshness/code')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version'],
      properties: {
        version: { type: 'string', enum: ['v1', 'v3'] },
        states: {
          type: 'array',
          items: { type: 'string', enum: ['PENDING', 'STALE'] }
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Coding freshness auto-coding job created successfully.'
  })
  async codeFreshnessScope(
    @WorkspaceId() workspace_id: number,
      @Body() body: StartCodingFreshnessJobDto
  ): Promise<CodingFreshnessJobResultDto> {
    await this.jobQueueService.assertNoDependencyConflicts('test-person-coding', workspace_id);

    const version = body.version === 'v3' ? 'v3' : 'v1';
    const states = this.parseCodingStates(body.states);
    const scope = await this.codingFreshnessService.getScope(
      workspace_id,
      [version],
      states
    );

    if (scope.unitIds.length === 0 || scope.personIds.length === 0) {
      return {
        totalResponses: 0,
        statusCounts: {},
        message: 'No coding freshness units need auto-coding.',
        unitCount: 0,
        personCount: 0,
        groupNames: []
      };
    }

    const result = await this.codingProcessService.codeUnitIds(
      workspace_id,
      scope.unitIds,
      version === 'v3' ? 2 : 1,
      {
        source: 'coding-freshness',
        freshnessVersion: version,
        freshnessStates: states,
        groupNames: scope.groupNames.join(',')
      }
    );

    return {
      ...result,
      unitCount: scope.unitCount,
      personCount: scope.personCount,
      groupNames: scope.groupNames
    };
  }

  @Post(':workspace_id/coding/statistics/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics job created successfully.',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to calculate statistics for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
  })
  async createCodingStatisticsJob(
    @WorkspaceId() workspace_id: number,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1'
  ): Promise<{ jobId: string; message: string }> {
    return this.codingStatisticsService.createCodingStatisticsJob(workspace_id, version);
  }

  @Get(':workspace_id/coding/statistics/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the coding statistics job' })
  @ApiOkResponse({
    description: 'Coding statistics job status retrieved successfully.'
  })
  async getCodingStatisticsJobStatus(
    @Param('jobId') jobId: string
  ): Promise<CodingStatisticsJobStatusResponse | { error: string }> {
    const status = await this.codingStatisticsService.getCodingStatisticsJobStatus(jobId);
    if (!status) {
      return { error: `Coding statistics job with ID ${jobId} not found` };
    }
    return status;
  }

  private parseVersions(value?: string | string[]): CodingFreshnessVersion[] {
    const allowed = new Set<CodingFreshnessVersion>(['v1', 'v2', 'v3']);
    const values = this.parseArrayQuery(value);
    const versions = values.filter((item): item is CodingFreshnessVersion => (
      allowed.has(item as CodingFreshnessVersion)
    ));
    return versions.length > 0 ? versions : ['v1', 'v2', 'v3'];
  }

  private parseStates(value?: string | string[]): CodingFreshnessState[] {
    const allowed = new Set<CodingFreshnessState>([
      'PENDING',
      'STALE',
      'MANUAL_REVIEW_REQUIRED'
    ]);
    const values = this.parseArrayQuery(value);
    const states = values.filter((item): item is CodingFreshnessState => (
      allowed.has(item as CodingFreshnessState)
    ));
    return states.length > 0 ? states : ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED'];
  }

  private parseCodingStates(
    states?: Extract<CodingFreshnessState, 'PENDING' | 'STALE'>[]
  ): Extract<CodingFreshnessState, 'PENDING' | 'STALE'>[] {
    const allowed = new Set<Extract<CodingFreshnessState, 'PENDING' | 'STALE'>>([
      'PENDING',
      'STALE'
    ]);
    const values = (states || []).filter(state => allowed.has(state));
    return values.length > 0 ? values : ['PENDING', 'STALE'];
  }

  private parseArrayQuery(value?: string | string[]): string[] {
    const rawValues = Array.isArray(value) ? value : [value || ''];
    return rawValues
      .flatMap(item => String(item).split(','))
      .map(item => item.trim())
      .filter(item => item !== '');
  }

  @Get(':workspace_id/coding/groups')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Group name'
      }
    }
  })
  async getWorkspaceGroups(
    @WorkspaceId() workspace_id: number
  ): Promise<string[]> {
    return this.personService.getWorkspaceGroups(workspace_id);
  }

  @Get(':workspace_id/coding/groups/stats')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'List of all test person groups in the workspace with coding statistics.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupName: { type: 'string', description: 'Group name' },
          testPersonCount: {
            type: 'number',
            description: 'Number of test persons in this group'
          },
          responsesToCode: {
            type: 'number',
            description:
              'Number of responses that still need to be coded for this group'
          }
        }
      }
    }
  })
  async getWorkspaceGroupCodingStats(
    @WorkspaceId() workspace_id: number
  ): Promise<
      { groupName: string; testPersonCount: number; responsesToCode: number }[]
      > {
    return this.personService.getWorkspaceGroupCodingStats(workspace_id);
  }

  @Get(':workspace_id/coding/progress-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding progress overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Total number of cases that need to be coded'
        },
        completedCases: {
          type: 'number',
          description:
            'Number of cases that have been completed through coding jobs'
        },
        completionPercentage: {
          type: 'number',
          description: 'Percentage of coding completion after duplicate aggregation'
        },
        rawTotalCasesToCode: {
          type: 'number',
          description: 'Raw total number of cases before duplicate aggregation'
        },
        rawCompletedCases: {
          type: 'number',
          description: 'Raw number of completed cases before duplicate aggregation'
        },
        rawCompletionPercentage: {
          type: 'number',
          description: 'Raw percentage of coding completion before duplicate aggregation'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Current duplicate aggregation threshold'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw responses collapsed by duplicate aggregation'
        }
      }
    }
  })
  async getCodingProgressOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalCasesToCode: number;
        completedCases: number;
        completionPercentage: number;
        rawTotalCasesToCode: number;
        rawCompletedCases: number;
        rawCompletionPercentage: number;
        aggregationActive: boolean;
        aggregationThreshold: number | null;
        aggregatedDuplicateCases: number;
      }> {
    return this.codingProgressService.getCodingProgressOverview(workspace_id);
  }

  @Get(':workspace_id/coding/applied-results-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Applied results overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalIncompleteResponses: {
          type: 'number',
          description: 'Total cases after duplicate aggregation'
        },
        appliedResponses: {
          type: 'number',
          description: 'Applied result cases after duplicate aggregation'
        },
        remainingResponses: {
          type: 'number',
          description: 'Remaining result cases after duplicate aggregation'
        },
        completionPercentage: {
          type: 'number',
          description: 'Applied results completion percentage after duplicate aggregation'
        },
        rawTotalIncompleteResponses: {
          type: 'number',
          description: 'Raw total responses before duplicate aggregation'
        },
        rawAppliedResponses: {
          type: 'number',
          description: 'Raw applied responses before duplicate aggregation'
        },
        rawCompletionPercentage: {
          type: 'number',
          description: 'Raw applied results completion percentage before duplicate aggregation'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Current duplicate aggregation threshold'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw responses collapsed by duplicate aggregation'
        }
      }
    }
  })
  async getAppliedResultsOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalIncompleteResponses: number;
        appliedResponses: number;
        remainingResponses: number;
        completionPercentage: number;
        rawTotalIncompleteResponses: number;
        rawAppliedResponses: number;
        rawCompletionPercentage: number;
        aggregationActive: boolean;
        aggregationThreshold: number | null;
        aggregatedDuplicateCases: number;
      }> {
    return this.codingProgressService.getAppliedResultsOverview(workspace_id);
  }

  @Get(':workspace_id/coding/case-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Case coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalCasesToCode: {
          type: 'number',
          description: 'Raw total number of cases that need to be coded'
        },
        effectiveTotalCasesToCode: {
          type: 'number',
          description: 'Total number of cases after duplicate aggregation is applied'
        },
        casesInJobs: {
          type: 'number',
          description: 'Number of cases assigned to coding jobs'
        },
        effectiveCasesInJobs: {
          type: 'number',
          description: 'Number of aggregation-adjusted cases covered by coding jobs'
        },
        doubleCodedCases: {
          type: 'number',
          description: 'Number of cases that are double-coded'
        },
        singleCodedCases: {
          type: 'number',
          description: 'Number of cases that are single-coded'
        },
        unassignedCases: {
          type: 'number',
          description: 'Raw number of cases not assigned to any coding job'
        },
        effectiveUnassignedCases: {
          type: 'number',
          description: 'Number of aggregation-adjusted cases not assigned to any coding job'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of aggregation-adjusted cases covered by coding jobs'
        },
        rawCoveragePercentage: {
          type: 'number',
          description: 'Percentage of raw cases covered by coding jobs'
        },
        aggregationActive: {
          type: 'boolean',
          description: 'Whether duplicate aggregation is active for this workspace'
        },
        aggregationThreshold: {
          type: 'number',
          nullable: true,
          description: 'Duplicate aggregation threshold, or null when disabled'
        },
        aggregatedDuplicateCases: {
          type: 'number',
          description: 'Number of raw cases collapsed by duplicate aggregation'
        }
      }
    }
  })
  async getCaseCoverageOverview(@WorkspaceId() workspace_id: number): Promise<{
    totalCasesToCode: number;
    effectiveTotalCasesToCode: number;
    casesInJobs: number;
    effectiveCasesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    effectiveUnassignedCases: number;
    coveragePercentage: number;
    rawCoveragePercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
  }> {
    return this.codingProgressService.getCaseCoverageOverview(workspace_id);
  }

  @Get(':workspace_id/coding/variable-coverage-overview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Variable coverage overview retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        totalVariables: {
          type: 'number',
          description: 'Total number of potential variables from unit XML files'
        },
        coveredVariables: {
          type: 'number',
          description: 'Total number of variables covered by job definitions'
        },
        coveredByDraft: {
          type: 'number',
          description: 'Number of variables covered by draft job definitions'
        },
        coveredByPendingReview: {
          type: 'number',
          description:
            'Number of variables covered by pending review job definitions'
        },
        coveredByApproved: {
          type: 'number',
          description: 'Number of variables covered by approved job definitions'
        },
        conflictedVariables: {
          type: 'number',
          description:
            'Number of variables assigned to multiple job definitions'
        },
        missingVariables: {
          type: 'number',
          description: 'Number of variables not covered by job definitions'
        },
        partiallyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with partial case coverage'
        },
        fullyAbgedeckteVariablen: {
          type: 'number',
          description: 'Number of variables with full case coverage'
        },
        coveragePercentage: {
          type: 'number',
          description: 'Percentage of variables covered by job definitions'
        },
        variableCaseCounts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Unit name' },
              variableId: { type: 'string', description: 'Variable ID' },
              caseCount: {
                type: 'number',
                description: 'Number of coding cases for this variable'
              }
            }
          },
          description: 'List of all variables with their case counts'
        },
        coverageByStatus: {
          type: 'object',
          properties: {
            draft: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by draft definitions'
            },
            pending_review: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by pending review definitions'
            },
            approved: {
              type: 'array',
              items: { type: 'string' },
              description: 'Variables covered by approved definitions'
            },
            conflicted: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  variableKey: {
                    type: 'string',
                    description: 'Variable key in format unitName:variableId'
                  },
                  conflictingDefinitions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: {
                          type: 'number',
                          description: 'Job definition ID'
                        },
                        status: {
                          type: 'string',
                          description: 'Job definition status'
                        }
                      }
                    }
                  }
                }
              },
              description:
                'Variables assigned to multiple definitions with conflict details'
            }
          },
          description: 'Coverage breakdown by job definition status'
        }
      }
    }
  })
  async getVariableCoverageOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
        totalVariables: number;
        coveredVariables: number;
        coveredByDraft: number;
        coveredByPendingReview: number;
        coveredByApproved: number;
        conflictedVariables: number;
        missingVariables: number;
        partiallyAbgedeckteVariablen: number;
        fullyAbgedeckteVariablen: number;
        coveragePercentage: number;
        variableCaseCounts: {
          unitName: string;
          variableId: string;
          caseCount: number;
        }[];
        coverageByStatus: {
          draft: string[];
          pending_review: string[];
          approved: string[];
          conflicted: Array<{
            variableKey: string;
            conflictingDefinitions: Array<{
              id: number;
              status: string;
            }>;
          }>;
        };
      }> {
    return this.codingProgressService.getVariableCoverageOverview(
      workspace_id
    );
  }

  @Get(':workspace_id/coding/cohens-kappa')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa statistics for double-coded variables with workspace summary.",
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
            variablesIncluded: { type: 'number' },
            codersIncluded: { type: 'number' },
            weightingMethod: {
              type: 'string',
              enum: ['weighted', 'unweighted'],
              description: 'Method used to calculate mean kappa'
            }
          }
        }
      }
    }
  })
  async getCohensKappaStatistics(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean?: string,
      @Query('unitName') unitName?: string,
      @Query('variableId') variableId?: string,
      @Query('excludeTrainings') excludeTrainings?: string
  ): Promise<{
        variables: Array<{
          unitName: string;
          variableId: string;
          coderPairs: Array<{
            coder1Id: number;
            coder1Name: string;
            coder2Id: number;
            coder2Name: string;
            kappa: number | null;
            agreement: number;
            totalItems: number;
            validPairs: number;
            interpretation: string;
          }>;
        }>;
        workspaceSummary: {
          totalDoubleCodedResponses: number;
          totalCoderPairs: number;
          averageKappa: number | null;
          variablesIncluded: number;
          codersIncluded: number;
          weightingMethod: 'weighted' | 'unweighted';
        };
      }> {
    try {
      this.logger.log(
        `Calculating Cohen's Kappa for workspace ${workspace_id}${unitName ? `, unit: ${unitName}` : ''
        }${variableId ? `, variable: ${variableId}` : ''}`
      );

      // Get all double-coded data
      const isExcludeTrainings = excludeTrainings !== 'false'; // Default true
      const allDoubleCodedItems = [];
      let currentPage = 1;
      const batchSize = 1000;
      let hasMore = true;
      let totalItemsData = 0;

      while (hasMore) {
        const doubleCodedData = await this.codingReviewService.getDoubleCodedVariablesForReview(
          workspace_id,
          currentPage,
          batchSize,
          false, // onlyConflicts = false (needed for correct Kappa calculation)
          isExcludeTrainings
        );

        if (currentPage === 1) {
          totalItemsData = doubleCodedData.total;
        }

        if (doubleCodedData.data.length > 0) {
          allDoubleCodedItems.push(...doubleCodedData.data);
        }

        if (allDoubleCodedItems.length >= totalItemsData || doubleCodedData.data.length === 0) {
          hasMore = false;
        } else {
          currentPage += 1;
        }
      }

      // Group by unit and variable
      const groupedData = new Map<
      string,
      Array<{
        unitName: string;
        variableId: string;
        personLogin: string;
        personCode: string;
        coderResults: Array<{
          coderId: number;
          coderName: string;
          jobId: number;
          code: number | null;
          score: number | null;
          notes: string | null;
          codedAt: Date;
        }>;
      }>
      >();

      allDoubleCodedItems.forEach(item => {
        // Apply filters if provided
        if (unitName && item.unitName !== unitName) return;
        if (variableId && item.variableId !== variableId) return;

        const key = `${item.unitName}:${item.variableId}`;
        if (!groupedData.has(key)) {
          groupedData.set(key, []);
        }
        groupedData.get(key)!.push(item);
      });

      const variables = [];
      const allKappaResults: Array<{ kappa: number | null }> = [];
      const uniqueVariables = new Set<string>();
      const uniqueCoders = new Set<number>();

      for (const [key, items] of groupedData.entries()) {
        const [unitNameKey, variableIdKey] = key.split(':');

        uniqueVariables.add(key);

        // Get all unique coders for this unit/variable combination
        const allCoders = new Set<number>();
        items.forEach(item => {
          item.coderResults.forEach(cr => {
            allCoders.add(cr.coderId);
            uniqueCoders.add(cr.coderId);
          });
        });

        const coderArray = Array.from(allCoders);
        const coderPairs = [];

        // Calculate Kappa for each pair of coders
        for (let i = 0; i < coderArray.length; i++) {
          for (let j = i + 1; j < coderArray.length; j++) {
            const coder1Id = coderArray[i];
            const coder2Id = coderArray[j];

            // Find coder names
            let coder1Name = '';
            let coder2Name = '';
            items.forEach(item => {
              item.coderResults.forEach(cr => {
                if (cr.coderId === coder1Id) coder1Name = cr.coderName;
                if (cr.coderId === coder2Id) coder2Name = cr.coderName;
              });
            });

            // Collect coding pairs for these two coders
            const codes = [];
            items.forEach(item => {
              const coder1Result = item.coderResults.find(
                cr => cr.coderId === coder1Id
              );
              const coder2Result = item.coderResults.find(
                cr => cr.coderId === coder2Id
              );

              if (coder1Result && coder2Result) {
                codes.push({
                  code1: coder1Result.code,
                  code2: coder2Result.code
                });
              }
            });

            if (codes.length > 0) {
              coderPairs.push({
                coder1Id,
                coder1Name,
                coder2Id,
                coder2Name,
                codes
              });
            }
          }
        }

        if (coderPairs.length > 0) {
          // Calculate Cohen's Kappa for all pairs
          const kappaResults =
            this.codingStatisticsService.calculateCohensKappa(coderPairs);

          // Collect all kappa results for later averaging
          allKappaResults.push(...kappaResults);

          variables.push({
            unitName: unitNameKey,
            variableId: variableIdKey,
            coderPairs: kappaResults
          });
        }
      }

      // Calculate workspace summary by averaging all collected kappa values
      let totalKappa = 0;
      let validKappaCount = 0;
      allKappaResults.forEach(result => {
        if (result.kappa !== null && !Number.isNaN(result.kappa)) {
          totalKappa += result.kappa;
          validKappaCount += 1;
        }
      });

      // Calculate workspace summary - return 0 instead of null when no valid kappa values
      const averageKappa =
        validKappaCount > 0 ?
          Math.round((totalKappa / validKappaCount) * 1000) / 1000 :
          0;

      const useWeightedMean = weightedMean !== 'false'; // Default true
      const workspaceSummary = {
        totalDoubleCodedResponses: totalItemsData,
        totalCoderPairs: validKappaCount,
        averageKappa,
        variablesIncluded: uniqueVariables.size,
        codersIncluded: uniqueCoders.size,
        weightingMethod: (useWeightedMean ? 'weighted' : 'unweighted') as 'weighted' | 'unweighted'
      };

      this.logger.log(
        `Calculated Cohen's Kappa for ${variables.length} unit/variable combinations in workspace ${workspace_id}, average kappa: ${averageKappa}`
      );

      return {
        variables,
        workspaceSummary
      };
    } catch (error) {
      this.logger.error(
        `Error calculating Cohen's Kappa: ${error.message}`,
        error.stack
      );
      throw new Error(
        "Could not calculate Cohen's Kappa statistics. Please check the database connection."
      );
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/workspace-summary')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'weightedMean',
    required: false,
    description: 'Use weighted mean (default: true, matching R eatPrep implementation)',
    type: Boolean
  })
  @ApiQuery({
    name: 'excludeTrainings',
    required: false,
    description: 'Exclude coder training jobs (default: true)',
    type: Boolean
  })
  @ApiOkResponse({
    description:
      "Workspace-wide Cohen's Kappa statistics for double-coded incomplete variables.",
    schema: {
      type: 'object',
      properties: {
        coderPairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coder1Id: { type: 'number', description: 'First coder ID' },
              coder1Name: { type: 'string', description: 'First coder name' },
              coder2Id: { type: 'number', description: 'Second coder ID' },
              coder2Name: { type: 'string', description: 'Second coder name' },
              kappa: {
                type: 'number',
                nullable: true,
                description: "Cohen's Kappa coefficient"
              },
              agreement: {
                type: 'number',
                description: 'Observed agreement percentage'
              },
              totalSharedResponses: {
                type: 'number',
                description: 'Total responses coded by both coders'
              },
              validPairs: {
                type: 'number',
                description: 'Number of valid coding pairs'
              },
              interpretation: {
                type: 'string',
                description: 'Interpretation of the Kappa value'
              }
            }
          },
          description:
            "Cohen's Kappa statistics for each coder pair across all double-coded work"
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: {
              type: 'number',
              description: 'Total number of double-coded responses'
            },
            totalCoderPairs: {
              type: 'number',
              description: 'Total number of coder pairs analyzed'
            },
            averageKappa: {
              type: 'number',
              nullable: true,
              description: "Average Cohen's Kappa across all coder pairs"
            },
            variablesIncluded: {
              type: 'number',
              description: 'Number of variables included in the analysis'
            },
            codersIncluded: {
              type: 'number',
              description: 'Number of coders included in the analysis'
            },
            weightingMethod: {
              type: 'string',
              enum: ['weighted', 'unweighted'],
              description: 'Method used to calculate mean kappa'
            }
          },
          description: 'Summary statistics for the entire workspace'
        }
      }
    }
  })
  async getWorkspaceCohensKappaSummary(
    @WorkspaceId() workspace_id: number,
      @Query('weightedMean') weightedMean?: string,
      @Query('excludeTrainings') excludeTrainings?: string
  ): Promise<{
        coderPairs: Array<{
          coder1Id: number;
          coder1Name: string;
          coder2Id: number;
          coder2Name: string;
          kappa: number | null;
          agreement: number;
          totalSharedResponses: number;
          validPairs: number;
          interpretation: string;
        }>;
        workspaceSummary: {
          totalDoubleCodedResponses: number;
          totalCoderPairs: number;
          averageKappa: number | null;
          variablesIncluded: number;
          codersIncluded: number;
          weightingMethod: 'weighted' | 'unweighted';
        };
      }> {
    const useWeightedMean = weightedMean !== 'false'; // Default true
    const isExcludeTrainings = excludeTrainings !== 'false'; // Default true
    return this.codingReviewService.getWorkspaceCohensKappaSummary(
      workspace_id,
      useWeightedMean,
      isExcludeTrainings
    );
  }

  @Post(':workspace_id/coding/calculate-distribution')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Calculate distribution for coding jobs (preview mode)',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distribution calculated successfully.',
    schema: {
      type: 'object',
      properties: {
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        }
      }
    }
  })
  async calculateDistribution(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       variables: { unitName: string; variableId: string }[];
                     }[];
                     selectedCoders: { id: number; name: string; username: string }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                   }
  ): Promise<{
        distribution: Record<string, Record<string, number>>;
        doubleCodingInfo: Record<
        string,
        {
          totalCases: number;
          doubleCodedCases: number;
          singleCodedCasesAssigned: number;
          doubleCodedCasesPerCoder: Record<string, number>;
        }
        >;
      }> {
    return this.codingJobService.calculateDistribution(workspace_id, body);
  }

  @Post(':workspace_id/coding/create-distributed-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create distributed coding jobs with equal case distribution',
    schema: {
      type: 'object',
      properties: {
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' }
            }
          }
        },
        doubleCodingAbsolute: { type: 'number' },
        doubleCodingPercentage: { type: 'number' },
        jobDefinitionId: { type: 'number' }
      },
      required: ['selectedVariables', 'selectedCoders']
    }
  })
  @ApiOkResponse({
    description: 'Distributed coding jobs created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        distribution: {
          type: 'object',
          description: 'Case distribution matrix',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          description: 'Double coding information',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              variable: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  variableId: { type: 'string' }
                }
              },
              jobId: { type: 'number' },
              jobName: { type: 'string' },
              caseCount: { type: 'number' }
            }
          }
        }
      }
    }
  })
  async createDistributedCodingJobs(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedVariables: { unitName: string; variableId: string }[];
                     selectedVariableBundles?: {
                       id: number;
                       name: string;
                       caseOrderingMode?: 'continuous' | 'alternating';
                       variables: { unitName: string; variableId: string }[];
                     }[];
                     selectedCoders: { id: number; name: string; username: string }[];
                     doubleCodingAbsolute?: number;
                     doubleCodingPercentage?: number;
                     caseOrderingMode?: 'continuous' | 'alternating';
                     maxCodingCases?: number;
                     jobDefinitionId?: number;
                   }
  ): Promise<{
        success: boolean;
        jobsCreated: number;
        message: string;
        distribution: Record<string, Record<string, number>>;
        doubleCodingInfo: Record<
        string,
        {
          totalCases: number;
          doubleCodedCases: number;
          singleCodedCasesAssigned: number;
          doubleCodedCasesPerCoder: Record<string, number>;
        }
        >;
        jobs: Array<{
          coderId: number;
          coderName: string;
          variable: { unitName: string; variableId: string };
          jobId: number;
          jobName: string;
          caseCount: number;
        }>;
      }> {
    return this.codingJobService.createDistributedCodingJobs(workspace_id, body);
  }
}
