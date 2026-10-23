import {
  Controller, Get, Param, Post, Query, Req, UseGuards, Logger, BadRequestException, Res
} from '@nestjs/common';
import {
  ApiOkResponse, ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { ValidatedBody } from '../../http/validated-body.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  CodingStatisticsService,
  CodingJobService,
  CodingProgressService,
  AutoCodingRunGuardService,
  DoubleCodingReviewQueryService,
  CodingFreshnessService,
  CodingProcessService,
  CodingReadinessService
} from '../../database/services/coding';
import { PersonService } from '../../database/services/test-results';
import { CodingStatistics } from '../../database/services/shared';
import {
  CodingFreshnessJobResultDto, CodingFreshnessScopeDto, CodingFreshnessState, CodingFreshnessSummaryDto, CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';
import { AutocodingReadinessDto } from '../../../../../../api-dto/coding/autocoding-readiness.dto';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CohensKappaStatisticsService } from '../../database/services/coding/cohens-kappa-statistics.service';
import { CohensKappaExportService } from '../../database/services/coding/cohens-kappa-export.service';
import {
  KappaCalculationLevel,
  KappaStatisticsBuildResult,
  KappaStatisticsOptions,
  KappaStatisticsResponse
} from '../../database/services/coding/cohens-kappa.types';
import { DistributionPreviewLimiterService } from '../workspace-coding/distribution-preview-limiter.service';

type CodingStatisticsJobStatusResponse = {
  status: string;
  progress: number;
  result?: CodingStatistics;
  error?: string;
};

type DistributionDoubleCodingInfoResponse = {
  totalCases: number;
  distinctCases?: number;
  codingTasksTotal?: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoder: Record<string, number>;
  doubleCodedCasesPerCoderId?: Record<string, number>;
};

type DistributionCalculationResponse = {
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfoResponse>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: string[];
  warnings: Array<{
    unitName: string;
    variableId: string;
    message: string;
    casesInJobs: number;
    availableCases: number;
  }>;
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
};

type DistributedCodingJobsResponse = DistributionCalculationResponse & {
  success: boolean;
  jobsCreated: number;
  message: string;
  jobs: Array<{
    itemKey: string;
    coderId: number;
    coderName: string;
    variable: { unitName: string; variableId: string };
    jobId: number;
    jobName: string;
    caseCount: number;
  }>;
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
    private doubleCodingReviewQueryService: DoubleCodingReviewQueryService,
    private codingFreshnessService: CodingFreshnessService,
    private autoCodingRunGuardService: AutoCodingRunGuardService,
    private codingProcessService: CodingProcessService,
    private codingReadinessService: CodingReadinessService,
    private readonly cohensKappaStatisticsService: CohensKappaStatisticsService,
    private readonly cohensKappaExportService: CohensKappaExportService,
    private jobQueueService: JobQueueService,
    private distributionPreviewLimiterService: DistributionPreviewLimiterService
  ) { }

  private toPublicCohensKappaStatistics(
    statistics: KappaStatisticsBuildResult
  ): KappaStatisticsResponse {
    return {
      variables: statistics.variables,
      workspaceSummary: statistics.workspaceSummary
    };
  }

  private getServerUrlFromRequest(req?: Request): string {
    if (!req) {
      return '';
    }

    const forwardedProtocol = req.get?.('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProtocol || req.protocol || (req.secure ? 'https' : 'http');
    const headerHost = req.get?.('host') ?? req.headers.host;
    const host = Array.isArray(headerHost) ? headerHost[0] : headerHost;
    return host ? `${protocol}://${host}` : '';
  }

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

  @Get(':workspace_id/coding/readiness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'autoCoderRun',
    required: false,
    description: 'Autocoder run to validate.',
    enum: [1, 2]
  })
  @ApiQuery({
    name: 'forceRefresh',
    required: false,
    description: 'Ignore the readiness cache and recalculate.'
  })
  @ApiQuery({
    name: 'cacheOnly',
    required: false,
    description: 'Return cached readiness only and do not recalculate.'
  })
  @ApiOkResponse({
    description: 'Auto-coding readiness diagnostics retrieved successfully.'
  })
  async getAutocodingReadiness(
    @WorkspaceId() workspace_id: number,
    @Query('autoCoderRun') autoCoderRun?: string | string[],
    @Query('forceRefresh') forceRefresh?: string | string[],
    @Query('cacheOnly') cacheOnly?: string | string[]
  ): Promise<AutocodingReadinessDto | null> {
    const options = {
      autoCoderRun: this.parseAutoCoderRun(autoCoderRun),
      forceRefresh: this.parseBooleanQuery(forceRefresh)
    };

    if (this.parseBooleanQuery(cacheOnly)) {
      return this.codingReadinessService.getReadinessFromCache(workspace_id, options);
    }

    return this.codingReadinessService.getReadiness(workspace_id, options);
  }

  @Post(':workspace_id/coding/freshness/code')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })

  @ApiOkResponse({
    description: 'Coding freshness auto-coding job created successfully.'
  })
  async codeFreshnessScope(
    @WorkspaceId() workspace_id: number,
    @ValidatedBody('StartCodingFreshnessJobDto') body: RequestBody<'StartCodingFreshnessJobDto'>
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

    await this.autoCodingRunGuardService.assertAutoCodingRunCanStart(
      workspace_id,
      version === 'v3' ? 2 : 1
    );

    const result = await this.codingProcessService.codeUnitIds(
      workspace_id,
      scope.unitIds,
      version === 'v3' ? 2 : 1,
      {
        source: 'coding-freshness',
        freshnessVersion: version,
        freshnessStates: states,
        freshnessSourceRevision: scope.currentRevision,
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
    @WorkspaceId() workspaceId: number,
    @Param('jobId') jobId: string
  ): Promise<CodingStatisticsJobStatusResponse | { error: string }> {
    const status = await this.codingStatisticsService.getCodingStatisticsJobStatus(jobId, workspaceId);
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

  private parseAutoCoderRun(value?: string | string[]): 1 | 2 {
    const values = this.parseArrayQuery(value);
    if (values.length === 0) {
      return 1;
    }
    if (values.length > 1) {
      throw new BadRequestException('autoCoderRun must be provided only once');
    }
    const numericValue = Number(values[0]);
    if (numericValue === 1 || numericValue === 2) {
      return numericValue;
    }
    throw new BadRequestException('autoCoderRun must be 1 or 2');
  }

  private parseBooleanQuery(value?: string | string[]): boolean {
    const values = this.parseArrayQuery(value);
    if (values.length === 0) {
      return false;
    }
    if (values.length > 1) {
      throw new BadRequestException('Boolean query value must be provided only once');
    }

    const normalized = values[0].toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', ''].includes(normalized)) {
      return false;
    }
    throw new BadRequestException('Boolean query value must be true or false');
  }

  private parseArrayQuery(value?: string | string[]): string[] {
    const rawValues = Array.isArray(value) ? value : [value || ''];
    return rawValues
      .flatMap(item => String(item).split(','))
      .map(item => item.trim())
      .filter(item => item !== '');
  }

  private parseIdArrayQuery(value?: string | string[]): number[] {
    return this.parseArrayQuery(value).map(item => {
      const parsed = Number(item);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException('ID query values must be positive integers');
      }
      return parsed;
    });
  }

  private parseKappaCalculationLevel(value?: string | string[]): KappaCalculationLevel {
    const values = this.parseArrayQuery(value);
    if (values.length === 0) {
      return 'code';
    }
    if (values.length > 1) {
      throw new BadRequestException('Kappa calculation level must be provided only once');
    }

    const level = values[0];
    if (level === 'code' || level === 'score') {
      return level;
    }

    throw new BadRequestException('Kappa calculation level must be code or score');
  }

  private buildKappaOptionsFromQuery(query: {
    weightedMean?: string;
    excludeTrainings?: string;
    unitName?: string;
    variableId?: string;
    jobDefinitionIds?: string | string[];
    coderTrainingIds?: string | string[];
    coderIds?: string | string[];
    level?: string | string[];
  }): KappaStatisticsOptions {
    const coderTrainingIds = this.parseIdArrayQuery(query.coderTrainingIds);

    return {
      weightedMean: query.weightedMean !== 'false',
      excludeTrainings: coderTrainingIds.length > 0 ? false : query.excludeTrainings !== 'false',
      unitName: query.unitName,
      variableId: query.variableId,
      jobDefinitionIds: this.parseIdArrayQuery(query.jobDefinitionIds),
      coderTrainingIds,
      coderIds: this.parseIdArrayQuery(query.coderIds),
      calculationLevel: this.parseKappaCalculationLevel(query.level)
    };
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
        statusTotalCasesToCode: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        responseAnalysisRawCases: {
          type: 'number',
          description:
            'Raw response count covered by response analysis statuses'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
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
      statusTotalCasesToCode: number;
      responseAnalysisRawCases: number;
      coveredSourceVariableCount: number;
      coveredSourceResponseCount: number;
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
        statusTotalIncompleteResponses: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        responseAnalysisRawCases: {
          type: 'number',
          description:
            'Raw response count covered by response analysis statuses'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
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
        },
        deriveErrorTotalResponses: {
          type: 'number',
          description: 'DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorAppliedResponses: {
          type: 'number',
          description: 'Applied DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorRemainingResponses: {
          type: 'number',
          description: 'Remaining DERIVE_ERROR opt-in cases after duplicate aggregation'
        },
        deriveErrorRawTotalResponses: {
          type: 'number',
          description: 'Raw DERIVE_ERROR opt-in responses before duplicate aggregation'
        },
        deriveErrorRawAppliedResponses: {
          type: 'number',
          description: 'Raw applied DERIVE_ERROR opt-in responses before duplicate aggregation'
        }
      }
    }
  })
  async getAppliedResultsOverview(
    @WorkspaceId() workspace_id: number
  ): Promise<{
      totalIncompleteResponses: number;
      statusTotalIncompleteResponses: number;
      responseAnalysisRawCases: number;
      coveredSourceVariableCount: number;
      coveredSourceResponseCount: number;
      appliedResponses: number;
      remainingResponses: number;
      completionPercentage: number;
      rawTotalIncompleteResponses: number;
      rawAppliedResponses: number;
      rawCompletionPercentage: number;
      aggregationActive: boolean;
      aggregationThreshold: number | null;
      aggregatedDuplicateCases: number;
      deriveErrorTotalResponses: number;
      deriveErrorAppliedResponses: number;
      deriveErrorRemainingResponses: number;
      deriveErrorRawTotalResponses: number;
      deriveErrorRawAppliedResponses: number;
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
        statusTotalCasesToCode: {
          type: 'number',
          description:
            'Raw status total before covered source variables are excluded'
        },
        responseAnalysisRawCases: {
          type: 'number',
          description:
            'Raw response count covered by response analysis statuses'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
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
    statusTotalCasesToCode: number;
    responseAnalysisRawCases: number;
    coveredSourceVariableCount: number;
    coveredSourceResponseCount: number;
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
        statusTotalVariables: {
          type: 'number',
          description:
            'Raw status variable total before covered source variables are excluded'
        },
        coveredSourceVariableCount: {
          type: 'number',
          description:
            'Number of source variables represented by derived manual variables'
        },
        coveredSourceResponseCount: {
          type: 'number',
          description:
            'Number of source responses excluded because their derived variables are coded manually'
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
                        name: {
                          type: 'string',
                          description: 'User-facing job definition name'
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
      statusTotalVariables: number;
      coveredSourceVariableCount: number;
      coveredSourceResponseCount: number;
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
            name?: string;
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
    name: 'level',
    required: false,
    enum: ['code', 'score'],
    description: 'Calculation level: code for code-level kappa (default), score for score-level kappa',
    type: String
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
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit statistics to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit statistics to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit statistics to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
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
              meanKappa: {
                type: 'number',
                nullable: true,
                description: "Mean Cohen's Kappa for this variable, using the selected weighting method"
              },
              meanAgreement: {
                type: 'number',
                nullable: true,
                description: 'Mean observed agreement for this variable, using the selected weighting method'
              },
              caseCount: {
                type: 'number',
                description: 'Total coded cases for this variable'
              },
              doubleCodedCount: {
                type: 'number',
                description: 'Number of double-coded cases for this variable'
              },
              doubleCodedRate: {
                type: 'number',
                nullable: true,
                description: 'Share of coded cases that are double-coded'
              },
              validPairCount: {
                type: 'number',
                description: 'Total number of valid coder-pair comparisons for this variable'
              },
              coderPairCount: {
                type: 'number',
                description: 'Number of coder pairs with valid comparisons for this variable'
              },
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
                    interpretation: { type: 'string' },
                    jobNames: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    jobDefinitionIds: {
                      type: 'array',
                      items: { type: 'number' }
                    },
                    trainingIds: {
                      type: 'array',
                      items: { type: 'number' }
                    },
                    trainingLabels: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalCodedResponses: { type: 'number' },
            totalDoubleCodedResponses: { type: 'number' },
            totalCoderPairs: { type: 'number' },
            averageKappa: { type: 'number', nullable: true },
            meanAgreement: { type: 'number', nullable: true },
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
              description: 'Level used to calculate kappa'
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
    @Query('excludeTrainings') excludeTrainings?: string,
    @Query('jobDefinitionIds') jobDefinitionIds?: string | string[],
    @Query('coderTrainingIds') coderTrainingIds?: string | string[],
    @Query('coderIds') coderIds?: string | string[],
    @Query('level') level?: string | string[]
  ): Promise<KappaStatisticsResponse> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        level
      });
      const statistics = await this.cohensKappaStatisticsService.buildStatistics(workspace_id, options);
      return this.toPublicCohensKappaStatistics(statistics);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error calculating Cohen's Kappa: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/csv')
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
    name: 'level',
    required: false,
    enum: ['code', 'score'],
    description: 'Calculation level: code for code-level kappa (default), score for score-level kappa',
    type: String
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
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description: "Cohen's Kappa coder-pair details exported as CSV.",
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaStatisticsAsCsv(
    @WorkspaceId() workspace_id: number,
    @Query('weightedMean') weightedMean: string | undefined,
    @Query('unitName') unitName: string | undefined,
    @Query('variableId') variableId: string | undefined,
    @Query('excludeTrainings') excludeTrainings: string | undefined,
    @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
    @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
    @Query('coderIds') coderIds: string | string[] | undefined,
    @Query('level') level: string | string[] | undefined,
    @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        level
      });
      const statistics = await this.cohensKappaStatisticsService.buildStatistics(workspace_id, options);
      const csvContent = await this.cohensKappaExportService.createDetailsCsv(statistics, options);
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-details-${workspace_id}-${exportDate}.csv"`
      );
      res.send(csvContent);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa CSV: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/summary/csv')
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
    name: 'level',
    required: false,
    enum: ['code', 'score'],
    description: 'Calculation level: code for code-level kappa (default), score for score-level kappa',
    type: String
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
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiOkResponse({
    description: "Cohen's Kappa variable summary exported as CSV.",
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaSummaryAsCsv(
    @WorkspaceId() workspace_id: number,
    @Query('weightedMean') weightedMean: string | undefined,
    @Query('unitName') unitName: string | undefined,
    @Query('variableId') variableId: string | undefined,
    @Query('excludeTrainings') excludeTrainings: string | undefined,
    @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
    @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
    @Query('coderIds') coderIds: string | string[] | undefined,
    @Query('level') level: string | string[] | undefined,
    @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        level
      });
      const statistics = await this.cohensKappaStatisticsService.buildStatistics(workspace_id, options);
      const csvContent = await this.cohensKappaExportService.createSummaryCsv(statistics);
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-summary-${workspace_id}-${exportDate}.csv"`
      );
      res.send(csvContent);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa summary CSV: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/cohens-kappa/export/xlsx')
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
    name: 'level',
    required: false,
    enum: ['code', 'score'],
    description: 'Calculation level: code for code-level kappa (default), score for score-level kappa',
    type: String
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
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit export to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit export to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit export to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    description: 'Temporary workspace auth token for replay URLs in the workbook',
    type: String
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa workbook exported as XLSX with summary, pairwise details and coding results sheets.",
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCohensKappaStatisticsAsXlsx(
    @WorkspaceId() workspace_id: number,
    @Query('weightedMean') weightedMean: string | undefined,
    @Query('unitName') unitName: string | undefined,
    @Query('variableId') variableId: string | undefined,
    @Query('excludeTrainings') excludeTrainings: string | undefined,
    @Query('jobDefinitionIds') jobDefinitionIds: string | string[] | undefined,
    @Query('coderTrainingIds') coderTrainingIds: string | string[] | undefined,
    @Query('coderIds') coderIds: string | string[] | undefined,
    @Query('authToken') authToken: string | undefined,
    @Query('level') level: string | string[] | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    try {
      const options = this.buildKappaOptionsFromQuery({
        weightedMean,
        excludeTrainings,
        unitName,
        variableId,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        level
      });
      const statistics = await this.cohensKappaStatisticsService.buildStatistics(workspace_id, options);
      const buffer = await this.cohensKappaExportService.createWorkbook(
        workspace_id,
        statistics,
        statistics.sourceItems,
        { serverUrl: this.getServerUrlFromRequest(req), authToken: authToken || '' }
      );
      const exportDate = new Date().toISOString().slice(0, 10);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cohens-kappa-${workspace_id}-${exportDate}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error exporting Cohen's Kappa XLSX: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
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
  @ApiQuery({
    name: 'jobDefinitionIds',
    required: false,
    description: 'Limit statistics to one or more job definition IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderTrainingIds',
    required: false,
    description: 'Limit statistics to one or more coder training IDs (comma-separated or repeated query parameters)',
    type: String
  })
  @ApiQuery({
    name: 'coderIds',
    required: false,
    description: 'Limit statistics to one or more coder IDs (comma-separated or repeated query parameters)',
    type: String
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
    @Query('excludeTrainings') excludeTrainings?: string,
    @Query('jobDefinitionIds') jobDefinitionIds?: string | string[],
    @Query('coderTrainingIds') coderTrainingIds?: string | string[],
    @Query('coderIds') coderIds?: string | string[]
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
    const options = this.buildKappaOptionsFromQuery({
      weightedMean,
      excludeTrainings,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    });
    return this.doubleCodingReviewQueryService.getWorkspaceCohensKappaSummary(
      workspace_id,
      options.weightedMean,
      options.excludeTrainings,
      options.jobDefinitionIds,
      options.coderTrainingIds,
      options.coderIds
    );
  }

  @Post(':workspace_id/coding/calculate-distribution')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })

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
        distributionByCoderId: {
          type: 'object',
          description: 'Case distribution matrix keyed by coder ID',
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
              distinctCases: { type: 'number' },
              codingTasksTotal: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              doubleCodedCasesPerCoderId: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        aggregationInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              uniqueCases: { type: 'number' },
              totalResponses: { type: 'number' }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: { type: 'object' }
        },
        pairDistribution: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        tasksPerCoder: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        coderWeights: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      }
    }
  })
  async calculateDistribution(
    @WorkspaceId() workspace_id: number,
    @ValidatedBody('WorkspaceCodingStatisticsController_calculateDistribution')
                   body: RequestBody<'WorkspaceCodingStatisticsController_calculateDistribution'>,
                   @Res({ passthrough: true }) response: Response
  ): Promise<DistributionCalculationResponse> {
    const cancellation = new AbortController();
    const cancelOnDisconnect = () => {
      if (!response.writableEnded) {
        cancellation.abort();
      }
    };
    response.once('close', cancelOnDisconnect);

    try {
      return await this.distributionPreviewLimiterService.run(
        () => this.codingJobService.calculateDistribution(workspace_id, body),
        cancellation.signal
      );
    } finally {
      response.removeListener('close', cancelOnDisconnect);
    }
  }

  @Post(':workspace_id/coding/create-distributed-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })

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
        distributionByCoderId: {
          type: 'object',
          description: 'Case distribution matrix keyed by coder ID',
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
              distinctCases: { type: 'number' },
              codingTasksTotal: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              doubleCodedCasesPerCoderId: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        aggregationInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              uniqueCases: { type: 'number' },
              totalResponses: { type: 'number' }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: { type: 'object' }
        },
        pairDistribution: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        tasksPerCoder: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        coderWeights: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemKey: { type: 'string' },
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
    @ValidatedBody('WorkspaceCodingStatisticsController_createDistributedCodingJobs')
                   body: RequestBody<'WorkspaceCodingStatisticsController_createDistributedCodingJobs'>,
                   @Req() ownershipRequest: { user?: { id?: number } }
  ): Promise<DistributedCodingJobsResponse> {
    if (!body) {
      throw new BadRequestException('Request body is required');
    }

    if (Object.prototype.hasOwnProperty.call(body, 'jobDefinitionId')) {
      throw new BadRequestException(
        'Use the job definition endpoint to create coding jobs from a job definition'
      );
    }

    return this.codingJobService.createDistributedCodingJobs(workspace_id, body, undefined, ownershipRequest.user?.id);
  }
}
