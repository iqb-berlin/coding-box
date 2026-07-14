import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  In,
  Not,
  IsNull,
  ILike,
  Connection,
  EntityManager,
  FindOneOptions,
  SelectQueryBuilder,
  Brackets
} from 'typeorm';
import * as cheerio from 'cheerio';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { SaveCodingNotesDto } from '../../../admin/coding-job/dto/save-coding-notes.dto';
import {
  sortUnitsContinuous,
  sortUnitsAlternating,
  getLatestCode
} from '../../../utils/coding-utils';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CreateCodingJobDto } from '../../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import FileUpload from '../../entities/file_upload.entity';
import { Setting } from '../../entities/setting.entity';
import { CacheService } from '../../../cache/cache.service';
// eslint-disable-next-line import/no-cycle
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { UsersService } from '../users';
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  buildAggregationPeerLookupKeys,
  buildAggregationPeerKeys,
  buildAggregationPeerUnitKeys,
  buildAggregationGroups,
  deduplicateManualCodingResponses,
  getAggregationPeerKey,
  getManualCodingDeduplicationKey,
  isAggregatableValue,
  ManualCodingDeduplicationResponse,
  serializeAggregationPeerKey
} from './aggregation-metrics.util';
import {
  formatCodingTestPersonFromUnit,
  generateCodingProgressKey,
  parseCodingTestPerson
} from './coding-progress-key.util';
import {
  CodingJobFreshnessImpactDto,
  JobDefinitionRefreshCoderTaskDeltaDto,
  JobDefinitionRefreshItemDeltaDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../../api-dto/coding/job-refresh.dto';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import { CodingFreshnessService } from './coding-freshness.service';
import {
  getCodingIncompleteVariablesCacheKeys,
  getCodingIncompleteVariablesCacheVersionKey
} from './coding-incomplete-variables-cache-key.util';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import {
  IQB_STANDARD_MISSING_CODES,
  MissingsProfilesService
} from './missings-profiles.service';
import {
  DERIVE_ERROR_STATUS,
  getDeriveErrorManualCodingPairKeys,
  ManualCodingVariableReference,
  MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
} from '../../utils/manual-coding-candidate.util';
import {
  applyNonCodingIssueReviewJobFilter,
  CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
  getNonCodingIssueReviewJobSqlCondition,
  isCodingIssueReviewJobType
} from './coding-job-type.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { hasVisibleManualInstruction } from '../../../utils/manual-instruction.util';
import {
  CodingJobDistributionPlanner,
  DistributionCoderLoad
} from './coding-job-distribution-planner';

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

export enum ResponseMatchingFlag {
  NO_AGGREGATION = 'NO_AGGREGATION',
  IGNORE_CASE = 'IGNORE_CASE',
  IGNORE_WHITESPACE = 'IGNORE_WHITESPACE'
}

interface CodingSchemeCode {
  id: number | string;
  code?: string;
  label?: string;
  score?: number;
  manualInstruction?: string | null;
}

interface CodingSchemeVariableCoding {
  id: string;
  alias?: string;
  codes?: CodingSchemeCode[];
}

interface CodingScheme {
  variableCodings?: CodingSchemeVariableCoding[];
}

interface JobCreationWarning {
  unitName: string;
  variableId: string;
  message: string;
  casesInJobs: number;
  availableCases: number;
}

export interface TransferCodingCasesResult {
  sourceCoderId: number;
  targetCoderId: number;
  affectedJobs: number;
  updatedAssignments: number;
  removedDuplicateAssignments: number;
  transferredCases: number;
}

type VariableReference = ManualCodingVariableReference;
type BundleItem = {
  id: number;
  name: string;
  caseOrderingMode?: 'continuous' | 'alternating';
  variables: VariableReference[];
};
type DistributionItem = {
  type: 'bundle' | 'variable';
  item: BundleItem | VariableReference;
};
type DistributionCoderInput = {
  id: number;
  name: string;
  username: string;
  weight?: number;
  capacityPercent?: number;
};

type NormalizedDistributionCoder = {
  id: number;
  name: string;
  username: string;
  weight: number;
  displayKey: string;
  tieBreaker: number;
};

type DistributionDoubleCodingInfo = {
  totalCases: number;
  distinctCases: number;
  codingTasksTotal: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoder: Record<string, number>;
  doubleCodedCasesPerCoderId: Record<string, number>;
};

type DistributionPlanRequest = {
  selectedVariables: VariableReference[];
  selectedVariableBundles?: BundleItem[];
  selectedCoders: DistributionCoderInput[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number;
  jobDefinitionId?: number;
  distributionSeed?: string | number;
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  missingsProfileId?: number;
};

type DistributionVariableUsageRequest = {
  selectedVariables: VariableReference[];
  selectedVariableBundles?: BundleItem[];
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number;
  jobDefinitionId?: number;
  excludeJobDefinitionId?: number;
  distributionSeed?: string | number;
};

type DistributionVariableUsageBatchRequest =
  DistributionVariableUsageRequest & {
    key: string | number;
  };

export type DistributionVariableUsageByStatus = {
  regular: number;
  deriveError: number;
  total: number;
};

type DistributionVariableUsageCaseStatus = 'regular' | 'deriveError';

type DeriveErrorManualCodingRequest = {
  selectedVariables?: ManualCodingVariableReference[];
  selectedVariableBundles?: Array<{
    variables?: ManualCodingVariableReference[];
  }>;
};

type DistributionVariableUsageContext = {
  matchingFlags: ResponseMatchingFlag[];
  aggregationThreshold: number | null;
  derivedVariableSets: Map<string, Set<string>>;
  allResponses: SlimResponse[];
  assignedResponseIds: Set<number>;
  assignedResponseIdsByExcludedJobDefinitionId: Map<number, Set<number>>;
};

type DistributionPlanItem = {
  type: 'bundle' | 'variable';
  item: BundleItem | VariableReference;
  itemKey: string;
  itemLabel: string;
  itemVariables: VariableReference[];
  itemCaseOrderingMode: 'continuous' | 'alternating';
  uniqueCases: number;
  totalResponses: number;
  availableCases: DistributionPlanCaseGroup[];
  caseStatusesByResponseId: Map<number, DistributionVariableUsageCaseStatus>;
  selectedCases: DistributionPlanCaseGroup[];
};

type DistributionPlanCaseGroup = {
  caseKey: string;
  responses: SlimResponse[];
  representativeResponse: SlimResponse;
};

type DistributionPlanCase = {
  item: DistributionPlanItem;
  response: SlimResponse;
  allocationCaseKey: string;
  isDoubleCoded: boolean;
  assignedCoderIds: number[];
};

type DistributionPlanJob = {
  coder: NormalizedDistributionCoder;
  item: DistributionPlanItem;
  unitSubset: SlimResponse[];
};

type DistributionPlan = {
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
  aggregationInfo: Record<
  string,
  { uniqueCases: number; totalResponses: number }
  >;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  jobsToCreate: DistributionPlanJob[];
  plannedCases: DistributionPlanCase[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
};

type JobDefinitionExistingTaskRow = {
  responseId: number;
  itemKey: string;
  coderId: number;
  taskCount: number;
};

type DistributionCreatedJob = {
  itemKey: string;
  coderId: number;
  coderName: string;
  variable: { unitName: string; variableId: string };
  jobId: number;
  jobName: string;
  caseCount: number;
};

type CodingJobBundleVariableStatus =
  | 'manual-open'
  | 'manual-coded'
  | 'auto-coded'
  | 'not-coded'
  | 'not-available';

type CodingJobBundleVariableContext = {
  responseId: number | null;
  unitName: string;
  variableId: string;
  variableAnchor: string;
  variablePage: string;
  status: CodingJobBundleVariableStatus;
  code: number | null;
  score: number | null;
  source: 'manual' | 'auto' | 'none';
};

type CodingJobBundleContext = {
  bundleId: number;
  bundleName: string;
  caseKey: string;
  caseOrderingMode: 'continuous' | 'alternating';
  variables: CodingJobBundleVariableContext[];
};

type DistributedCodingJobsResult = {
  success: boolean;
  jobsCreated: number;
  message: string;
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
  aggregationInfo: Record<
  string,
  { uniqueCases: number; totalResponses: number }
  >;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
  jobs: DistributionCreatedJob[];
};

type DistributedCodingJobsTransactionHook = (
  manager: EntityManager,
  result: DistributedCodingJobsResult
) => Promise<void>;

export type CodingJobListScope = 'all' | 'training' | 'productive';
export type CodingJobListSortBy =
  | 'name'
  | 'description'
  | 'status'
  | 'createdAt'
  | 'updatedAt';
export type CodingJobListSortDirection = 'asc' | 'desc';

export interface CodingJobIssueSummary {
  total: number;
  open: number;
  codeAssignmentUncertain: number;
  newCodeNeeded: number;
}

export interface CodingJobListFilters {
  scope?: CodingJobListScope;
  status?: string;
  excludeStatus?: string;
  coderId?: number;
  jobName?: string;
  trainingId?: number | 'none';
  includeIssueSummary?: boolean;
  sortBy?: CodingJobListSortBy;
  sortDirection?: CodingJobListSortDirection;
}

type RefreshDistributedCodingJobsTransactionHook = (
  manager: EntityManager,
  result: JobDefinitionRefreshCodingJobsResult
) => Promise<void>;

type JobDefinitionRefreshCodingJobsResult = DistributedCodingJobsResult & {
  preview: JobDefinitionRefreshPreviewDto;
};

const DEFAULT_DISTRIBUTION_CODER_WEIGHT = 1;
const MIN_DISTRIBUTION_CODER_CAPACITY_PERCENT = 10;
const MAX_DISTRIBUTION_CODER_CAPACITY_PERCENT = 300;

interface SlimResponse {
  id: number;
  variableid: string;
  value: string | null;
  statusV1?: number | null;
  statusV2?: number | null;
  unitName: string;
  unitAlias: string | null;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variableBundleId?: number;
}

interface DistributableResponses {
  filteredResponses: SlimResponse[];
  uniqueCases: number;
  totalResponses: number;
  caseStatusesByResponseId: Map<number, DistributionVariableUsageCaseStatus>;
}

interface CodingJobCountRow {
  jobDefinitionId: number | string;
  jobsCount: number | string;
}

const JOB_DEFINITION_DELETE_READY_STATUSES = ['results_applied', 'review'];

type InternalCreateCodingJobDto = CreateCodingJobDto & {
  jobDefinitionId?: number;
};

const UPDATABLE_CODING_JOB_STATUSES = new Set([
  'pending',
  'active',
  'paused',
  'open',
  'completed',
  'review'
]);

export interface CodingJobAggregationSettings {
  aggregationEnabled: boolean;
  aggregationThreshold: number | null;
  responseMatchingFlags: ResponseMatchingFlag[];
  aggregationSettingsVersion: number | null;
  fromJobSnapshot: boolean;
}

const INCLUDE_DERIVE_ERROR_IN_MANUAL_CODING_SETTING_KEY =
  'include-derive-error-in-manual-coding';

@Injectable()
export class CodingJobService {
  private readonly logger = new Logger(CodingJobService.name);

  private readonly distributionPlanner = new CodingJobDistributionPlanner();

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private connection: Connection,
    private cacheService: CacheService,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceExclusionService: WorkspaceExclusionService,
    private usersService: UsersService,
    @Optional()
    private codingFreshnessService?: CodingFreshnessService,
    @Optional()
    private codingFileCacheService?: CodingFileCacheService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService,
    @Optional()
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository?: Repository<CoderTrainingDiscussionResult>,
    @Optional()
    private replayAnchorService?: CodingReplayAnchorService
  ) {}

  private async resolveMissingsProfileId(
    workspaceId: number,
    profileId?: number | null
  ): Promise<number | undefined> {
    if (this.missingsProfilesService) {
      return this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        profileId
      );
    }

    if (profileId === undefined || profileId === null || profileId === 0) {
      return undefined;
    }

    if (!Number.isInteger(profileId) || profileId < 1) {
      throw new BadRequestException(
        `Invalid missings profile id: ${profileId}`
      );
    }

    return profileId;
  }

  private async getDefaultMirCode(workspaceId: number): Promise<number> {
    if (!this.missingsProfilesService) {
      return IQB_STANDARD_MISSING_CODES.mir;
    }

    const missing =
      await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
        workspaceId,
        null,
        'mir'
      );
    return missing.code;
  }

  private async codingJobHasCodingWork(codingJobId: number): Promise<boolean> {
    const count = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :codingJobId', { codingJobId })
      .andWhere(
        `(cju.code IS NOT NULL
          OR cju.score IS NOT NULL
          OR cju.is_open = true
          OR cju.notes IS NOT NULL
          OR cju.supervisor_comment IS NOT NULL
          OR cju.coding_issue_option IS NOT NULL)`
      )
      .getCount();

    return count > 0;
  }

  private async codingJobHasTrainingDiscussions(
    codingJob: CodingJob
  ): Promise<boolean> {
    if (
      !codingJob.training_id ||
      !this.coderTrainingDiscussionResultRepository
    ) {
      return false;
    }

    const count = await this.coderTrainingDiscussionResultRepository.count({
      where: {
        workspace_id: codingJob.workspace_id,
        training_id: codingJob.training_id
      }
    });

    return count > 0;
  }

  private async assertMissingsProfileCanChange(
    codingJob: CodingJob,
    nextMissingsProfileId: number | undefined
  ): Promise<void> {
    const currentMissingsProfileId = await this.resolveMissingsProfileId(
      codingJob.workspace_id,
      codingJob.missings_profile_id
    );

    if (currentMissingsProfileId === nextMissingsProfileId) {
      return;
    }

    if (['completed', 'results_applied'].includes(codingJob.status)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because it is ${codingJob.status}`
      );
    }

    if (await this.codingJobHasCodingWork(codingJob.id)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because coding work already exists`
      );
    }

    if (await this.codingJobHasTrainingDiscussions(codingJob)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because training discussions already exist`
      );
    }
  }

  private applyManualCodingCandidateStatusFilter(
    queryBuilder: SelectQueryBuilder<ResponseEntity>,
    variables: VariableReference[] = []
  ): void {
    const deriveErrorManualCodingPairKeys =
      getDeriveErrorManualCodingPairKeys(variables);

    if (deriveErrorManualCodingPairKeys.length === 0) {
      queryBuilder.andWhere('response.status_v1 IN (:...statuses)', {
        statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
      });
      return;
    }

    queryBuilder.andWhere(
      new Brackets(qb => {
        qb.where('response.status_v1 IN (:...statuses)', {
          statuses: MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES
        }).orWhere(
          `response.status_v1 = :deriveErrorStatus
          AND CONCAT(unit.name, CHR(31), response.variableid) IN (:...deriveErrorManualCodingPairKeys)`,
          {
            deriveErrorStatus: DERIVE_ERROR_STATUS,
            deriveErrorManualCodingPairKeys
          }
        );
      })
    );
  }

  private responseMatchesVariableReference(
    response: SlimResponse,
    variable: VariableReference
  ): boolean {
    if (
      response.unitName !== variable.unitName ||
      response.variableid !== variable.variableId
    ) {
      return false;
    }

    return (
      response.statusV1 !== DERIVE_ERROR_STATUS ||
      variable.includeDeriveError === true
    );
  }

  private requestIncludesDeriveErrorManualCoding(
    request: DeriveErrorManualCodingRequest
  ): boolean {
    return (
      (request.selectedVariables || []).some(
        variable => variable.includeDeriveError === true
      ) ||
      (request.selectedVariableBundles || []).some(bundle => (bundle.variables || []).some(
        variable => variable.includeDeriveError === true
      )
      )
    );
  }

  async getIncludeDeriveErrorInManualCoding(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<boolean> {
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    const setting = await repository.findOne({
      where: {
        key: `workspace-${workspaceId}-${INCLUDE_DERIVE_ERROR_IN_MANUAL_CODING_SETTING_KEY}`
      }
    });

    if (!setting) {
      return false;
    }

    try {
      const parsed = JSON.parse(setting.content);
      return parsed.enabled === true;
    } catch {
      return false;
    }
  }

  async assertDeriveErrorManualCodingEnabled(
    workspaceId: number,
    request: DeriveErrorManualCodingRequest,
    manager?: EntityManager
  ): Promise<void> {
    if (!this.requestIncludesDeriveErrorManualCoding(request)) {
      return;
    }

    if (await this.getIncludeDeriveErrorInManualCoding(workspaceId, manager)) {
      return;
    }

    throw new BadRequestException(
      'DERIVE_ERROR manual coding is disabled for this workspace.'
    );
  }

  async assertUserCanAccessCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number,
    managerAccessLevel = 2
  ): Promise<void> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId },
      select: ['id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const isAdmin = await this.usersService.getUserIsAdmin(userId);
    if (isAdmin) {
      return;
    }

    const accessLevel = await this.usersService.getUserAccessLevel(
      userId,
      workspaceId
    );
    if ((accessLevel ?? 0) >= managerAccessLevel) {
      return;
    }

    const canCode = await this.usersService.canUserCodeInWorkspace(
      userId,
      workspaceId
    );
    if (!canCode) {
      throw new ForbiddenException(
        'User is not enabled as coder in this workspace'
      );
    }

    const assignedCount = await this.codingJobCoderRepository.count({
      where: {
        coding_job_id: codingJobId,
        user_id: userId
      }
    });

    if (assignedCount > 0) {
      return;
    }

    throw new ForbiddenException('User is not assigned to this coding job');
  }

  async assertUserCanCodeCodingJob(
    codingJobId: number,
    workspaceId: number,
    userId: number
  ): Promise<void> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId },
      select: ['id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const canCode = await this.usersService.canUserCodeInWorkspace(
      userId,
      workspaceId
    );
    if (!canCode) {
      throw new ForbiddenException(
        'User is not enabled as coder in this workspace'
      );
    }

    const assignedCount = await this.codingJobCoderRepository.count({
      where: {
        coding_job_id: codingJobId,
        user_id: userId
      }
    });

    if (assignedCount > 0) {
      return;
    }

    throw new ForbiddenException('User is not assigned to this coding job');
  }

  async assertCodersCanCodeInWorkspace(
    userIds: number[],
    workspaceId: number
  ): Promise<void> {
    await this.usersService.assertUsersCanCodeInWorkspace(userIds, workspaceId);
  }

  private async assertCodingJobCodersCanCode(
    codingJobId: number,
    userIds: number[],
    manager?: EntityManager,
    workspaceId?: number
  ): Promise<void> {
    if (workspaceId !== undefined) {
      await this.assertCodersCanCodeInWorkspace(userIds, workspaceId);
      return;
    }

    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJob = await codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    await this.assertCodersCanCodeInWorkspace(userIds, codingJob.workspace_id);
  }

  private async applyCodingJobUnitExclusions<T>(
    queryBuilder: SelectQueryBuilder<T>,
    workspaceId: number,
    parameterPrefix: string
  ): Promise<void> {
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix
    });
  }

  private async getVisibleCodingJobUnits(
    codingJobId: number,
    workspaceId: number
  ): Promise<CodingJobUnit[]> {
    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId }
    });
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    return codingJobUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
  }

  private isCodingIssueReviewJob(
    codingJob: Pick<CodingJob, 'job_type'> | null | undefined
  ): boolean {
    return isCodingIssueReviewJobType(codingJob?.job_type);
  }

  private applyNonCodingIssueReviewJobFilter<T>(
    queryBuilder: SelectQueryBuilder<T>,
    jobAlias: string,
    parameterName: string
  ): void {
    applyNonCodingIssueReviewJobFilter(queryBuilder, jobAlias, parameterName);
  }

  private withoutCodingIssueReviewJobWhere(
    baseWhere: Record<string, unknown>
  ): Record<string, unknown>[] {
    return [
      { ...baseWhere, job_type: IsNull() },
      {
        ...baseWhere,
        job_type: Not(CODING_JOB_TYPE_CODING_ISSUE_REVIEW)
      }
    ];
  }

  private getCodingJobUnitProgressKey(unit: CodingJobUnit): string {
    return generateCodingProgressKey(
      formatCodingTestPersonFromUnit(unit),
      unit.unit_name,
      unit.variable_id
    );
  }

  private codingJobUnitRequiresIssueReview(unit: CodingJobUnit): boolean {
    return unit.coding_issue_option === -1 ||
      unit.coding_issue_option === -2 ||
      unit.code === -1 ||
      unit.code === -2;
  }

  private codingJobUnitResolvesIssueReview(unit: CodingJobUnit): boolean {
    return !unit.is_open &&
      unit.code !== null &&
      !this.codingJobUnitRequiresIssueReview(unit);
  }

  private codingJobUnitCanOverlayIssueReview(unit: CodingJobUnit): boolean {
    return unit.is_open || unit.code !== null;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    const queryError = error as {
      code?: string;
      driverError?: { code?: string };
    };

    return queryError.code === '23505' ||
      queryError.driverError?.code === '23505';
  }

  private codingJobUnitHasRegularCode(unit: CodingJobUnit): boolean {
    return unit.code !== null && unit.code >= 0;
  }

  private assertCodingIssueReviewSourceUnit(unit: CodingJobUnit): void {
    if (!this.codingJobUnitRequiresIssueReview(unit)) {
      throw new BadRequestException(
        'Coding issue review can only be saved for units that require review'
      );
    }
  }

  private assertCodingIssueReviewSourceJobStatus(
    sourceCodingJob: Pick<CodingJob, 'status'>
  ): void {
    if (sourceCodingJob.status !== 'review') {
      throw new BadRequestException(
        'Coding issue review can only be saved for coding jobs submitted for review'
      );
    }
  }

  private async getCodingIssueReviewJobsForSource(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>
  ): Promise<CodingJob[]> {
    return (await this.codingJobRepository.find({
      where: {
        workspace_id: sourceCodingJob.workspace_id,
        job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
        source_coding_job_id: sourceCodingJob.id
      },
      relations: ['codingJobCoders']
    })) ?? [];
  }

  private async getCodingIssueReviewUnitsForSource(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>
  ): Promise<CodingJobUnit[]> {
    const reviewJobs =
      await this.getCodingIssueReviewJobsForSource(sourceCodingJob);
    const reviewJobIds = reviewJobs.map(job => job.id);

    if (reviewJobIds.length === 0) {
      return [];
    }

    const reviewUnits = (await this.codingJobUnitRepository.find({
      where: { coding_job_id: In(reviewJobIds) },
      order: {
        updated_at: 'ASC',
        id: 'ASC'
      }
    })) ?? [];
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        sourceCodingJob.workspace_id
      );

    return reviewUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
  }

  private async applyCodingIssueReviewOverlays(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id' | 'job_type'>,
    sourceUnits: CodingJobUnit[]
  ): Promise<CodingJobUnit[]> {
    if (this.isCodingIssueReviewJob(sourceCodingJob)) {
      return sourceUnits;
    }

    const sourceIssueKeys = new Set(
      sourceUnits
        .filter(unit => this.codingJobUnitRequiresIssueReview(unit))
        .map(unit => this.getCodingJobUnitProgressKey(unit))
    );

    if (sourceIssueKeys.size === 0) {
      return sourceUnits;
    }

    const reviewUnits =
      await this.getCodingIssueReviewUnitsForSource(sourceCodingJob);
    const reviewUnitsByKey = new Map(
      reviewUnits
        .filter(unit => (
          this.codingJobUnitCanOverlayIssueReview(unit) &&
          sourceIssueKeys.has(this.getCodingJobUnitProgressKey(unit))
        ))
        .map(unit => [this.getCodingJobUnitProgressKey(unit), unit])
    );

    if (reviewUnitsByKey.size === 0) {
      return sourceUnits;
    }

    return sourceUnits.map(unit => {
      if (!this.codingJobUnitRequiresIssueReview(unit)) {
        return unit;
      }

      const reviewUnit = reviewUnitsByKey.get(
        this.getCodingJobUnitProgressKey(unit)
      );
      if (!reviewUnit) {
        return unit;
      }

      if (!reviewUnit.is_open) {
        return reviewUnit;
      }

      return {
        ...reviewUnit,
        code: unit.code,
        score: unit.score,
        coding_issue_option: unit.coding_issue_option
      } as CodingJobUnit;
    });
  }

  private async getEffectiveVisibleCodingJobUnits(
    codingJob: Pick<CodingJob, 'id' | 'workspace_id' | 'job_type'>
  ): Promise<CodingJobUnit[]> {
    const codingJobUnits = await this.getVisibleCodingJobUnits(
      codingJob.id,
      codingJob.workspace_id
    );

    return this.applyCodingIssueReviewOverlays(codingJob, codingJobUnits);
  }

  private async getCodingIssueReviewResponseIdsByReviewUnit(
    codingJobId: number,
    matchesReviewUnit: (unit: CodingJobUnit) => boolean
  ): Promise<number[]> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id', 'job_type']
    });

    if (!codingJob || this.isCodingIssueReviewJob(codingJob)) {
      return [];
    }

    const sourceUnits = await this.getVisibleCodingJobUnits(
      codingJob.id,
      codingJob.workspace_id
    );
    const issueUnits = sourceUnits.filter(unit => (
      this.codingJobUnitRequiresIssueReview(unit)
    ));

    if (issueUnits.length === 0) {
      return [];
    }

    const issueKeys = new Set(
      issueUnits.map(unit => this.getCodingJobUnitProgressKey(unit))
    );
    const reviewUnits =
      await this.getCodingIssueReviewUnitsForSource(codingJob);
    const reviewUnitsByKey = new Map(
      reviewUnits
        .filter(unit => (
          this.codingJobUnitCanOverlayIssueReview(unit) &&
          issueKeys.has(this.getCodingJobUnitProgressKey(unit))
        ))
        .map(unit => [this.getCodingJobUnitProgressKey(unit), unit])
    );
    const responseIds = Array.from(reviewUnitsByKey.values())
      .filter(matchesReviewUnit)
      .map(unit => unit.response_id);

    return Array.from(new Set(responseIds));
  }

  async getResolvedCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> {
    return this.getCodingIssueReviewResponseIdsByReviewUnit(
      codingJobId,
      unit => this.codingJobUnitResolvesIssueReview(unit)
    );
  }

  async getOpenCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> {
    return this.getCodingIssueReviewResponseIdsByReviewUnit(
      codingJobId,
      unit => unit.is_open
    );
  }

  async getCodingJobProgress(
    jobId: number,
    manager?: EntityManager
  ): Promise<{ progress: number; coded: number; total: number; open: number }> {
    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJobUnitRepository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const codingJob = await codingJobRepository.findOne({
      where: { id: jobId },
      select: ['id', 'workspace_id']
    });

    if (!codingJob) {
      return {
        progress: 0,
        coded: 0,
        total: 0,
        open: 0
      };
    }

    const totalUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId });
    await this.applyCodingJobUnitExclusions(
      totalUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressTotal'
    );
    const totalUnits = await totalUnitsQuery.getCount();

    if (totalUnits === 0) {
      return {
        progress: 0,
        coded: 0,
        total: 0,
        open: 0
      };
    }

    const codedUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.code IS NOT NULL');
    await this.applyCodingJobUnitExclusions(
      codedUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressCoded'
    );

    const openUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    await this.applyCodingJobUnitExclusions(
      openUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressOpen'
    );

    const [codedUnits, openUnits] = await Promise.all([
      codedUnitsQuery.getCount(),
      openUnitsQuery.getCount()
    ]);

    const progress =
      totalUnits > 0 ?
        Math.round((Math.min(totalUnits, codedUnits) / totalUnits) * 100) :
        0;

    return {
      progress,
      coded: codedUnits,
      total: totalUnits,
      open: openUnits
    };
  }

  private async getCodingJobProgressByJobIds(
    jobIds: number[],
    workspaceId: number
  ): Promise<
    Map<
    number,
    { progress: number; coded: number; total: number; open: number }
    >
    > {
    const progressByJobId = new Map<
    number,
    { progress: number; coded: number; total: number; open: number }
    >();
    jobIds.forEach(jobId => progressByJobId.set(jobId, {
      progress: 0,
      coded: 0,
      total: 0,
      open: 0
    })
    );

    if (jobIds.length === 0) {
      return progressByJobId;
    }

    const progressQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.coding_job_id', 'jobId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE cju.code IS NOT NULL)', 'coded')
      .addSelect('COUNT(*) FILTER (WHERE cju.is_open = true)', 'open')
      .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
      .groupBy('cju.coding_job_id');
    await this.applyCodingJobUnitExclusions(
      progressQuery,
      workspaceId,
      'codingJobsProgress'
    );

    const progressRows = await progressQuery.getRawMany<{
      jobId: string | number;
      total: string | number;
      coded: string | number;
      open: string | number;
    }>();

    progressRows.forEach(row => {
      const jobId = Number(row.jobId);
      const total = Number(row.total || 0);
      const coded = Number(row.coded || 0);
      const open = Number(row.open || 0);
      progressByJobId.set(jobId, {
        progress:
          total > 0 ? Math.round((Math.min(total, coded) / total) * 100) : 0,
        coded,
        total,
        open
      });
    });

    return progressByJobId;
  }

  private async getAssignedCodingJobIds(
    workspaceId: number,
    userId: number
  ): Promise<number[]> {
    const rowsQuery = this.codingJobCoderRepository
      .createQueryBuilder('coder')
      .select('coder.coding_job_id', 'codingJobId')
      .innerJoin('coder.coding_job', 'coding_job')
      .where('coder.user_id = :userId', { userId })
      .andWhere('coding_job.workspace_id = :workspaceId', { workspaceId });
    this.applyNonCodingIssueReviewJobFilter(
      rowsQuery,
      'coding_job',
      'assignedCodingJobsReviewMarker'
    );
    const rows = await rowsQuery
      .getRawMany<{ codingJobId: string | number }>();

    return Array.from(
      new Set(rows.map(row => Number(row.codingJobId)))
    ).filter(jobId => Number.isFinite(jobId));
  }

  private intersectJobIdSets(jobIdSets: number[][]): number[] | undefined {
    if (jobIdSets.length === 0) {
      return undefined;
    }

    const intersection = jobIdSets
      .map(jobIds => new Set(jobIds))
      .reduce(
        (currentIntersection, jobIds) => new Set([...currentIntersection].filter(jobId => jobIds.has(jobId)))
      );

    return [...intersection];
  }

  private normalizeJobNameFilter(jobName?: string): string | undefined {
    const normalized = jobName?.trim();
    return normalized || undefined;
  }

  private getCodingJobListOrder(
    filters: CodingJobListFilters
  ): Record<string, 'ASC' | 'DESC'> {
    const direction = filters.sortDirection === 'asc' ? 'ASC' : 'DESC';

    switch (filters.sortBy) {
      case 'name':
        return { name: direction };
      case 'description':
        return { description: direction };
      case 'status':
        return { status: direction };
      case 'updatedAt':
        return { updated_at: direction };
      case 'createdAt':
      default:
        return { created_at: direction };
    }
  }

  private applyCodingJobListFiltersToOpenUnitsQuery<T>(
    queryBuilder: SelectQueryBuilder<T>,
    filters: CodingJobListFilters,
    filteredJobIds?: number[]
  ): void {
    if (filteredJobIds) {
      queryBuilder.andWhere('coding_job.id IN (:...filteredJobIds)', {
        filteredJobIds
      });
    }
    if (filters.status) {
      queryBuilder.andWhere('coding_job.status = :status', {
        status: filters.status
      });
    } else if (filters.excludeStatus) {
      queryBuilder.andWhere('coding_job.status != :excludeStatus', {
        excludeStatus: filters.excludeStatus
      });
    }
    const normalizedJobName = this.normalizeJobNameFilter(filters.jobName);
    if (normalizedJobName) {
      queryBuilder.andWhere('coding_job.name ILIKE :jobName', {
        jobName: `%${normalizedJobName}%`
      });
    }
    if (filters.scope === 'training') {
      queryBuilder.andWhere('coding_job.training_id IS NOT NULL');
    } else if (filters.scope === 'productive') {
      queryBuilder.andWhere('coding_job.training_id IS NULL');
    }
    if (filters.trainingId === 'none') {
      queryBuilder.andWhere('coding_job.training_id IS NULL');
    } else if (typeof filters.trainingId === 'number') {
      queryBuilder.andWhere('coding_job.training_id = :trainingId', {
        trainingId: filters.trainingId
      });
    }
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'codingJobOpenUnitsReviewMarker'
    );
  }

  private async getCodingJobIssueSummariesByJobIds(
    jobIds: number[],
    workspaceId: number
  ): Promise<Map<number, CodingJobIssueSummary>> {
    const summaries = new Map<number, CodingJobIssueSummary>();
    jobIds.forEach(jobId => summaries.set(jobId, {
      total: 0,
      open: 0,
      codeAssignmentUncertain: 0,
      newCodeNeeded: 0
    })
    );

    if (jobIds.length === 0) {
      return summaries;
    }

    const visibleIssueUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
      .andWhere(new Brackets(qb => {
        qb.where('cju.is_open = true')
          .orWhere(
            `(
              cju.is_open = false AND
              (
                cju.coding_issue_option IN (:...issueReviewCodes) OR
                cju.code IN (:...issueReviewCodes)
              )
            )`,
            { issueReviewCodes: [-1, -2] }
          );
      }));
    await this.applyCodingJobUnitExclusions(
      visibleIssueUnitsQuery,
      workspaceId,
      'codingJobsIssueSummary'
    );

    const sourceUnits = await visibleIssueUnitsQuery.getMany();
    const sourceIssueUnitsByJobId = new Map<number, CodingJobUnit[]>();
    const sourceIssueKeysByJobId = new Map<number, Set<string>>();

    sourceUnits.forEach(unit => {
      const summary = summaries.get(unit.coding_job_id);
      if (!summary) {
        return;
      }

      if (unit.is_open) {
        summary.open += 1;
        return;
      }

      if (!this.codingJobUnitRequiresIssueReview(unit)) {
        return;
      }

      const sourceIssueUnits =
        sourceIssueUnitsByJobId.get(unit.coding_job_id) ?? [];
      sourceIssueUnits.push(unit);
      sourceIssueUnitsByJobId.set(unit.coding_job_id, sourceIssueUnits);

      const sourceIssueKeys =
        sourceIssueKeysByJobId.get(unit.coding_job_id) ?? new Set<string>();
      sourceIssueKeys.add(this.getCodingJobUnitProgressKey(unit));
      sourceIssueKeysByJobId.set(unit.coding_job_id, sourceIssueKeys);
    });

    if (sourceIssueUnitsByJobId.size === 0) {
      return summaries;
    }

    const sourceIssueJobIds = Array.from(sourceIssueUnitsByJobId.keys());
    const reviewJobs = (await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
        source_coding_job_id: In(sourceIssueJobIds)
      },
      select: ['id', 'source_coding_job_id']
    })) ?? [];
    const reviewJobSourceJobIds = new Map<number, number>();
    reviewJobs.forEach(job => {
      if (job.source_coding_job_id !== null &&
          job.source_coding_job_id !== undefined
      ) {
        reviewJobSourceJobIds.set(job.id, job.source_coding_job_id);
      }
    });

    const reviewUnitsBySourceJobAndKey = new Map<string, CodingJobUnit>();
    const reviewJobIds = Array.from(reviewJobSourceJobIds.keys());

    if (reviewJobIds.length > 0) {
      const reviewUnits = (await this.codingJobUnitRepository.find({
        where: { coding_job_id: In(reviewJobIds) },
        order: {
          updated_at: 'ASC',
          id: 'ASC'
        }
      })) ?? [];
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );

      reviewUnits.forEach(unit => {
        const sourceJobId = reviewJobSourceJobIds.get(unit.coding_job_id);
        if (!sourceJobId) {
          return;
        }

        if (isExcludedByResolvedExclusions(
          exclusions,
          unit.booklet_name,
          unit.unit_name
        )) {
          return;
        }

        const progressKey = this.getCodingJobUnitProgressKey(unit);
        if (!sourceIssueKeysByJobId.get(sourceJobId)?.has(progressKey)) {
          return;
        }

        if (this.codingJobUnitCanOverlayIssueReview(unit)) {
          reviewUnitsBySourceJobAndKey.set(
            `${sourceJobId}:${progressKey}`,
            unit
          );
        }
      });
    }

    sourceIssueUnitsByJobId.forEach((sourceIssueUnits, jobId) => {
      const summary = summaries.get(jobId);
      if (!summary) {
        return;
      }

      sourceIssueUnits.forEach(sourceUnit => {
        const progressKey = this.getCodingJobUnitProgressKey(sourceUnit);
        const effectiveUnit =
          reviewUnitsBySourceJobAndKey.get(`${jobId}:${progressKey}`) ??
          sourceUnit;
        const issueOption =
          effectiveUnit.is_open ?
            sourceUnit.coding_issue_option ?? sourceUnit.code :
            effectiveUnit.coding_issue_option ?? effectiveUnit.code;

        if (effectiveUnit.is_open) {
          summary.open += 1;
        }

        if (issueOption === -1) {
          summary.codeAssignmentUncertain += 1;
        } else if (issueOption === -2) {
          summary.newCodeNeeded += 1;
        }
      });

      summary.total = summary.codeAssignmentUncertain + summary.newCodeNeeded;
    });

    return summaries;
  }

  async getCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(
      new Set(
        definitionIds.filter(definitionId => Number.isFinite(definitionId))
      )
    );

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const queryBuilder = this.codingJobRepository
      .createQueryBuilder('coding_job')
      .select('coding_job.job_definition_id', 'jobDefinitionId')
      .addSelect('COUNT(coding_job.id)', 'jobsCount')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id IN (:...definitionIds)', {
        definitionIds: uniqueDefinitionIds
      })
      .groupBy('coding_job.job_definition_id');
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'codingJobCountsReviewMarker'
    );
    const rows: CodingJobCountRow[] = await queryBuilder.getRawMany();

    return new Map(
      rows.map(row => [Number(row.jobDefinitionId), Number(row.jobsCount)])
    );
  }

  async getBlockingCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(
      new Set(
        definitionIds.filter(definitionId => Number.isFinite(definitionId))
      )
    );

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const queryBuilder = this.codingJobRepository
      .createQueryBuilder('coding_job')
      .select('coding_job.job_definition_id', 'jobDefinitionId')
      .addSelect('COUNT(coding_job.id)', 'jobsCount')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id IN (:...definitionIds)', {
        definitionIds: uniqueDefinitionIds
      })
      .andWhere('coding_job.status NOT IN (:...deleteReadyStatuses)', {
        deleteReadyStatuses: JOB_DEFINITION_DELETE_READY_STATUSES
      })
      .groupBy('coding_job.job_definition_id');
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'blockingCodingJobCountsReviewMarker'
    );
    const rows: CodingJobCountRow[] = await queryBuilder.getRawMany();

    return new Map(
      rows.map(row => [Number(row.jobDefinitionId), Number(row.jobsCount)])
    );
  }

  async getCodingJobFreshnessImpact(
    workspaceId: number,
    codingJobId: number
  ): Promise<CodingJobFreshnessImpactDto> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const countsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('COUNT(DISTINCT cju.response_id)', 'totalResponses')
      .addSelect(
        'COUNT(DISTINCT CASE WHEN cju.code IS NOT NULL OR cju.score IS NOT NULL THEN cju.response_id END)',
        'codedResponses'
      )
      .addSelect(
        'COUNT(DISTINCT CASE WHEN cju.is_open = true THEN cju.response_id END)',
        'openResponses'
      )
      .where('cju.coding_job_id = :codingJobId', { codingJobId });

    await this.applyCodingJobUnitExclusions(
      countsQuery,
      workspaceId,
      'codingJobFreshnessImpact'
    );
    const counts = await countsQuery.getRawOne<{
      totalResponses?: string | number;
      codedResponses?: string | number;
      openResponses?: string | number;
    }>();

    return {
      codingJobId,
      freshnessStatus: codingJob.freshness_status || 'current',
      freshnessReason: codingJob.freshness_reason || null,
      freshnessUpdatedAt: codingJob.freshness_updated_at?.toISOString() || null,
      affectedUnits: Number(codingJob.freshness_affected_units || 0),
      affectedResponses: Number(codingJob.freshness_affected_responses || 0),
      totalResponses: Number(counts?.totalResponses || 0),
      codedResponses: Number(counts?.codedResponses || 0),
      openResponses: Number(counts?.openResponses || 0)
    };
  }

  async previewJobDefinitionRefresh(
    workspaceId: number,
    request: DistributionPlanRequest
  ): Promise<JobDefinitionRefreshPreviewDto> {
    const jobDefinitionId = Number(request.jobDefinitionId);
    if (!Number.isInteger(jobDefinitionId) || jobDefinitionId < 1) {
      throw new BadRequestException('A valid job definition id is required.');
    }

    await this.assertDeriveErrorManualCodingEnabled(workspaceId, request);

    const [plan, existingRows, jobsRow, hasCodingWork] = await Promise.all([
      this.buildDistributionPlan(workspaceId, request),
      this.getJobDefinitionExistingTaskRows(workspaceId, jobDefinitionId),
      this.getJobDefinitionJobCounts(workspaceId, jobDefinitionId),
      this.jobDefinitionHasAnyCodingWork(workspaceId, jobDefinitionId)
    ]);

    return this.buildJobDefinitionRefreshPreview(
      jobDefinitionId,
      plan,
      existingRows,
      jobsRow,
      hasCodingWork
    );
  }

  private buildJobDefinitionRefreshPreview(
    jobDefinitionId: number,
    plan: DistributionPlan,
    existingRows: JobDefinitionExistingTaskRow[],
    jobsRow: { existingJobsCount: number; staleJobsCount: number },
    hasCodingWork: boolean
  ): JobDefinitionRefreshPreviewDto {
    const existingResponseIds = new Set(
      existingRows.map(row => row.responseId)
    );
    const plannedResponseIds = new Set(
      plan.plannedCases.map(plannedCase => plannedCase.response.id)
    );
    const retainedCases = [...plannedResponseIds].filter(responseId => existingResponseIds.has(responseId)
    ).length;
    const addedCases = [...plannedResponseIds].filter(
      responseId => !existingResponseIds.has(responseId)
    ).length;
    const removedCases = [...existingResponseIds].filter(
      responseId => !plannedResponseIds.has(responseId)
    ).length;
    const itemDeltas = this.buildJobDefinitionRefreshItemDeltas(
      plan,
      existingRows
    );
    const codingTasksByCoderId = this.buildJobDefinitionRefreshCoderDeltas(
      plan,
      existingRows
    );
    const taskDeltas = Object.values(codingTasksByCoderId).reduce(
      (totals, delta) => ({
        addedCodingTasks: totals.addedCodingTasks + delta.addedCodingTasks,
        removedCodingTasks: totals.removedCodingTasks + delta.removedCodingTasks
      }),
      { addedCodingTasks: 0, removedCodingTasks: 0 }
    );
    const existingJobsCount = Number(jobsRow.existingJobsCount || 0);
    const canApply = existingJobsCount === 0 || !hasCodingWork;

    return {
      jobDefinitionId,
      existingJobsCount,
      staleJobsCount: Number(jobsRow.staleJobsCount || 0),
      existingCases: existingResponseIds.size,
      plannedCases: plannedResponseIds.size,
      retainedCases,
      addedCases,
      removedCases,
      addedCodingTasks: taskDeltas.addedCodingTasks,
      removedCodingTasks: taskDeltas.removedCodingTasks,
      itemDeltas,
      codingTasksByCoderId,
      canApply,
      ...(canApply ?
        {} :
        {
          blockingReason:
              'Bestehende Kodierjobs enthalten bereits Kodierarbeit. Bitte pruefen Sie die betroffenen Jobs, bevor die Definition neu verteilt wird.'
        })
    };
  }

  private createEmptyRefreshCoderTaskDelta(
    coderId: number
  ): JobDefinitionRefreshCoderTaskDeltaDto {
    return {
      coderId,
      existingCodingTasks: 0,
      plannedCodingTasks: 0,
      retainedCodingTasks: 0,
      addedCodingTasks: 0,
      removedCodingTasks: 0
    };
  }

  private incrementRefreshCoderTaskDelta(
    deltas: Map<number, JobDefinitionRefreshCoderTaskDeltaDto>,
    coderId: number,
    field:
    | 'existingCodingTasks'
    | 'plannedCodingTasks'
    | 'retainedCodingTasks'
    | 'addedCodingTasks'
    | 'removedCodingTasks',
    count: number
  ): void {
    const delta =
      deltas.get(coderId) || this.createEmptyRefreshCoderTaskDelta(coderId);
    delta[field] += count;
    deltas.set(coderId, delta);
  }

  private getRefreshTaskKey(
    itemKey: string,
    coderId: number,
    responseId: number
  ): string {
    return `${itemKey}\u0000${coderId}\u0000${responseId}`;
  }

  private buildExistingTaskCountByItemCoderAndResponse(
    existingRows: JobDefinitionExistingTaskRow[]
  ): Map<string, number> {
    const existing = new Map<string, number>();
    existingRows.forEach(row => {
      const key = this.getRefreshTaskKey(
        row.itemKey,
        row.coderId,
        row.responseId
      );
      existing.set(key, (existing.get(key) || 0) + row.taskCount);
    });
    return existing;
  }

  private buildPlannedTaskCountByItemCoderAndResponse(
    plannedCases: DistributionPlanCase[]
  ): Map<string, number> {
    const planned = new Map<string, number>();
    plannedCases.forEach(plannedCase => {
      plannedCase.assignedCoderIds.forEach(coderId => {
        const key = this.getRefreshTaskKey(
          plannedCase.item.itemKey,
          coderId,
          plannedCase.response.id
        );
        planned.set(key, (planned.get(key) || 0) + 1);
      });
    });
    return planned;
  }

  private buildJobDefinitionRefreshCoderDeltas(
    plan: DistributionPlan,
    existingRows: JobDefinitionExistingTaskRow[],
    itemKey?: string
  ): Record<string, JobDefinitionRefreshCoderTaskDeltaDto> {
    const existing = this.buildExistingTaskCountByItemCoderAndResponse(
      itemKey ?
        existingRows.filter(row => row.itemKey === itemKey) :
        existingRows
    );
    const planned = this.buildPlannedTaskCountByItemCoderAndResponse(
      itemKey ?
        plan.plannedCases.filter(
          plannedCase => plannedCase.item.itemKey === itemKey
        ) :
        plan.plannedCases
    );
    const deltas = new Map<number, JobDefinitionRefreshCoderTaskDeltaDto>();
    const keys = new Set([...existing.keys(), ...planned.keys()]);

    keys.forEach(key => {
      const [, coderIdPart] = key.split('\u0000');
      const coderId = Number(coderIdPart);
      if (!Number.isFinite(coderId)) {
        return;
      }
      const existingCount = existing.get(key) || 0;
      const plannedCount = planned.get(key) || 0;
      const retainedCount = Math.min(existingCount, plannedCount);

      this.incrementRefreshCoderTaskDelta(
        deltas,
        coderId,
        'existingCodingTasks',
        existingCount
      );
      this.incrementRefreshCoderTaskDelta(
        deltas,
        coderId,
        'plannedCodingTasks',
        plannedCount
      );
      this.incrementRefreshCoderTaskDelta(
        deltas,
        coderId,
        'retainedCodingTasks',
        retainedCount
      );
      if (plannedCount > existingCount) {
        this.incrementRefreshCoderTaskDelta(
          deltas,
          coderId,
          'addedCodingTasks',
          plannedCount - existingCount
        );
      } else if (existingCount > plannedCount) {
        this.incrementRefreshCoderTaskDelta(
          deltas,
          coderId,
          'removedCodingTasks',
          existingCount - plannedCount
        );
      }
    });

    return Object.fromEntries(
      [...deltas.entries()]
        .sort(([a], [b]) => a - b)
        .map(([coderId, delta]) => [String(coderId), delta])
    );
  }

  private buildJobDefinitionRefreshItemDeltas(
    plan: DistributionPlan,
    existingRows: JobDefinitionExistingTaskRow[]
  ): JobDefinitionRefreshItemDeltaDto[] {
    const itemLabels = new Map<string, string>();

    plan.plannedCases.forEach(plannedCase => {
      itemLabels.set(plannedCase.item.itemKey, plannedCase.item.itemLabel);
    });
    existingRows.forEach(row => {
      if (!itemLabels.has(row.itemKey)) {
        itemLabels.set(
          row.itemKey,
          row.itemKey.startsWith('bundle:') ?
            row.itemKey :
            row.itemKey.replace('::', ' -> ')
        );
      }
    });

    return [...itemLabels.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map(itemKey => {
        const existingResponseIds = new Set(
          existingRows
            .filter(row => row.itemKey === itemKey)
            .map(row => row.responseId)
        );
        const plannedResponseIds = new Set(
          plan.plannedCases
            .filter(plannedCase => plannedCase.item.itemKey === itemKey)
            .map(plannedCase => plannedCase.response.id)
        );
        const codingTasksByCoderId = this.buildJobDefinitionRefreshCoderDeltas(
          plan,
          existingRows,
          itemKey
        );
        const taskTotals = Object.values(codingTasksByCoderId).reduce(
          (totals, delta) => ({
            existingCodingTasks:
              totals.existingCodingTasks + delta.existingCodingTasks,
            plannedCodingTasks:
              totals.plannedCodingTasks + delta.plannedCodingTasks,
            retainedCodingTasks:
              totals.retainedCodingTasks + delta.retainedCodingTasks,
            addedCodingTasks: totals.addedCodingTasks + delta.addedCodingTasks,
            removedCodingTasks:
              totals.removedCodingTasks + delta.removedCodingTasks
          }),
          {
            existingCodingTasks: 0,
            plannedCodingTasks: 0,
            retainedCodingTasks: 0,
            addedCodingTasks: 0,
            removedCodingTasks: 0
          }
        );

        return {
          itemKey,
          itemLabel: itemLabels.get(itemKey) || itemKey,
          existingCases: existingResponseIds.size,
          plannedCases: plannedResponseIds.size,
          retainedCases: [...plannedResponseIds].filter(responseId => existingResponseIds.has(responseId)
          ).length,
          addedCases: [...plannedResponseIds].filter(
            responseId => !existingResponseIds.has(responseId)
          ).length,
          removedCases: [...existingResponseIds].filter(
            responseId => !plannedResponseIds.has(responseId)
          ).length,
          ...taskTotals,
          codingTasksByCoderId
        };
      });
  }

  async deleteCodingJobsByDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> {
    const deletedJobs = await this.deleteCodingJobsByDefinitionInManager(
      undefined,
      workspaceId,
      jobDefinitionId
    );
    await this.invalidateIncompleteVariablesCache(workspaceId);
    return deletedJobs;
  }

  private async deleteCodingJobsByDefinitionInManager(
    manager: EntityManager | undefined,
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> {
    const repository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const result = await repository.delete({
      workspace_id: workspaceId,
      job_definition_id: jobDefinitionId
    });
    return result.affected || 0;
  }

  private async getJobDefinitionExistingTaskRows(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager
  ): Promise<JobDefinitionExistingTaskRow[]> {
    const repository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const itemKeyExpression =
      "CASE WHEN cju.variable_bundle_id IS NOT NULL THEN CONCAT('bundle:', cju.variable_bundle_id) ELSE CONCAT(cju.unit_name, '::', cju.variable_id) END";
    const query = repository
      .createQueryBuilder('cju')
      .select('cju.response_id', 'responseId')
      .addSelect(itemKeyExpression, 'itemKey')
      .addSelect('coding_job_coder.user_id', 'coderId')
      .addSelect('COUNT(cju.id)', 'taskCount')
      .innerJoin('cju.coding_job', 'coding_job')
      .innerJoin('coding_job.codingJobCoders', 'coding_job_coder')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', {
        jobDefinitionId
      })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.response_id')
      .addGroupBy(itemKeyExpression)
      .addGroupBy('coding_job_coder.user_id');
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'jobDefinitionExistingTasksReviewJobType'
    );

    await this.applyCodingJobUnitExclusions(
      query,
      workspaceId,
      'jobDefinitionExistingTasks'
    );
    const rows = await query.getRawMany<{
      responseId: string | number;
      itemKey: string;
      coderId: string | number;
      taskCount: string | number;
    }>();
    return rows
      .map(row => ({
        responseId: Number(row.responseId),
        itemKey: row.itemKey,
        coderId: Number(row.coderId),
        taskCount: Number(row.taskCount)
      }))
      .filter(
        row => Number.isFinite(row.responseId) &&
          Number.isFinite(row.coderId) &&
          Number.isFinite(row.taskCount) &&
          isSafeKey(row.itemKey)
      );
  }

  private async getJobDefinitionJobCounts(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager
  ): Promise<{ existingJobsCount: number; staleJobsCount: number }> {
    const repository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const queryBuilder = repository
      .createQueryBuilder('coding_job')
      .select('COUNT(coding_job.id)', 'existingJobsCount')
      .addSelect(
        "COUNT(CASE WHEN coding_job.freshness_status <> 'current' THEN 1 END)",
        'staleJobsCount'
      )
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', {
        jobDefinitionId
      });
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'jobDefinitionJobCountsReviewJobType'
    );
    const rawRow = await queryBuilder.getRawOne<{
      existingJobsCount?: string | number;
      staleJobsCount?: string | number;
    }>();

    return {
      existingJobsCount: Number(rawRow?.existingJobsCount || 0),
      staleJobsCount: Number(rawRow?.staleJobsCount || 0)
    };
  }

  private async jobDefinitionHasCodingWork(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager,
    applyExclusions = true
  ): Promise<boolean> {
    const repository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const query = repository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', {
        jobDefinitionId
      })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere(
        `(cju.code IS NOT NULL
          OR cju.score IS NOT NULL
          OR cju.is_open = true
          OR cju.notes IS NOT NULL
          OR cju.supervisor_comment IS NOT NULL
          OR cju.coding_issue_option IS NOT NULL)`
      );
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'jobDefinitionCodingWorkReviewJobType'
    );

    if (applyExclusions) {
      await this.applyCodingJobUnitExclusions(
        query,
        workspaceId,
        'jobDefinitionCodingWork'
      );
    }
    return (await query.getCount()) > 0;
  }

  private async jobDefinitionHasAnyCodingWork(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager
  ): Promise<boolean> {
    return this.jobDefinitionHasCodingWork(
      workspaceId,
      jobDefinitionId,
      manager,
      false
    );
  }

  private async lockCodingJobUnitsForDefinition(
    manager: EntityManager,
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<void> {
    const query = manager
      .getRepository(CodingJobUnit)
      .createQueryBuilder('cju')
      .select('cju.id', 'id')
      .innerJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', {
        jobDefinitionId
      })
      .andWhere('coding_job.training_id IS NULL')
      .setLock('pessimistic_write');
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'lockCodingJobUnitsReviewJobType'
    );
    await query.getRawMany();
  }

  private async assertApprovedJobDefinitionHasNoCreatedJobs(
    manager: EntityManager,
    workspaceId: number,
    jobDefinitionId?: number
  ): Promise<void> {
    if (jobDefinitionId === undefined || jobDefinitionId === null) {
      return;
    }

    const normalizedJobDefinitionId =
      await this.assertApprovedJobDefinitionCanBeUsed(
        manager,
        workspaceId,
        jobDefinitionId
      );

    const existingJobsCount = await manager.getRepository(CodingJob).count({
      where: {
        workspace_id: workspaceId,
        job_definition_id: normalizedJobDefinitionId
      }
    });

    if (existingJobsCount > 0) {
      throw new BadRequestException(
        `Coding jobs already exist for job definition ${normalizedJobDefinitionId}`
      );
    }
  }

  private async assertApprovedJobDefinitionCanBeUsed(
    manager: EntityManager,
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> {
    const normalizedJobDefinitionId = Number(jobDefinitionId);

    if (!Number.isFinite(normalizedJobDefinitionId)) {
      throw new BadRequestException('Invalid job definition id');
    }

    const jobDefinition = await manager
      .getRepository(JobDefinition)
      .createQueryBuilder('job_definition')
      .setLock('pessimistic_write')
      .where('job_definition.id = :jobDefinitionId', {
        jobDefinitionId: normalizedJobDefinitionId
      })
      .andWhere('job_definition.workspace_id = :workspaceId', { workspaceId })
      .getOne();

    if (!jobDefinition) {
      throw new NotFoundException(
        `Job definition with ID ${normalizedJobDefinitionId} not found`
      );
    }

    if (jobDefinition.status !== 'approved') {
      throw new BadRequestException(
        'Only approved job definitions can be used to create coding jobs'
      );
    }

    return normalizedJobDefinitionId;
  }

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit?: number,
    assignedToUserId?: number,
    filters: CodingJobListFilters = {}
  ): Promise<{
      data: (CodingJob & {
        assignedCoders?: number[];
        assignedVariables?: { unitName: string; variableId: string }[];
        assignedVariableBundles?: {
          name: string;
          variables: { unitName: string; variableId: string }[];
        }[];
        progress?: number;
        codedUnits?: number;
        totalUnits?: number;
        openUnits?: number;
        hasIssues?: boolean;
        issueSummary?: CodingJobIssueSummary;
      })[];
      total: number;
      totalOpenUnits?: number;
      page: number;
      limit?: number;
    }> {
    const validPage = page > 0 ? page : 1;
    const shouldPaginate = limit !== undefined && limit > 0;
    const skip = shouldPaginate ? (validPage - 1) * limit : undefined;
    const take = shouldPaginate ? limit : undefined;
    const jobIdFilters: number[][] = [];
    if (assignedToUserId) {
      jobIdFilters.push(
        await this.getAssignedCodingJobIds(workspaceId, assignedToUserId)
      );
    }
    if (filters.coderId) {
      jobIdFilters.push(
        await this.getAssignedCodingJobIds(workspaceId, filters.coderId)
      );
    }
    const filteredJobIds = this.intersectJobIdSets(jobIdFilters);

    if (filteredJobIds && filteredJobIds.length === 0) {
      return {
        data: [],
        total: 0,
        totalOpenUnits: 0,
        page: validPage,
        limit
      };
    }

    await this.codingFreshnessService?.reconcileAppliedManualCodingJobs(
      workspaceId,
      'RESET',
      'current'
    );

    const jobWhere: Record<string, unknown> = { workspace_id: workspaceId };
    if (filteredJobIds) {
      jobWhere.id = In(filteredJobIds);
    }
    if (filters.status) {
      jobWhere.status = filters.status;
    } else if (filters.excludeStatus) {
      jobWhere.status = Not(filters.excludeStatus);
    }
    const normalizedJobName = this.normalizeJobNameFilter(filters.jobName);
    if (normalizedJobName) {
      jobWhere.name = ILike(`%${normalizedJobName}%`);
    }
    if (filters.scope === 'training') {
      jobWhere.training_id = Not(IsNull());
    } else if (filters.scope === 'productive') {
      jobWhere.training_id = IsNull();
    }
    if (filters.trainingId === 'none') {
      jobWhere.training_id = IsNull();
    } else if (typeof filters.trainingId === 'number') {
      jobWhere.training_id = filters.trainingId;
    }

    const visibleJobWhere = this.withoutCodingIssueReviewJobWhere(jobWhere);

    const total = await this.codingJobRepository.count({
      where: visibleJobWhere
    });

    const jobs = await this.codingJobRepository.find({
      where: visibleJobWhere,
      relations: ['training'],
      order: this.getCodingJobListOrder(filters),
      skip,
      take
    });

    const jobIds = jobs.map(job => job.id);

    const [
      allCoders,
      allVariables,
      variableBundleEntities,
      progressByJobId,
      issueSummaryByJobId
    ] =
      jobIds.length > 0 ?
        await Promise.all([
          this.codingJobCoderRepository.find({
            where: { coding_job_id: In(jobIds) }
          }),
          this.codingJobVariableRepository.find({
            where: { coding_job_id: In(jobIds) }
          }),
          this.codingJobVariableBundleRepository.find({
            where: { coding_job_id: In(jobIds) },
            relations: ['variable_bundle']
          }),
          this.getCodingJobProgressByJobIds(jobIds, workspaceId),
          filters.includeIssueSummary ?
            this.getCodingJobIssueSummariesByJobIds(jobIds, workspaceId) :
            Promise.resolve(new Map<number, CodingJobIssueSummary>())
        ]) :
        [
          [],
          [],
          [],
          new Map<
          number,
          { progress: number; coded: number; total: number; open: number }
          >(),
          new Map<number, CodingJobIssueSummary>()
        ];

    const codersByJobId = new Map<number, number[]>();
    allCoders.forEach(coder => {
      if (!codersByJobId.has(coder.coding_job_id)) {
        codersByJobId.set(coder.coding_job_id, []);
      }
      codersByJobId.get(coder.coding_job_id)!.push(coder.user_id);
    });

    const variablesByJobId = new Map<
    number,
    { unitName: string; variableId: string }[]
    >();
    allVariables.forEach(variable => {
      if (!variablesByJobId.has(variable.coding_job_id)) {
        variablesByJobId.set(variable.coding_job_id, []);
      }
      variablesByJobId.get(variable.coding_job_id)!.push({
        unitName: variable.unit_name,
        variableId: variable.variable_id
      });
    });

    const variableBundlesByJobId = new Map<
    number,
    { name: string; variables: { unitName: string; variableId: string }[] }[]
    >();
    variableBundleEntities.forEach(bundleAssignment => {
      if (!variableBundlesByJobId.has(bundleAssignment.coding_job_id)) {
        variableBundlesByJobId.set(bundleAssignment.coding_job_id, []);
      }
      if (bundleAssignment.variable_bundle?.name) {
        variableBundlesByJobId.get(bundleAssignment.coding_job_id)!.push({
          name: bundleAssignment.variable_bundle.name,
          variables: bundleAssignment.variable_bundle.variables || []
        });
      }
    });

    const data = jobs.map(job => {
      const progress = progressByJobId.get(job.id);
      const issueSummary = issueSummaryByJobId.get(job.id);
      return {
        ...job,
        assignedCoders: codersByJobId.get(job.id) || [],
        assignedVariables: variablesByJobId.get(job.id) || [],
        assignedVariableBundles: variableBundlesByJobId.get(job.id) || [],
        progress: progress?.progress || 0,
        codedUnits: progress?.coded || 0,
        totalUnits: progress?.total || 0,
        openUnits: progress?.open || 0,
        ...(issueSummary ?
          { issueSummary, hasIssues: issueSummary.total > 0 } :
          {})
      };
    });

    const totalOpenUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    this.applyCodingJobListFiltersToOpenUnitsQuery(
      totalOpenUnitsQuery,
      filters,
      filteredJobIds
    );
    await this.applyCodingJobUnitExclusions(
      totalOpenUnitsQuery,
      workspaceId,
      'codingJobsOpenUnits'
    );
    const totalOpenUnits = await totalOpenUnitsQuery.getCount();

    return {
      data,
      total,
      totalOpenUnits,
      page: validPage,
      limit
    };
  }

  async getCodingJob(
    id: number,
    workspaceId?: number
  ): Promise<{
      codingJob: CodingJob & { durationSeconds?: number };
      assignedCoders: number[];
      variables: { unitName: string; variableId: string }[];
      variableBundles: VariableBundle[];
    }> {
    const whereClause: { id: number; workspace_id?: number } = { id };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const codingJob = await this.codingJobRepository.findOne({
      where: whereClause,
      relations: ['training']
    });
    if (!codingJob) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(
          `Coding job with ID ${id} not found in workspace ${workspaceId}`
        );
      } else {
        throw new NotFoundException(`Coding job with ID ${id} not found`);
      }
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    let variables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles =
      await this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: id }
      });
    const variableBundleIds = codingJobVariableBundles.map(
      bundle => bundle.variable_bundle_id
    );
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(variableBundleIds) }
    });

    // Include variables from bundles
    const bundleVariables = variableBundles.flatMap(
      bundle => bundle.variables || []
    );
    variables = [...variables, ...bundleVariables];

    return {
      codingJob,
      assignedCoders,
      variables,
      variableBundles
    };
  }

  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> {
    const missingsProfileId = await this.resolveMissingsProfileId(
      workspaceId,
      createCodingJobDto.missings_profile_id
    );
    const normalizedCreateCodingJobDto = {
      ...createCodingJobDto,
      missings_profile_id: missingsProfileId
    };

    const createdCodingJob = await this.connection.transaction(
      async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(
          manager,
          workspaceId
        );
        const codingJobRepo = manager.getRepository(CodingJob);
        const aggregationSettings =
          await this.getCurrentAggregationSettingsSnapshot(workspaceId);
        const codingJob = codingJobRepo.create({
          workspace_id: workspaceId,
          name: normalizedCreateCodingJobDto.name,
          description: normalizedCreateCodingJobDto.description,
          status: normalizedCreateCodingJobDto.status || 'pending',
          showScore: normalizedCreateCodingJobDto.showScore ?? false,
          allowComments: normalizedCreateCodingJobDto.allowComments ?? true,
          suppressGeneralInstructions:
            normalizedCreateCodingJobDto.suppressGeneralInstructions ?? false,
          missings_profile_id: normalizedCreateCodingJobDto.missings_profile_id,
          aggregation_enabled: aggregationSettings.aggregationEnabled,
          aggregation_threshold: aggregationSettings.aggregationThreshold,
          response_matching_flags: aggregationSettings.responseMatchingFlags,
          aggregation_settings_version:
            aggregationSettings.aggregationSettingsVersion
        });

        const savedCodingJob = await codingJobRepo.save(codingJob);

        if (
          normalizedCreateCodingJobDto.assignedCoders &&
          normalizedCreateCodingJobDto.assignedCoders.length > 0
        ) {
          await this.assignCoders(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.assignedCoders,
            manager,
            workspaceId
          );
        }

        if (
          normalizedCreateCodingJobDto.variables &&
          normalizedCreateCodingJobDto.variables.length > 0
        ) {
          await this.assignVariables(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.variables,
            manager
          );
        }

        if (
          normalizedCreateCodingJobDto.variableBundleIds &&
          normalizedCreateCodingJobDto.variableBundleIds.length > 0
        ) {
          await this.assignVariableBundles(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.variableBundleIds,
            manager
          );
        } else if (
          normalizedCreateCodingJobDto.variableBundles &&
          normalizedCreateCodingJobDto.variableBundles.length > 0
        ) {
          if (normalizedCreateCodingJobDto.variableBundles[0].id) {
            const bundleIds = normalizedCreateCodingJobDto.variableBundles
              .filter(bundle => bundle.id)
              .map(bundle => bundle.id);

            if (bundleIds.length > 0) {
              await this.assignVariableBundles(
                savedCodingJob.id,
                bundleIds,
                manager
              );
            }
          } else {
            const variables =
              normalizedCreateCodingJobDto.variableBundles.flatMap(
                bundle => bundle.variables || []
              );
            if (variables.length > 0) {
              await this.assignVariables(savedCodingJob.id, variables, manager);
            }
          }
        }
        await this.saveCodingJobUnits(
          savedCodingJob.id,
          normalizedCreateCodingJobDto.maxCodingCases,
          manager
        );

        return savedCodingJob;
      }
    );

    await this.invalidateIncompleteVariablesCache(workspaceId);
    return createdCodingJob;
  }

  async updateCodingJob(
    id: number,
    workspaceId: number,
    updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJob> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    if (updateCodingJobDto.name !== undefined) {
      codingJob.codingJob.name = updateCodingJobDto.name;
    }
    if (updateCodingJobDto.description !== undefined) {
      codingJob.codingJob.description = updateCodingJobDto.description;
    }
    if (updateCodingJobDto.status !== undefined) {
      const targetStatus = updateCodingJobDto.status;
      if (!UPDATABLE_CODING_JOB_STATUSES.has(targetStatus)) {
        throw new BadRequestException(
          `Unsupported coding job status: ${targetStatus}`
        );
      }
      if (codingJob.codingJob.status === 'results_applied') {
        throw new Error(
          `Cannot change status of coding job ${id} because it has already been applied to results (status: results_applied)`
        );
      }
      if (
        codingJob.codingJob.status === 'review' &&
        targetStatus !== 'review'
      ) {
        throw new BadRequestException(
          `Cannot change status of coding job ${id} because it has been submitted for review`
        );
      }
      if (
        codingJob.codingJob.status === 'completed' &&
        !['active', 'completed', 'review'].includes(targetStatus)
      ) {
        throw new BadRequestException(
          `Cannot change status of completed coding job ${id}`
        );
      }
      if (
        targetStatus === 'review' &&
        codingJob.codingJob.status !== 'completed'
      ) {
        throw new BadRequestException(
          `Cannot submit coding job ${id} for review because it is not completed`
        );
      }
      if (
        codingJob.codingJob.status !== 'completed' &&
        targetStatus === 'completed'
      ) {
        await this.assertCodingJobCanBeCompleted(id);
      }
      codingJob.codingJob.status = targetStatus;
    }
    if (updateCodingJobDto.comment !== undefined) {
      codingJob.codingJob.comment = updateCodingJobDto.comment;
    }
    if (updateCodingJobDto.missingsProfileId !== undefined) {
      const nextMissingsProfileId = await this.resolveMissingsProfileId(
        workspaceId,
        updateCodingJobDto.missingsProfileId
      );
      await this.assertMissingsProfileCanChange(
        codingJob.codingJob,
        nextMissingsProfileId
      );
      codingJob.codingJob.missings_profile_id = nextMissingsProfileId;
    }
    if (updateCodingJobDto.showScore !== undefined) {
      codingJob.codingJob.showScore = updateCodingJobDto.showScore;
    }
    if (updateCodingJobDto.allowComments !== undefined) {
      codingJob.codingJob.allowComments = updateCodingJobDto.allowComments;
    }
    if (updateCodingJobDto.suppressGeneralInstructions !== undefined) {
      codingJob.codingJob.suppressGeneralInstructions =
        updateCodingJobDto.suppressGeneralInstructions;
    }

    if (updateCodingJobDto.assignedCoders !== undefined) {
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.assertCodersCanCodeInWorkspace(
          updateCodingJobDto.assignedCoders,
          workspaceId
        );
      }
    }

    const savedCodingJob = await this.codingJobRepository.save(
      codingJob.codingJob
    );

    if (updateCodingJobDto.assignedCoders !== undefined) {
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(
          id,
          updateCodingJobDto.assignedCoders,
          undefined,
          workspaceId
        );
      } else {
        await this.codingJobCoderRepository.delete({ coding_job_id: id });
      }
    }

    if (updateCodingJobDto.variables !== undefined) {
      await this.codingJobVariableRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variables.length > 0) {
        await this.assignVariables(id, updateCodingJobDto.variables);
      }
    }

    if (updateCodingJobDto.variableBundleIds !== undefined) {
      await this.codingJobVariableBundleRepository.delete({
        coding_job_id: id
      });
      if (updateCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(
          id,
          updateCodingJobDto.variableBundleIds
        );
      }
    } else if (updateCodingJobDto.variableBundles !== undefined) {
      await this.codingJobVariableBundleRepository.delete({
        coding_job_id: id
      });

      if (updateCodingJobDto.variableBundles.length > 0) {
        if (updateCodingJobDto.variableBundles[0].id) {
          const bundleIds = updateCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(id, bundleIds);
          }
        } else {
          const variables = updateCodingJobDto.variableBundles.flatMap(
            bundle => bundle.variables || []
          );
          if (variables.length > 0) {
            await this.assignVariables(id, variables);
          }
        }
      }
    }

    return savedCodingJob;
  }

  async updateCodingJobDisplayOptionsByDefinitionId(
    workspaceId: number,
    jobDefinitionId: number,
    options: {
      showScore?: boolean;
      allowComments?: boolean;
      suppressGeneralInstructions?: boolean;
    },
    manager?: EntityManager
  ): Promise<number> {
    const updateValues: Partial<CodingJob> = {};

    if (options.showScore !== undefined) {
      updateValues.showScore = options.showScore;
    }
    if (options.allowComments !== undefined) {
      updateValues.allowComments = options.allowComments;
    }
    if (options.suppressGeneralInstructions !== undefined) {
      updateValues.suppressGeneralInstructions =
        options.suppressGeneralInstructions;
    }

    if (Object.keys(updateValues).length === 0) {
      return 0;
    }

    const repository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const result = await repository.update(
      {
        workspace_id: workspaceId,
        job_definition_id: jobDefinitionId
      },
      updateValues
    );

    return result.affected || 0;
  }

  async pauseCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'paused');
  }

  async resumeCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.setOwnCodingJobStatus(id, workspaceId, 'active');
  }

  async submitCodingJob(id: number, workspaceId: number): Promise<CodingJob> {
    return this.updateCodingJob(id, workspaceId, { status: 'completed' });
  }

  private async setOwnCodingJobStatus(
    id: number,
    workspaceId: number,
    status: 'active' | 'paused'
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id, workspace_id: workspaceId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }

    if (['review', 'results_applied'].includes(codingJob.status)) {
      return codingJob;
    }

    if (codingJob.status === 'completed' && status === 'paused') {
      return codingJob;
    }

    if (codingJob.status === status) {
      return codingJob;
    }

    codingJob.status = status;
    return this.codingJobRepository.save(codingJob);
  }

  async markCodingJobResultsApplied(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepository = this.getCodingJobRepository(manager);
    const codingJob = await this.getCodingJobByIdForWorkspace(
      id,
      workspaceId,
      manager
    );

    if (codingJob.status === 'results_applied') {
      return codingJob;
    }

    if (codingJob.freshness_status === 'stale_source') {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because its source responses changed`
      );
    }

    if (!['completed', 'review'].includes(codingJob.status)) {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because it is not completed or submitted for review`
      );
    }

    codingJob.status = 'results_applied';
    return codingJobRepository.save(codingJob);
  }

  async getCodingJobByIdForWorkspace(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    const codingJob = await this.getCodingJobRepository(manager).findOne({
      where: { id, workspace_id: workspaceId },
      relations: ['training']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${id} not found in workspace ${workspaceId}`
      );
    }

    return codingJob;
  }

  private getCodingJobRepository(
    manager?: EntityManager
  ): Repository<CodingJob> {
    return manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
  }

  async deleteCodingJob(
    id: number,
    workspaceId: number
  ): Promise<{ success: boolean }> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    await this.codingJobRepository.remove(codingJob.codingJob);

    // Invalidate the incomplete variables cache since coding job units were deleted
    await this.invalidateIncompleteVariablesCache(workspaceId);

    return { success: true };
  }

  private async invalidateIncompleteVariablesCache(
    workspaceId: number
  ): Promise<void> {
    await this.cacheService.incr(
      getCodingIncompleteVariablesCacheVersionKey(workspaceId)
    );
    await Promise.all(
      getCodingIncompleteVariablesCacheKeys(workspaceId)
        .map(cacheKey => this.cacheService.delete(cacheKey))
    );
    this.logger.log(
      `Invalidated manual coding variables cache for workspace ${workspaceId}`
    );
  }

  async assignCoders(
    codingJobId: number,
    userIds: number[],
    manager?: EntityManager,
    workspaceId?: number
  ): Promise<CodingJobCoder[]> {
    this.assertAssignedCoderIdsAreUnique(userIds);
    await this.assertCodingJobCodersCanCode(
      codingJobId,
      userIds,
      manager,
      workspaceId
    );
    const repo = manager ?
      manager.getRepository(CodingJobCoder) :
      this.codingJobCoderRepository;
    await repo.delete({ coding_job_id: codingJobId });
    const coders = userIds.map(userId => repo.create({
      coding_job_id: codingJobId,
      user_id: userId
    })
    );

    return repo.save(coders);
  }

  private assertAssignedCoderIdsAreUnique(userIds: number[]): void {
    const seenIds = new Set<number>();
    const duplicateIds = new Set<number>();

    userIds.forEach(userId => {
      if (seenIds.has(userId)) {
        duplicateIds.add(userId);
        return;
      }
      seenIds.add(userId);
    });

    if (duplicateIds.size > 0) {
      throw new BadRequestException(
        `Assigned coder IDs must be unique: ${Array.from(duplicateIds).join(', ')}`
      );
    }
  }

  async transferCodingCases(
    workspaceId: number,
    sourceCoderId: number,
    targetCoderId: number
  ): Promise<TransferCodingCasesResult> {
    if (sourceCoderId === targetCoderId) {
      throw new BadRequestException(
        'Source and target coder must be different'
      );
    }

    await this.assertCodersCanCodeInWorkspace([targetCoderId], workspaceId);

    return this.connection.transaction(async manager => {
      const codingJobCoderRepo = manager.getRepository(CodingJobCoder);
      const codingJobUnitRepo = manager.getRepository(CodingJobUnit);

      const sourceAssignments = await codingJobCoderRepo
        .createQueryBuilder('assignment')
        .innerJoin(CodingJob, 'job', 'job.id = assignment.coding_job_id')
        .where('assignment.user_id = :sourceCoderId', { sourceCoderId })
        .andWhere('job.workspace_id = :workspaceId', { workspaceId })
        .getMany();

      if (sourceAssignments.length === 0) {
        return {
          sourceCoderId,
          targetCoderId,
          affectedJobs: 0,
          updatedAssignments: 0,
          removedDuplicateAssignments: 0,
          transferredCases: 0
        };
      }

      const affectedJobIds = [
        ...new Set(
          sourceAssignments.map(assignment => assignment.coding_job_id)
        )
      ];

      const existingTargetAssignments = await codingJobCoderRepo.find({
        where: {
          coding_job_id: In(affectedJobIds),
          user_id: targetCoderId
        },
        select: ['coding_job_id']
      });

      const existingTargetJobIds = new Set(
        existingTargetAssignments.map(assignment => assignment.coding_job_id)
      );

      const updateAssignmentIds: number[] = [];
      const deleteAssignmentIds: number[] = [];

      sourceAssignments.forEach(assignment => {
        if (existingTargetJobIds.has(assignment.coding_job_id)) {
          deleteAssignmentIds.push(assignment.id);
          return;
        }
        updateAssignmentIds.push(assignment.id);
      });

      if (updateAssignmentIds.length > 0) {
        await codingJobCoderRepo
          .createQueryBuilder()
          .update(CodingJobCoder)
          .set({ user_id: targetCoderId })
          .whereInIds(updateAssignmentIds)
          .execute();
      }

      if (deleteAssignmentIds.length > 0) {
        await codingJobCoderRepo.delete(deleteAssignmentIds);
      }

      const transferredCasesQuery = codingJobUnitRepo
        .createQueryBuilder('cju')
        .where('cju.coding_job_id IN (:...affectedJobIds)', { affectedJobIds });
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );
      applyResolvedExclusionsToQuery(transferredCasesQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name',
        parameterPrefix: 'transferCases'
      });
      const transferredCases = await transferredCasesQuery.getCount();

      return {
        sourceCoderId,
        targetCoderId,
        affectedJobs: affectedJobIds.length,
        updatedAssignments: updateAssignmentIds.length,
        removedDuplicateAssignments: deleteAssignmentIds.length,
        transferredCases
      };
    });
  }

  private async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[],
    manager?: EntityManager
  ): Promise<CodingJobVariable[]> {
    const repo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const codingJobVariables = variables.map(variable => repo.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    })
    );

    return repo.save(codingJobVariables);
  }

  private async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[],
    manager?: EntityManager
  ): Promise<CodingJobVariableBundle[]> {
    const repo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;
    const variableBundles = variableBundleIds.map(variableBundleId => repo.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    })
    );

    return repo.save(variableBundles);
  }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { user_id: coderId },
      relations: ['coding_job']
    });

    return codingJobCoders
      .map(cjc => cjc.coding_job)
      .filter(codingJob => !this.isCodingIssueReviewJob(codingJob));
  }

  async getCodersByJobId(jobId: number): Promise<number[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: jobId }
    });

    return codingJobCoders.map(cjc => cjc.user_id);
  }

  async getCodingJobById(id: number): Promise<
  CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
  }
  > {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id },
      relations: ['training']
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    const assignedVariables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles =
      await this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: id },
        relations: ['variable_bundle']
      });

    const assignedVariableBundles = codingJobVariableBundles
      .filter(bundle => bundle.variable_bundle)
      .map(bundle => ({
        name: bundle.variable_bundle.name,
        variables: bundle.variable_bundle.variables || []
      }));

    return {
      ...codingJob,
      assignedCoders,
      assignedVariables,
      assignedVariableBundles
    };
  }

  async getResponsesForCodingJob(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<ResponseEntity[]> {
    const jobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const variableRepo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const bundleRepo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;
    const responseRepo = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;

    const codingJob = await jobRepo.findOne({ where: { id: codingJobId } });
    if (!codingJob) {
      return [];
    }

    const codingJobVariables = await variableRepo.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await bundleRepo.find({
      where: { coding_job_id: codingJobId },
      relations: ['variable_bundle']
    });

    const allVariables: { unit_name: string; variable_id: string }[] =
      codingJobVariables.map(v => ({
        unit_name: v.unit_name,
        variable_id: v.variable_id
      }));
    codingJobVariableBundles.forEach(bundle => {
      if (bundle.variable_bundle?.variables) {
        bundle.variable_bundle.variables.forEach(variable => {
          allVariables.push({
            unit_name: variable.unitName,
            variable_id: variable.variableId
          });
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const queryBuilder = responseRepo
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', {
        workspaceId: codingJob.workspace_id
      })
      .andWhere('person.consider = :consider', { consider: true });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(
        `(unit.name = :${unitParam} AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    // Exclude aggregated duplicates (marked with code_v2 = -111)
    queryBuilder.andWhere(
      '(response.code_v2 IS NULL OR response.code_v2 != -111)'
    );
    queryBuilder.andWhere(
      '(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)',
      { completedV2Status: statusStringToNumber('CODING_COMPLETE') }
    );
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    return queryBuilder.orderBy('response.id', 'ASC').getMany();
  }

  async saveCodingProgress(
    codingJobId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    return this.connection.transaction(async manager => {
      const codingJobRepository = manager.getRepository(CodingJob);
      const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
      const codingJob = await codingJobRepository.findOne({
        where: { id: codingJobId }
      });

      if (!codingJob) {
        throw new NotFoundException(
          `Coding job with ID ${codingJobId} not found`
        );
      }

      if (['review', 'results_applied'].includes(codingJob.status)) {
        throw new BadRequestException(
          `Cannot save progress for a coding job with status ${codingJob.status}`
        );
      }

      const codingJobUnit = await this.getCodingJobUnitForEntry(
        codingJob,
        progress,
        'Coding job unit not found for progress entry',
        manager,
        true
      );

      const selectedCode = await this.validateProgressSelectedCode(
        progress,
        codingJobUnit,
        codingJob.workspace_id,
        codingJob.allowComments !== false
      );

      this.applyProgressToCodingJobUnit(
        codingJobUnit,
        progress,
        selectedCode
      );

      await codingJobUnitRepository.save(codingJobUnit);

      await this.checkAndUpdateCodingJobCompletion(codingJobId, manager);

      return codingJob;
    });
  }

  private applyProgressToCodingJobUnit(
    codingJobUnit: CodingJobUnit,
    progress: SaveCodingProgressDto,
    selectedCode: NonNullable<SaveCodingProgressDto['selectedCode']> | null
  ): void {
    if (progress.isOpen === true) {
      codingJobUnit.is_open = true;
      codingJobUnit.code = null;
      codingJobUnit.score = null;
      codingJobUnit.coding_issue_option = null;
    } else if (selectedCode === null) {
      codingJobUnit.code = null;
      codingJobUnit.score = null;
      codingJobUnit.coding_issue_option = null;
      codingJobUnit.is_open = false;
    } else {
      codingJobUnit.code = selectedCode.id;
      codingJobUnit.is_open = false;
      const score = selectedCode.score;
      if (score !== undefined && score !== null) {
        codingJobUnit.score = score;
      } else {
        codingJobUnit.score = null;
      }
      codingJobUnit.coding_issue_option =
        selectedCode.codingIssueOption ?? null;
    }

    if (progress.notes !== undefined) {
      codingJobUnit.notes = progress.notes || null;
    }
  }

  private clearNewCodeNeededProgressWithoutNotes(
    codingJobUnit: CodingJobUnit
  ): boolean {
    if (codingJobUnit.notes) return false;
    if (
      codingJobUnit.coding_issue_option === -2 &&
      codingJobUnit.code !== null &&
      codingJobUnit.code >= 0
    ) {
      codingJobUnit.coding_issue_option = null;
      return false;
    }
    if (codingJobUnit.code !== -2 && codingJobUnit.coding_issue_option !== -2) {
      return false;
    }

    codingJobUnit.code = null;
    codingJobUnit.score = null;
    codingJobUnit.coding_issue_option = null;
    codingJobUnit.is_open = false;
    return true;
  }

  private async reopenCodingJobAfterProgressCleared(
    codingJob: CodingJob,
    manager?: EntityManager
  ): Promise<void> {
    if (!['completed', 'open'].includes(codingJob.status)) return;
    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    await codingJobRepository.update(codingJob.id, { status: 'active' });
  }

  private getCodingJobUnitWhereForEntry(
    codingJobId: number,
    entry: Pick<SaveCodingProgressDto, 'testPerson' | 'unitId' | 'variableId'>
  ): Partial<CodingJobUnit> {
    const {
      login: personLogin,
      code: personCode,
      group: personGroup,
      booklet: bookletName
    } = parseCodingTestPerson(entry.testPerson);

    const whereCondition: Partial<CodingJobUnit> = {
      coding_job_id: codingJobId,
      unit_name: entry.unitId,
      variable_id: entry.variableId,
      person_login: personLogin,
      person_code: personCode,
      booklet_name: bookletName
    };

    if (personGroup !== undefined) {
      whereCondition.person_group = personGroup;
    }

    return whereCondition;
  }

  private async getCodingJobUnitForEntry(
    codingJob: Pick<CodingJob, 'id' | 'workspace_id'>,
    entry: Pick<SaveCodingProgressDto, 'testPerson' | 'unitId' | 'variableId'>,
    notFoundMessage: string,
    manager?: EntityManager,
    lockRows = false
  ): Promise<CodingJobUnit> {
    const codingJobUnitRepository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const findOptions: FindOneOptions<CodingJobUnit> = {
      where: this.getCodingJobUnitWhereForEntry(codingJob.id, entry)
    };

    if (lockRows) {
      findOptions.lock = { mode: 'pessimistic_write' };
    }

    const codingJobUnit = await codingJobUnitRepository.findOne(findOptions);

    if (!codingJobUnit) {
      throw new NotFoundException(notFoundMessage);
    }

    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    if (
      isExcludedByResolvedExclusions(
        exclusions,
        codingJobUnit.booklet_name,
        codingJobUnit.unit_name
      )
    ) {
      throw new NotFoundException(notFoundMessage);
    }

    return codingJobUnit;
  }

  private async getOrCreateCodingIssueReviewJob(
    sourceCodingJob: CodingJob,
    reviewerUserId: number
  ): Promise<CodingJob> {
    const existingReviewJob =
      await this.getCodingIssueReviewJobForReviewer(
        sourceCodingJob,
        reviewerUserId
      );

    if (existingReviewJob) {
      return existingReviewJob;
    }

    try {
      return await this.connection.transaction(async manager => {
        const codingJobRepository = manager.getRepository(CodingJob);
        const codingJobCoderRepository = manager.getRepository(CodingJobCoder);
        const reviewJob = codingJobRepository.create({
          workspace_id: sourceCodingJob.workspace_id,
          name: `${sourceCodingJob.name} - Kodierungshinweisprüfung`,
          description: sourceCodingJob.description,
          comment: null,
          job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
          source_coding_job_id: sourceCodingJob.id,
          reviewer_user_id: reviewerUserId,
          status: 'completed',
          showScore: sourceCodingJob.showScore,
          allowComments: sourceCodingJob.allowComments,
          suppressGeneralInstructions: sourceCodingJob.suppressGeneralInstructions,
          training_id: sourceCodingJob.training_id,
          missings_profile_id: sourceCodingJob.missings_profile_id,
          job_definition_id: sourceCodingJob.job_definition_id,
          case_ordering_mode: sourceCodingJob.case_ordering_mode,
          aggregation_enabled: sourceCodingJob.aggregation_enabled,
          aggregation_threshold: sourceCodingJob.aggregation_threshold,
          response_matching_flags: sourceCodingJob.response_matching_flags,
          aggregation_settings_version: sourceCodingJob.aggregation_settings_version,
          freshness_status: sourceCodingJob.freshness_status || 'current',
          freshness_reason: sourceCodingJob.freshness_reason || null,
          freshness_affected_units: 0,
          freshness_affected_responses: 0
        });
        const savedReviewJob = await codingJobRepository.save(reviewJob);
        const savedCoder = await codingJobCoderRepository.save(
          codingJobCoderRepository.create({
            coding_job_id: savedReviewJob.id,
            user_id: reviewerUserId
          })
        );

        return {
          ...savedReviewJob,
          codingJobCoders: [savedCoder]
        } as CodingJob;
      });
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        const concurrentReviewJob =
          await this.getCodingIssueReviewJobForReviewer(
            sourceCodingJob,
            reviewerUserId
          );

        if (concurrentReviewJob) {
          return concurrentReviewJob;
        }
      }

      throw error;
    }
  }

  private async getCodingIssueReviewJobForReviewer(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>,
    reviewerUserId: number
  ): Promise<CodingJob | undefined> {
    const existingReviewJobs =
      await this.getCodingIssueReviewJobsForSource(sourceCodingJob);

    return existingReviewJobs.find(job => (
      job.reviewer_user_id === reviewerUserId ||
      job.codingJobCoders?.some(coder => coder.user_id === reviewerUserId)
    ));
  }

  private getCodingIssueReviewUnitWhere(
    reviewJobId: number,
    sourceUnit: CodingJobUnit
  ): Partial<CodingJobUnit> {
    return {
      coding_job_id: reviewJobId,
      response_id: sourceUnit.response_id,
      unit_name: sourceUnit.unit_name,
      variable_id: sourceUnit.variable_id,
      person_login: sourceUnit.person_login,
      person_code: sourceUnit.person_code,
      person_group: sourceUnit.person_group,
      booklet_name: sourceUnit.booklet_name
    };
  }

  private async findCodingIssueReviewUnit(
    sourceUnit: CodingJobUnit,
    reviewJob: CodingJob
  ): Promise<CodingJobUnit | null> {
    return this.codingJobUnitRepository.findOne({
      where: this.getCodingIssueReviewUnitWhere(reviewJob.id, sourceUnit)
    });
  }

  private async getOrCreateCodingIssueReviewUnit(
    sourceCodingJob: CodingJob,
    sourceUnit: CodingJobUnit,
    reviewJob: CodingJob
  ): Promise<CodingJobUnit> {
    const existingReviewUnit = await this.findCodingIssueReviewUnit(
      sourceUnit,
      reviewJob
    );

    if (existingReviewUnit) {
      return existingReviewUnit;
    }

    return this.codingJobUnitRepository.create({
      coding_job_id: reviewJob.id,
      workspace_id: sourceCodingJob.workspace_id,
      response_id: sourceUnit.response_id,
      unit_name: sourceUnit.unit_name,
      unit_alias: sourceUnit.unit_alias,
      variable_id: sourceUnit.variable_id,
      variable_anchor: sourceUnit.variable_anchor,
      variable_bundle_id: sourceUnit.variable_bundle_id,
      booklet_name: sourceUnit.booklet_name,
      person_login: sourceUnit.person_login,
      person_code: sourceUnit.person_code,
      person_group: sourceUnit.person_group,
      code: null,
      score: null,
      is_open: false,
      notes: sourceUnit.notes,
      supervisor_comment: null,
      coding_issue_option: null
    });
  }

  async saveCodingIssueReviewProgress(
    sourceCodingJobId: number,
    reviewerUserId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    const sourceCodingJob = await this.codingJobRepository.findOne({
      where: { id: sourceCodingJobId }
    });

    if (!sourceCodingJob) {
      throw new NotFoundException(
        `Coding job with ID ${sourceCodingJobId} not found`
      );
    }

    if (sourceCodingJob.status === 'results_applied') {
      throw new BadRequestException(
        'Cannot save progress for a coding job whose results have already been applied'
      );
    }
    this.assertCodingIssueReviewSourceJobStatus(sourceCodingJob);

    const sourceUnit = await this.getCodingJobUnitForEntry(
      sourceCodingJob,
      progress,
      'Coding job unit not found for progress entry'
    );
    this.assertCodingIssueReviewSourceUnit(sourceUnit);

    const selectedCode = await this.validateProgressSelectedCode(
      progress,
      sourceUnit,
      sourceCodingJob.workspace_id,
      sourceCodingJob.allowComments !== false
    );

    if (progress.isOpen !== true && selectedCode === null) {
      const existingReviewJob =
        await this.getCodingIssueReviewJobForReviewer(
          sourceCodingJob,
          reviewerUserId
        );
      const existingReviewUnit = existingReviewJob ?
        await this.findCodingIssueReviewUnit(sourceUnit, existingReviewJob) :
        null;

      if (!existingReviewUnit) {
        return sourceCodingJob;
      }

      this.applyProgressToCodingJobUnit(existingReviewUnit, progress, selectedCode);
      await this.codingJobUnitRepository.save(existingReviewUnit);

      return sourceCodingJob;
    }

    const reviewJob = await this.getOrCreateCodingIssueReviewJob(
      sourceCodingJob,
      reviewerUserId
    );
    const reviewUnit = await this.getOrCreateCodingIssueReviewUnit(
      sourceCodingJob,
      sourceUnit,
      reviewJob
    );

    this.applyProgressToCodingJobUnit(reviewUnit, progress, selectedCode);
    await this.codingJobUnitRepository.save(reviewUnit);

    return sourceCodingJob;
  }

  private async validateProgressSelectedCode(
    progress: SaveCodingProgressDto,
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    allowComments: boolean
  ): Promise<NonNullable<SaveCodingProgressDto['selectedCode']> | null> {
    if (progress.isOpen === true) {
      return null;
    }

    const selectedCode = progress.selectedCode;
    if (selectedCode === null) {
      return null;
    }

    if (!selectedCode || typeof selectedCode !== 'object') {
      throw new BadRequestException(
        'selectedCode must be an object, null, or omitted only when isOpen is true'
      );
    }

    if (!Number.isInteger(selectedCode.id)) {
      throw new BadRequestException('selectedCode.id must be an integer');
    }

    const allowedIssueCodes = new Set([-1, -2, -3, -4]);
    if (selectedCode.id < 0 && !allowedIssueCodes.has(selectedCode.id)) {
      throw new BadRequestException(
        `Unsupported coding issue code: ${selectedCode.id}`
      );
    }

    if (
      selectedCode.codingIssueOption !== undefined &&
      selectedCode.codingIssueOption !== null &&
      !allowedIssueCodes.has(selectedCode.codingIssueOption)
    ) {
      throw new BadRequestException(
        `Unsupported coding issue option: ${selectedCode.codingIssueOption}`
      );
    }

    const commentBoundIssueCodes = new Set([-1, -2]);
    const codingIssueOption = selectedCode.codingIssueOption ?? null;
    if (
      !allowComments &&
      (commentBoundIssueCodes.has(selectedCode.id) ||
        (codingIssueOption !== null && commentBoundIssueCodes.has(codingIssueOption)))
    ) {
      throw new BadRequestException(
        'Coding issue options requiring comments are disabled for this coding job'
      );
    }

    if (
      selectedCode.id === -1 ||
      (selectedCode.codingIssueOption === -1 && selectedCode.id < 0)
    ) {
      throw new BadRequestException(
        'Code assignment uncertain requires a regular code'
      );
    }

    const newCodeNeededCode = -2;
    const nextNotes = Object.prototype.hasOwnProperty.call(progress, 'notes') ?
      progress.notes :
      codingJobUnit.notes;
    if (
      (selectedCode.id === newCodeNeededCode ||
        selectedCode.codingIssueOption === newCodeNeededCode) &&
      !(nextNotes ?? '').trim()
    ) {
      throw new BadRequestException(
        'New code needed requires coder notes'
      );
    }

    if (selectedCode.id < 0) {
      selectedCode.score = null;
      return selectedCode;
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(
      codingJobUnit,
      workspaceId,
      selectedCode.id
    );
    if (!this.hasManualInstruction(schemeCode)) {
      throw new BadRequestException(
        `Code is not available for manual coding: ${selectedCode.id}`
      );
    }
    selectedCode.score = schemeCode.score ?? null;

    if (
      selectedCode.score !== undefined &&
      selectedCode.score !== null &&
      !Number.isFinite(selectedCode.score)
    ) {
      throw new BadRequestException(
        'selectedCode.score must be a finite number'
      );
    }

    return selectedCode;
  }

  private hasManualInstruction(code: { manualInstruction?: string | null }): boolean {
    return hasVisibleManualInstruction(code);
  }

  async getCodingSchemeScoreForUnitCode(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number
  ): Promise<number | null> {
    if (!Number.isInteger(codeId) || codeId < 0) {
      throw new BadRequestException(
        `Unsupported coding scheme code: ${codeId}`
      );
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(
      codingJobUnit,
      workspaceId,
      codeId
    );
    return schemeCode.score ?? null;
  }

  private async getCodingSchemeCodeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number
  ): Promise<CodingSchemeCode> {
    const codingScheme = await this.getRequiredCodingSchemeForUnit(
      codingJobUnit,
      workspaceId
    );
    const variableCoding = this.findVariableCoding(
      codingScheme,
      codingJobUnit.variable_id
    );
    if (!variableCoding?.codes) {
      throw new BadRequestException(
        `Coding scheme variable not found: ${codingJobUnit.variable_id}`
      );
    }

    const schemeCode = variableCoding.codes.find(
      code => Number(code.id) === codeId
    );
    if (!schemeCode) {
      throw new BadRequestException(
        `Unsupported code for variable ${codingJobUnit.variable_id}: ${codeId}`
      );
    }

    return schemeCode;
  }

  private findVariableCoding(
    codingScheme: CodingScheme,
    variableId: string
  ): CodingSchemeVariableCoding | undefined {
    const normalizedVariableId = String(variableId || '').trim();
    if (!normalizedVariableId) {
      return undefined;
    }

    const variableCodings = codingScheme.variableCodings || [];
    return variableCodings.find(
      vc => String(vc.alias || '').trim() === normalizedVariableId
    ) || variableCodings.find(
      vc => String(vc.id || '').trim() === normalizedVariableId
    );
  }

  private async getCodingSchemeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number
  ): Promise<CodingScheme | undefined> {
    const codingSchemesByUnit = await this.getCodingSchemesForUnits(
      [codingJobUnit],
      workspaceId
    );
    return codingSchemesByUnit.get(codingJobUnit);
  }

  private async getCodingSchemesForUnits(
    codingJobUnits: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<CodingJobUnit, CodingScheme>> {
    const codingSchemesByUnit = new Map<CodingJobUnit, CodingScheme>();
    const unitFileCandidatesByUnit = new Map<CodingJobUnit, string[]>();
    const unitFileIds = new Set<string>();

    codingJobUnits.forEach(unit => {
      const candidates = this.getUnitFileIdCandidates(unit);
      if (candidates.length > 0) {
        unitFileCandidatesByUnit.set(unit, candidates);
        candidates.forEach(candidate => unitFileIds.add(candidate));
      }
    });

    if (unitFileIds.size === 0) {
      return codingSchemesByUnit;
    }

    const unitFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In([...unitFileIds])
      },
      select: ['file_id', 'data']
    });
    const unitFileById = new Map(unitFiles.map(file => [file.file_id, file]));
    const codingSchemeRefsByUnit = new Map<CodingJobUnit, string[]>();
    const codingSchemeRefs = new Set<string>();

    codingJobUnits.forEach(unit => {
      const unitFile = this.findFileByCandidates(
        unitFileById,
        unitFileCandidatesByUnit.get(unit) ?? []
      );
      if (!unitFile) {
        return;
      }

      const codingSchemeRef = this.extractCodingSchemeRef(unitFile);
      if (!codingSchemeRef) {
        return;
      }

      const refs = this.getCodingSchemeFileIdCandidates(codingSchemeRef);
      codingSchemeRefsByUnit.set(unit, refs);
      refs.forEach(ref => codingSchemeRefs.add(ref));
    });

    if (codingSchemeRefs.size === 0) {
      return codingSchemesByUnit;
    }

    const codingSchemes = await this.getCodingSchemes(
      [...codingSchemeRefs],
      workspaceId
    );
    codingSchemeRefsByUnit.forEach((refs, unit) => {
      const scheme = refs
        .map(ref => codingSchemes.get(ref))
        .find(
          (candidate): candidate is CodingScheme => candidate !== undefined
        );
      if (scheme) {
        codingSchemesByUnit.set(unit, scheme);
      }
    });

    return codingSchemesByUnit;
  }

  private async getRequiredCodingSchemeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number
  ): Promise<CodingScheme> {
    const codingScheme = await this.getCodingSchemeForUnit(
      codingJobUnit,
      workspaceId
    );
    if (!codingScheme) {
      throw new BadRequestException(
        'Coding scheme not found for coding job unit'
      );
    }

    return codingScheme;
  }

  private getUnitFileIdCandidates(codingJobUnit: CodingJobUnit): string[] {
    return this.getFileIdCandidates(
      codingJobUnit.unit_alias,
      codingJobUnit.unit_name,
      '.XML'
    );
  }

  private getCodingSchemeFileIdCandidates(codingSchemeRef: string): string[] {
    return this.getFileIdCandidates(codingSchemeRef, null, '.VOCS');
  }

  private getFileIdCandidates(
    primaryRef: string | null | undefined,
    fallbackRef: string | null | undefined,
    extension: '.XML' | '.VOCS'
  ): string[] {
    const candidates = new Set<string>();

    [primaryRef, fallbackRef].forEach(ref => {
      const trimmedRef = ref?.trim();
      if (!trimmedRef) {
        return;
      }

      const upperRef = trimmedRef.toUpperCase();
      const withoutExtension = upperRef.endsWith(extension) ?
        upperRef.slice(0, -extension.length) :
        upperRef;
      const basename = withoutExtension.split('/').pop();

      candidates.add(trimmedRef);
      candidates.add(upperRef);
      candidates.add(withoutExtension);
      candidates.add(`${withoutExtension}${extension}`);

      if (basename) {
        candidates.add(basename);
        candidates.add(`${basename}${extension}`);
      }
    });

    return [...candidates];
  }

  private findFileByCandidates(
    fileById: Map<string, FileUpload>,
    candidates: string[]
  ): FileUpload | undefined {
    return candidates
      .map(candidate => fileById.get(candidate))
      .find((file): file is FileUpload => file !== undefined);
  }

  private extractCodingSchemeRef(unitFile: FileUpload): string | null {
    try {
      const $ = cheerio.load(String(unitFile.data ?? ''));
      return (
        $('codingSchemeRef').first().text().trim() ||
        $('CodingSchemeRef').first().text().trim() ||
        null
      );
    } catch (error) {
      this.logger.warn(
        `Could not parse unit file ${unitFile.file_id}: ${error.message}`
      );
      return null;
    }
  }

  async saveCodingNotes(
    codingJobId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> {
    return this.connection.transaction(async manager => {
      const codingJobRepository = manager.getRepository(CodingJob);
      const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
      const codingJob = await codingJobRepository.findOne({
        where: { id: codingJobId }
      });

      if (!codingJob) {
        throw new NotFoundException(
          `Coding job with ID ${codingJobId} not found`
        );
      }

      if (['review', 'results_applied'].includes(codingJob.status)) {
        throw new BadRequestException(
          `Cannot save notes for a coding job with status ${codingJob.status}`
        );
      }

      const codingJobUnit = await this.getCodingJobUnitForEntry(
        codingJob,
        notesDto,
        'Coding job unit not found for notes entry',
        manager,
        true
      );

      codingJobUnit.notes = notesDto.notes?.trim() || null;
      const clearedProgress = this.clearNewCodeNeededProgressWithoutNotes(codingJobUnit);
      await codingJobUnitRepository.save(codingJobUnit);
      if (clearedProgress) {
        await this.reopenCodingJobAfterProgressCleared(codingJob, manager);
      }

      return codingJob;
    });
  }

  async saveCodingIssueReviewNotes(
    sourceCodingJobId: number,
    reviewerUserId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> {
    const sourceCodingJob = await this.codingJobRepository.findOne({
      where: { id: sourceCodingJobId }
    });

    if (!sourceCodingJob) {
      throw new NotFoundException(
        `Coding job with ID ${sourceCodingJobId} not found`
      );
    }

    if (sourceCodingJob.status === 'results_applied') {
      throw new BadRequestException(
        'Cannot save notes for a coding job whose results have already been applied'
      );
    }
    this.assertCodingIssueReviewSourceJobStatus(sourceCodingJob);

    const sourceUnit = await this.getCodingJobUnitForEntry(
      sourceCodingJob,
      notesDto,
      'Coding job unit not found for notes entry'
    );
    this.assertCodingIssueReviewSourceUnit(sourceUnit);

    const reviewJob = await this.getCodingIssueReviewJobForReviewer(
      sourceCodingJob,
      reviewerUserId
    );
    const reviewUnit = reviewJob ?
      await this.findCodingIssueReviewUnit(sourceUnit, reviewJob) :
      null;

    if (!reviewUnit) {
      if (!this.codingJobUnitHasRegularCode(sourceUnit)) {
        return sourceCodingJob;
      }

      const effectiveReviewJob = reviewJob ??
        await this.getOrCreateCodingIssueReviewJob(
          sourceCodingJob,
          reviewerUserId
        );
      const createdReviewUnit = await this.getOrCreateCodingIssueReviewUnit(
        sourceCodingJob,
        sourceUnit,
        effectiveReviewJob
      );
      createdReviewUnit.code = sourceUnit.code;
      createdReviewUnit.score = sourceUnit.score;
      createdReviewUnit.is_open = false;
      createdReviewUnit.coding_issue_option = null;
      createdReviewUnit.notes = notesDto.notes?.trim() || null;
      this.clearNewCodeNeededProgressWithoutNotes(createdReviewUnit);
      await this.codingJobUnitRepository.save(createdReviewUnit);

      return sourceCodingJob;
    }

    reviewUnit.notes = notesDto.notes?.trim() || null;
    this.clearNewCodeNeededProgressWithoutNotes(reviewUnit);
    await this.codingJobUnitRepository.save(reviewUnit);

    return sourceCodingJob;
  }

  async getCodingProgress(
    codingJobId: number
  ): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const codingJobUnits = await this.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    if (codingJobUnits.length === 0) {
      return {};
    }

    const codedUnits = codingJobUnits.filter(
      unit => unit.code !== null && unit.code >= 0
    );
    const codingSchemesByUnit = await this.getCodingSchemesForUnits(
      codedUnits,
      codingJob.workspace_id
    );

    const progressMap: Record<string, SaveCodingProgressDto['selectedCode']> =
      {};

    const setProgressEntry = (unit: CodingJobUnit, compositeKey: string) => {
      const progressCode = unit.code ?? unit.coding_issue_option;
      if (progressCode === null) {
        return;
      }

      const codingScheme = progressCode >= 0 ?
        codingSchemesByUnit.get(unit) :
        undefined;
      let code: string | undefined;
      let label: string | undefined;

      if (codingScheme) {
        const variableCoding = this.findVariableCoding(
          codingScheme,
          unit.variable_id
        );
        if (variableCoding?.codes) {
          const codeEntry = variableCoding.codes.find(
            c => Number(c.id) === progressCode
          );
          if (codeEntry) {
            code = codeEntry.code;
            label = codeEntry.label;
          }
        }
      }

      progressMap[compositeKey] = {
        id: progressCode,
        code,
        label
      };

      if (unit.score !== null) {
        progressMap[compositeKey].score = unit.score;
      }

      if (unit.coding_issue_option !== null) {
        progressMap[compositeKey].codingIssueOption =
          unit.coding_issue_option;
      }
    };

    codingJobUnits.forEach(unit => {
      const compositeKey = this.getCodingJobUnitProgressKey(unit);

      if (unit.is_open) {
        progressMap[`${compositeKey}:open`] = {
          id: -1,
          code: '',
          label: 'OPEN'
        };
        if (this.codingJobUnitRequiresIssueReview(unit)) {
          setProgressEntry(unit, compositeKey);
        }
      } else if (unit.code !== null) {
        setProgressEntry(unit, compositeKey);
      }
    });

    return progressMap;
  }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const codingJobUnits = await this.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    if (codingJobUnits.length === 0) {
      return {};
    }

    const notesMap: Record<string, string> = {};

    codingJobUnits.forEach(unit => {
      if (unit.notes) {
        const compositeKey = this.getCodingJobUnitProgressKey(unit);
        notesMap[compositeKey] = unit.notes;
      }
    });

    return notesMap;
  }

  async getCodingJobUnits(
    codingJobId: number,
    onlyOpen: boolean = false
  ): Promise<
    {
      responseId: number;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      variableAnchor: string;
      variablePage: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string;
      notes: string | null;
      variableBundleId: number | null;
      bundleContext: CodingJobBundleContext | null;
      isDoubleCoded: boolean;
      otherCoders: string[];
    }[]
    > {
    const whereClause: { coding_job_id: number; is_open?: boolean } = {
      coding_job_id: codingJobId
    };

    if (onlyOpen) {
      whereClause.is_open = true;
    }

    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      relations: ['codingJobCoders', 'codingJobCoders.user']
    });
    if (!codingJob) {
      return [];
    }

    const globalMode = codingJob.case_ordering_mode || 'continuous';

    const bundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: codingJobId },
      order: { id: 'ASC' }
    });

    const bundleModes = new Map<number, string>();
    for (const b of bundles) {
      bundleModes.set(b.variable_bundle_id, b.case_ordering_mode || globalMode);
    }

    const codingJobUnitSelect: (keyof CodingJobUnit)[] = [
      'response_id',
      'unit_name',
      'unit_alias',
      'variable_id',
      'variable_anchor',
      'booklet_name',
      'person_login',
      'person_code',
      'person_group',
      'notes',
      'variable_bundle_id',
      'code',
      'score',
      'is_open'
    ];

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: whereClause,
      select: codingJobUnitSelect
    });
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    const visibleCodingJobUnits = codingJobUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
    const visibleCodingJobUnitsForContext = onlyOpen ?
      (await this.codingJobUnitRepository.find({
        where: { coding_job_id: codingJobId },
        select: codingJobUnitSelect
      })).filter(
        unit => !isExcludedByResolvedExclusions(
          exclusions,
          unit.booklet_name,
          unit.unit_name
        )
      ) :
      visibleCodingJobUnits;

    // Detect double coding and other coders in the same logical coding scope.
    const responseIds = visibleCodingJobUnits.map(unit => unit.response_id);
    const otherCodersMap = new Map<number, Set<string>>();
    const currentCoderIds = new Set(
      (codingJob.codingJobCoders || []).map(cjc => cjc.user_id)
    );

    if (responseIds.length > 0) {
      const otherUnits = await this.codingJobUnitRepository.find({
        where: {
          response_id: In(responseIds),
          coding_job_id: Not(codingJobId)
        },
        relations: [
          'coding_job',
          'coding_job.codingJobCoders',
          'coding_job.codingJobCoders.user'
        ]
      });

      otherUnits.forEach(unit => {
        const otherJob = unit.coding_job;
        if (
          !otherJob ||
          otherJob.workspace_id !== codingJob.workspace_id ||
          !this.isComparableDoubleCodingScope(codingJob, otherJob)
        ) {
          return;
        }

        if (!otherCodersMap.has(unit.response_id)) {
          otherCodersMap.set(unit.response_id, new Set<string>());
        }
        const coderSet = otherCodersMap.get(unit.response_id)!;
        otherJob.codingJobCoders?.forEach(cjc => {
          if (currentCoderIds.has(cjc.user_id)) {
            return;
          }
          if (cjc.user) {
            coderSet.add(cjc.user.username || `Coder ${cjc.user_id}`);
          }
        });
      });
    }

    const buckets = new Map<number | 'unbundled', CodingJobUnit[]>();
    for (const b of bundles) {
      buckets.set(b.variable_bundle_id, []);
    }
    buckets.set('unbundled', []);

    for (const unit of visibleCodingJobUnits) {
      const key = unit.variable_bundle_id || 'unbundled';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(unit);
    }

    let sortedUnits: CodingJobUnit[] = [];
    for (const [key, units] of buckets.entries()) {
      const mode =
        key === 'unbundled' ?
          globalMode :
          bundleModes.get(key as number) || globalMode;
      units.sort(
        mode === 'alternating' ? sortUnitsAlternating : sortUnitsContinuous
      );
      sortedUnits = sortedUnits.concat(units);
    }

    const variablePageMaps = await this.getVariablePageMapsForUnits(
      visibleCodingJobUnitsForContext,
      codingJob.workspace_id
    );
    const variableAnchorMaps = await this.getVariableAnchorMapsForUnits(
      visibleCodingJobUnitsForContext,
      codingJob.workspace_id
    );
    const bundleContextByResponseId =
      await this.getCodingJobBundleContextsForUnits(
        sortedUnits,
        bundles,
        bundleModes,
        globalMode,
        variablePageMaps,
        variableAnchorMaps,
        codingJob.workspace_id,
        visibleCodingJobUnitsForContext
      );

    return sortedUnits.map(unit => {
      const otherCoders = Array.from(
        otherCodersMap.get(unit.response_id) || []
      );
      const variablePage =
        variablePageMaps.get(unit.unit_name)?.get(unit.variable_id) || '0';
      const variableAnchor =
        variableAnchorMaps.get(unit.unit_name)?.get(unit.variable_id) ||
        unit.variable_anchor;
      return {
        responseId: unit.response_id,
        unitName: unit.unit_name,
        unitAlias: unit.unit_alias,
        variableId: unit.variable_id,
        variableAnchor,
        variablePage,
        bookletName: unit.booklet_name,
        personLogin: unit.person_login,
        personCode: unit.person_code,
        personGroup: unit.person_group,
        notes: unit.notes,
        variableBundleId: unit.variable_bundle_id,
        bundleContext: bundleContextByResponseId.get(unit.response_id) || null,
        isDoubleCoded: otherCoders.length > 0,
        otherCoders: otherCoders
      };
    });
  }

  private getCodingJobBundleUnitCaseKey(
    unit: Pick<
    CodingJobUnit,
    | 'person_login'
    | 'person_code'
    | 'person_group'
    | 'booklet_name'
    >
  ): string {
    return [
      unit.person_login,
      unit.person_code,
      unit.person_group,
      unit.booklet_name
    ].join('\u0000');
  }

  private getCodingJobBundleResponseCaseKey(
    response: ResponseEntity
  ): string {
    return [
      response.unit?.booklet?.person?.login || '',
      response.unit?.booklet?.person?.code || '',
      response.unit?.booklet?.person?.group || '',
      response.unit?.booklet?.bookletinfo?.name || ''
    ].join('\u0000');
  }

  private getCodingJobBundleVariableStatus(
    response: ResponseEntity | undefined,
    manualUnit: CodingJobUnit | undefined
  ): {
      status: CodingJobBundleVariableStatus;
      code: number | null;
      score: number | null;
      source: 'manual' | 'auto' | 'none';
    } {
    if (manualUnit) {
      const hasManualCode =
        manualUnit.code !== null &&
        manualUnit.code !== undefined;
      return {
        status: hasManualCode || manualUnit.is_open === false ?
          'manual-coded' :
          'manual-open',
        code: manualUnit.code ?? null,
        score: manualUnit.score ?? null,
        source: 'manual'
      };
    }

    if (!response) {
      return {
        status: 'not-available',
        code: null,
        score: null,
        source: 'none'
      };
    }

    const latestCode = getLatestCode(response);
    if (
      response.is_autocoder_generated === true ||
      latestCode.code !== null ||
      response.status_v1 !== null
    ) {
      return {
        status: latestCode.code !== null || response.is_autocoder_generated === true ?
          'auto-coded' :
          'not-coded',
        code: latestCode.code ?? null,
        score: latestCode.score ?? null,
        source: latestCode.code !== null || response.is_autocoder_generated === true ?
          'auto' :
          'none'
      };
    }

    return {
      status: 'not-coded',
      code: null,
      score: null,
      source: 'none'
    };
  }

  private async getCodingJobBundleContextsForUnits(
    units: CodingJobUnit[],
    codingJobBundles: CodingJobVariableBundle[],
    bundleModes: Map<number, string>,
    globalMode: string,
    variablePageMaps: Map<string, Map<string, string>>,
    variableAnchorMaps: Map<string, Map<string, string>>,
    workspaceId: number,
    contextUnits: CodingJobUnit[] = units
  ): Promise<Map<number, CodingJobBundleContext>> {
    const bundledUnits = units.filter(
      unit => unit.variable_bundle_id !== null
    );
    if (bundledUnits.length === 0) {
      return new Map();
    }

    const bundleIds = Array.from(
      new Set(
        bundledUnits
          .map(unit => unit.variable_bundle_id)
          .filter((bundleId): bundleId is number => bundleId !== null)
      )
    );
    const variableBundles = await this.variableBundleRepository.find({
      where: {
        id: In(bundleIds),
        workspace_id: workspaceId
      }
    });
    const variableBundleById = new Map(
      variableBundles.map(bundle => [bundle.id, bundle])
    );
    const caseKeys = new Set(
      bundledUnits.map(unit => this.getCodingJobBundleUnitCaseKey(unit))
    );
    const contextBundledUnits = contextUnits.filter(
      unit => unit.variable_bundle_id !== null &&
        caseKeys.has(this.getCodingJobBundleUnitCaseKey(unit))
    );
    const variableIds = Array.from(
      new Set(
        variableBundles.flatMap(bundle => (
          bundle.variables || []
        ).map(variable => variable.variableId))
      )
    );
    const unitNames = Array.from(
      new Set(
        variableBundles.flatMap(bundle => (
          bundle.variables || []
        ).map(variable => variable.unitName))
      )
    );

    if (variableIds.length === 0 || unitNames.length === 0) {
      return new Map();
    }

    const personLogins = Array.from(new Set(bundledUnits.map(unit => unit.person_login)));
    const personCodes = Array.from(new Set(bundledUnits.map(unit => unit.person_code)));
    const personGroups = Array.from(new Set(bundledUnits.map(unit => unit.person_group)));
    const bookletNames = Array.from(new Set(bundledUnits.map(unit => unit.booklet_name)));
    const responses = await this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.variableid IN (:...variableIds)', { variableIds })
      .andWhere('unit.name IN (:...unitNames)', { unitNames })
      .andWhere('person.login IN (:...personLogins)', { personLogins })
      .andWhere('person.code IN (:...personCodes)', { personCodes })
      .andWhere('person.group IN (:...personGroups)', { personGroups })
      .andWhere("COALESCE(bookletinfo.name, '') IN (:...bookletNames)", {
        bookletNames
      })
      .getMany();

    const responseByCaseAndVariable = new Map<string, ResponseEntity>();
    responses.forEach(response => {
      const caseKey = this.getCodingJobBundleResponseCaseKey(response);
      if (!caseKeys.has(caseKey)) {
        return;
      }

      responseByCaseAndVariable.set(
        `${caseKey}\u0000${response.unit?.name || ''}::${response.variableid}`,
        response
      );
    });

    const manualUnitByResponseId = new Map(
      contextBundledUnits.map(unit => [unit.response_id, unit])
    );
    const bundleContextByResponseId = new Map<number, CodingJobBundleContext>();
    const configuredBundleIds = new Set(
      codingJobBundles.map(bundle => bundle.variable_bundle_id)
    );

    bundledUnits.forEach(unit => {
      const bundleId = unit.variable_bundle_id;
      if (bundleId === null || !configuredBundleIds.has(bundleId)) {
        return;
      }

      const variableBundle = variableBundleById.get(bundleId);
      if (!variableBundle) {
        return;
      }

      const caseKey = this.getCodingJobBundleUnitCaseKey(unit);
      const contextVariables = (variableBundle.variables || [])
        .map(variable => {
          const response = responseByCaseAndVariable.get(
            `${caseKey}\u0000${variable.unitName}::${variable.variableId}`
          );
          const manualUnit = response ?
            manualUnitByResponseId.get(response.id) :
            undefined;
          const status = this.getCodingJobBundleVariableStatus(
            response,
            manualUnit
          );

          return {
            responseId: response?.id ?? null,
            unitName: variable.unitName,
            variableId: variable.variableId,
            variableAnchor:
              variableAnchorMaps.get(variable.unitName)?.get(variable.variableId) ||
              variable.variableId,
            variablePage:
              variablePageMaps.get(variable.unitName)?.get(variable.variableId) ||
              '0',
            ...status
          };
        });

      bundleContextByResponseId.set(unit.response_id, {
        bundleId,
        bundleName: variableBundle.name,
        caseKey,
        caseOrderingMode:
          (bundleModes.get(bundleId) || globalMode) === 'alternating' ?
            'alternating' :
            'continuous',
        variables: contextVariables
      });
    });

    return bundleContextByResponseId;
  }

  private async getVariablePageMapsForUnits(
    units: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variablePageMaps = new Map<string, Map<string, string>>();

    if (!this.codingFileCacheService) {
      return variablePageMaps;
    }

    const unitNames = Array.from(
      new Set(
        units
          .map(unit => unit.unit_name)
          .filter(unitName => unitName.length > 0)
      )
    );

    await Promise.all(
      unitNames.map(async unitName => {
        try {
          const pageMap = await this.codingFileCacheService!.getVariablePageMap(
            unitName,
            workspaceId
          );
          variablePageMaps.set(unitName, pageMap);
        } catch (error) {
          this.logger.warn(
            `Error loading variable page map for coding job unit ${unitName}: ${error.message}`
          );
          variablePageMaps.set(unitName, new Map<string, string>());
        }
      })
    );

    return variablePageMaps;
  }

  private async getVariableAnchorMapsForUnits(
    units: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variableAnchorMaps = new Map<string, Map<string, string>>();

    if (!this.replayAnchorService) {
      return variableAnchorMaps;
    }

    const unitNames = Array.from(
      new Set(
        units
          .map(unit => unit.unit_name)
          .filter(unitName => unitName.length > 0)
      )
    );

    try {
      return await this.replayAnchorService.getVariableAnchorMaps(
        unitNames,
        workspaceId
      );
    } catch (error) {
      this.logger.warn(
        `Error loading variable anchor maps for coding job units in workspace ${workspaceId}: ${error.message}`
      );
      unitNames.forEach(unitName => {
        variableAnchorMaps.set(unitName, new Map<string, string>());
      });
      return variableAnchorMaps;
    }
  }

  private isComparableDoubleCodingScope(
    currentJob: CodingJob,
    otherJob: CodingJob
  ): boolean {
    if (currentJob.training_id || otherJob.training_id) {
      return currentJob.training_id === otherJob.training_id;
    }

    if (currentJob.job_definition_id || otherJob.job_definition_id) {
      return currentJob.job_definition_id === otherJob.job_definition_id;
    }

    return true;
  }

  private async getSlimResponsesForCodingJob(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    const jobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const variableRepo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const bundleRepo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;

    const codingJob = await jobRepo.findOne({ where: { id: codingJobId } });
    if (!codingJob) {
      return [];
    }
    const workspaceId = codingJob.workspace_id;

    const codingJobVariables = await variableRepo.find({
      where: { coding_job_id: codingJobId }
    });

    const codingJobVariableBundles = await bundleRepo.find({
      where: { coding_job_id: codingJobId },
      relations: ['variable_bundle']
    });

    const variableBundleMap = new Map<string, number>();
    const allVariables: { unit_name: string; variable_id: string }[] =
      codingJobVariables.map(v => ({
        unit_name: v.unit_name,
        variable_id: v.variable_id
      }));
    codingJobVariableBundles.forEach(bundle => {
      if (bundle.variable_bundle?.variables) {
        bundle.variable_bundle.variables.forEach(variable => {
          allVariables.push({
            unit_name: variable.unitName,
            variable_id: variable.variableId
          });
          variableBundleMap.set(
            `${variable.unitName}::${variable.variableId}`,
            bundle.variable_bundle_id
          );
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const responseRepo = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const queryBuilder = responseRepo
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    this.applyManualCodingCandidateStatusFilter(queryBuilder);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `cjUnitName${index}`;
      const variableParam = `cjVariableId${index}`;
      conditions.push(
        `(unit.name = :${unitParam} AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    queryBuilder.andWhere(
      '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
      {
        aggregatedCode: -111,
        defaultMirCode: await this.getDefaultMirCode(workspaceId)
      }
    );
    queryBuilder.andWhere(
      '(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)',
      { completedV2Status: statusStringToNumber('CODING_COMPLETE') }
    );
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();

    return raw.map(r => {
      const unitName = r.unitName ?? '';
      const variableid = r.variableid;
      return {
        id: Number(r.id),
        variableid: variableid,
        value: r.value ?? null,
        statusV1:
          r.statusV1 !== undefined && r.statusV1 !== null ?
            Number(r.statusV1) :
            null,
        unitName: unitName,
        unitAlias: r.unitAlias ?? null,
        bookletName: r.bookletName ?? '',
        personLogin: r.personLogin ?? '',
        personCode: r.personCode ?? '',
        personGroup: r.personGroup ?? '',
        variableBundleId: variableBundleMap.get(`${unitName}::${variableid}`)
      };
    });
  }

  private async saveCodingJobUnits(
    codingJobId: number,
    maxCodingCases?: number,
    manager?: EntityManager
  ): Promise<void> {
    let responses = await this.getSlimResponsesForCodingJob(
      codingJobId,
      manager
    );

    if (responses.length === 0) {
      return;
    }

    // Get coding job to find workspace ID
    const codingJobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJob = await codingJobRepo.findOne({
      where: { id: codingJobId }
    });
    if (!codingJob) {
      throw new Error(`Coding job ${codingJobId} not found`);
    }
    const workspaceId = codingJob.workspace_id;

    const aggregationSettings =
      await this.getAggregationSettingsForCodingJob(codingJob);
    const aggregationThreshold = aggregationSettings.aggregationThreshold;

    // If aggregation is enabled, filter to unique cases using slim-compatible logic
    if (
      aggregationSettings.aggregationEnabled &&
      aggregationThreshold !== null &&
      aggregationThreshold >= 2
    ) {
      const originalCount = responses.length;
      responses = await this.filterSlimResponsesForAggregation(
        workspaceId,
        responses,
        aggregationThreshold,
        aggregationSettings.responseMatchingFlags
      );
      this.logger.log(
        `Aggregation enabled (threshold: ${aggregationThreshold}). ` +
          `Reduced from ${originalCount} to ${responses.length} cases`
      );
    }

    // Apply maxCodingCases limit if specified
    if (
      maxCodingCases &&
      maxCodingCases > 0 &&
      responses.length > maxCodingCases
    ) {
      // Shuffle responses to ensure random distribution across variables (Fisher-Yates)
      for (let i = responses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [responses[i], responses[j]] = [responses[j], responses[i]];
      }
      responses = responses.slice(0, maxCodingCases);
    }

    const repo = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const BATCH_SIZE = 500;
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const chunk = responses.slice(i, i + BATCH_SIZE);
      const units = chunk.map(r => repo.create({
        coding_job_id: codingJobId,
        workspace_id: workspaceId,
        response_id: r.id,
        unit_name: r.unitName,
        unit_alias: r.unitAlias,
        variable_id: r.variableid,
        variable_anchor: r.variableid,
        booklet_name: r.bookletName,
        person_login: r.personLogin,
        person_code: r.personCode,
        person_group: r.personGroup,
        variable_bundle_id: r.variableBundleId || null
      })
      );
      await repo.save(units);
    }
  }

  private async getCodingSchemes(
    unitAliases: string[],
    workspaceId: number
  ): Promise<Map<string, CodingScheme>> {
    const codingSchemeRefs = unitAliases.filter(alias => alias !== null);
    const codingSchemes = new Map<string, CodingScheme>();

    if (codingSchemeRefs.length === 0) {
      return codingSchemes;
    }

    const codingSchemeFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(codingSchemeRefs)
      },
      select: ['file_id', 'data']
    });

    for (const file of codingSchemeFiles) {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        codingSchemes.set(file.file_id, data);
      } catch (error) {
        codingSchemes.set(file.file_id, {});
      }
    }

    return codingSchemes;
  }

  async restartCodingJobWithOpenUnits(
    codingJobId: number,
    workspaceId: number
  ): Promise<CodingJob> {
    const codingJob = await this.getCodingJob(codingJobId, workspaceId);
    codingJob.codingJob.status = 'open';
    await this.codingJobRepository.save(codingJob.codingJob);

    return codingJob.codingJob;
  }

  private async checkAndUpdateCodingJobCompletion(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<void> {
    const progress = await this.getCodingJobProgress(codingJobId, manager);

    if (
      progress.total > 0 &&
      progress.coded + progress.open >= progress.total
    ) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      const codingJobRepository = manager ?
        manager.getRepository(CodingJob) :
        this.codingJobRepository;
      await codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }

  private async assertCodingJobCanBeCompleted(
    codingJobId: number
  ): Promise<void> {
    const progress = await this.getCodingJobProgress(codingJobId);
    const missingUnits = Math.max(
      0,
      progress.total - progress.coded - progress.open
    );

    if (progress.total === 0) {
      throw new BadRequestException(
        'Cannot complete a coding job without coding units'
      );
    }

    if (
      missingUnits > 0 ||
      progress.open > 0 ||
      progress.coded < progress.total
    ) {
      throw new BadRequestException(
        `Cannot complete coding job ${codingJobId}: ${missingUnits} units are uncoded and ${progress.open} units are open`
      );
    }
  }

  async createCodingJobWithUnitSubset(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto,
    unitSubset: SlimResponse[]
  ): Promise<CodingJob> {
    const savedCodingJob = await this.connection.transaction(manager => this.createCodingJobWithUnitSubsetInManager(
      workspaceId,
      createCodingJobDto,
      unitSubset,
      manager
    )
    );

    await this.invalidateIncompleteVariablesCache(workspaceId);
    return savedCodingJob;
  }

  private async createCodingJobWithUnitSubsetInManager(
    workspaceId: number,
    createCodingJobDto: InternalCreateCodingJobDto,
    unitSubset: SlimResponse[],
    manager: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepo = manager.getRepository(CodingJob);
    const aggregationSettings =
      await this.getCurrentAggregationSettingsSnapshot(workspaceId);
    const missingsProfileId = await this.resolveMissingsProfileId(
      workspaceId,
      createCodingJobDto.missings_profile_id
    );
    const codingJob = codingJobRepo.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending',
      showScore: createCodingJobDto.showScore ?? false,
      allowComments: createCodingJobDto.allowComments ?? true,
      suppressGeneralInstructions:
        createCodingJobDto.suppressGeneralInstructions ?? false,
      missings_profile_id: missingsProfileId,
      job_definition_id: createCodingJobDto.jobDefinitionId,
      case_ordering_mode: createCodingJobDto.caseOrderingMode || 'continuous',
      aggregation_enabled: aggregationSettings.aggregationEnabled,
      aggregation_threshold: aggregationSettings.aggregationThreshold,
      response_matching_flags: aggregationSettings.responseMatchingFlags,
      aggregation_settings_version:
        aggregationSettings.aggregationSettingsVersion
    });

    const savedCodingJob = await codingJobRepo.save(codingJob);

    if (
      createCodingJobDto.assignedCoders &&
      createCodingJobDto.assignedCoders.length > 0
    ) {
      await this.assignCoders(
        savedCodingJob.id,
        createCodingJobDto.assignedCoders,
        manager,
        workspaceId
      );
    }

    if (
      createCodingJobDto.variables &&
      createCodingJobDto.variables.length > 0
    ) {
      await this.assignVariables(
        savedCodingJob.id,
        createCodingJobDto.variables,
        manager
      );
    }

    if (
      createCodingJobDto.variableBundleIds &&
      createCodingJobDto.variableBundleIds.length > 0
    ) {
      await this.assignVariableBundles(
        savedCodingJob.id,
        createCodingJobDto.variableBundleIds,
        manager
      );
    } else if (
      createCodingJobDto.variableBundles &&
      createCodingJobDto.variableBundles.length > 0
    ) {
      if (createCodingJobDto.variableBundles[0].id) {
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(
            savedCodingJob.id,
            bundleIds,
            manager
          );
        }
      } else {
        const variables = createCodingJobDto.variableBundles.flatMap(
          bundle => bundle.variables || []
        );
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables, manager);
        }
      }
    }

    const unitSubsetWithBundleIds =
      await this.attachVariableBundleIdsToResponses(
        createCodingJobDto,
        unitSubset,
        manager
      );

    await this.saveCodingJobUnitsSubset(
      savedCodingJob.id,
      workspaceId,
      unitSubsetWithBundleIds,
      manager
    );

    return savedCodingJob;
  }

  private async attachVariableBundleIdsToResponses(
    createCodingJobDto: InternalCreateCodingJobDto,
    responses: SlimResponse[],
    manager: EntityManager
  ): Promise<SlimResponse[]> {
    if (responses.length === 0) {
      return responses;
    }

    const variableBundleIdByVariable = await this.getVariableBundleIdByVariable(
      createCodingJobDto,
      manager
    );
    if (variableBundleIdByVariable.size === 0) {
      return responses;
    }

    return responses.map(response => {
      if (response.variableBundleId) {
        return response;
      }

      const variableBundleId = variableBundleIdByVariable.get(
        `${response.unitName}::${response.variableid}`
      );
      return variableBundleId ? { ...response, variableBundleId } : response;
    });
  }

  private async getVariableBundleIdByVariable(
    createCodingJobDto: InternalCreateCodingJobDto,
    manager: EntityManager
  ): Promise<Map<string, number>> {
    const bundleVariablesById = new Map<
    number,
    Array<{ unitName: string; variableId: string }>
    >();
    const bundleIds = new Set<number>();

    createCodingJobDto.variableBundleIds?.forEach(id => bundleIds.add(id));
    createCodingJobDto.variableBundles?.forEach(bundle => {
      if (!bundle.id) {
        return;
      }

      bundleIds.add(bundle.id);
      if (bundle.variables?.length) {
        bundleVariablesById.set(bundle.id, bundle.variables);
      }
    });

    if (bundleIds.size === 0) {
      return new Map();
    }

    const missingBundleIds = Array.from(bundleIds).filter(
      id => !bundleVariablesById.has(id)
    );
    if (missingBundleIds.length > 0) {
      const variableBundleRepo = manager.getRepository(VariableBundle);
      const variableBundles = await variableBundleRepo.find({
        where: { id: In(missingBundleIds) }
      });

      variableBundles.forEach(bundle => {
        bundleVariablesById.set(bundle.id, bundle.variables || []);
      });
    }

    const variableBundleIdByVariable = new Map<string, number>();
    bundleVariablesById.forEach((variables, bundleId) => {
      variables.forEach(variable => {
        variableBundleIdByVariable.set(
          `${variable.unitName}::${variable.variableId}`,
          bundleId
        );
      });
    });

    return variableBundleIdByVariable;
  }

  private async saveCodingJobUnitsSubset(
    codingJobId: number,
    workspaceId: number,
    responses: SlimResponse[],
    manager?: EntityManager
  ): Promise<void> {
    if (responses.length === 0) {
      return;
    }

    const unitRepo = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const BATCH_SIZE = 500;
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const chunk = responses.slice(i, i + BATCH_SIZE);
      const units = chunk.map(r => unitRepo.create({
        coding_job_id: codingJobId,
        workspace_id: workspaceId,
        response_id: r.id,
        unit_name: r.unitName,
        unit_alias: r.unitAlias,
        variable_id: r.variableid,
        variable_anchor: r.variableid,
        booklet_name: r.bookletName,
        person_login: r.personLogin,
        person_code: r.personCode,
        person_group: r.personGroup,
        variable_bundle_id: r.variableBundleId || null
      })
      );
      await unitRepo.save(units);
    }
  }

  async getCurrentAggregationSettingsSnapshot(
    workspaceId: number
  ): Promise<CodingJobAggregationSettings> {
    const [aggregationThreshold, responseMatchingFlags] = await Promise.all([
      this.getAggregationThreshold(workspaceId),
      this.getResponseMatchingMode(workspaceId)
    ]);
    const aggregationEnabled =
      aggregationThreshold !== null &&
      !responseMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);

    return {
      aggregationEnabled,
      aggregationThreshold,
      responseMatchingFlags,
      aggregationSettingsVersion: 1,
      fromJobSnapshot: false
    };
  }

  async getAggregationSettingsForCodingJob(
    codingJob: CodingJob
  ): Promise<CodingJobAggregationSettings> {
    if (
      codingJob.aggregation_settings_version !== null &&
      codingJob.aggregation_settings_version !== undefined
    ) {
      const responseMatchingFlags = this.normalizeResponseMatchingFlags(
        codingJob.response_matching_flags as
          | ResponseMatchingFlag[]
          | undefined
          | null
      );
      const aggregationThreshold = codingJob.aggregation_enabled ?
        codingJob.aggregation_threshold :
        null;

      return {
        aggregationEnabled:
          codingJob.aggregation_enabled &&
          aggregationThreshold !== null &&
          !responseMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION),
        aggregationThreshold,
        responseMatchingFlags: codingJob.aggregation_enabled ?
          responseMatchingFlags :
          [ResponseMatchingFlag.NO_AGGREGATION],
        aggregationSettingsVersion: codingJob.aggregation_settings_version,
        fromJobSnapshot: true
      };
    }

    return this.getCurrentAggregationSettingsSnapshot(codingJob.workspace_id);
  }

  async getDerivedVariableMapForAggregation(
    workspaceId: number
  ): Promise<Map<string, Set<string>>> {
    const derivedVariableMap =
      await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });
    return derivedVariableSets;
  }

  async getResponseMatchingMode(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<ResponseMatchingFlag[]> {
    const settingKey = `workspace-${workspaceId}-response-matching-mode`;
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    const [setting, aggregationThreshold] = await Promise.all([
      repository.findOne({ where: { key: settingKey } }),
      this.getAggregationThreshold(workspaceId, manager)
    ]);

    let flags: ResponseMatchingFlag[] = [];
    if (setting) {
      try {
        const parsed = JSON.parse(setting.content);
        flags = this.normalizeResponseMatchingFlags(parsed.flags);
      } catch {
        flags = [];
      }
    }

    if (aggregationThreshold === null) {
      return [ResponseMatchingFlag.NO_AGGREGATION];
    }

    return flags;
  }

  async setResponseMatchingMode(
    workspaceId: number,
    flags: ResponseMatchingFlag[]
  ): Promise<ResponseMatchingFlag[]> {
    const normalizedFlags = this.normalizeResponseMatchingFlags(flags);
    await this.settingRepository.save({
      key: `workspace-${workspaceId}-response-matching-mode`,
      content: JSON.stringify({ flags: normalizedFlags })
    });

    this.logger.log(
      `Set response matching mode for workspace ${workspaceId}: ${normalizedFlags.join(', ')}`
    );
    return normalizedFlags;
  }

  normalizeResponseMatchingFlags(
    flags: ResponseMatchingFlag[] | undefined | null
  ): ResponseMatchingFlag[] {
    const allowedFlags = new Set(Object.values(ResponseMatchingFlag));
    const normalizedFlags = Array.from(new Set(flags ?? [])).filter(
      (flag): flag is ResponseMatchingFlag => allowedFlags.has(flag)
    );

    if (normalizedFlags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return [ResponseMatchingFlag.NO_AGGREGATION];
    }

    return normalizedFlags;
  }

  normalizeValue(value: string | null, flags: ResponseMatchingFlag[]): string {
    if (value === null || value === undefined) {
      return '';
    }

    let normalized = value;

    if (flags.includes(ResponseMatchingFlag.IGNORE_CASE)) {
      normalized = normalized.toLowerCase();
    }

    if (flags.includes(ResponseMatchingFlag.IGNORE_WHITESPACE)) {
      normalized = normalized.replace(/\s+/g, '');
    }

    return normalized;
  }

  aggregateResponsesByValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[]
  ): {
      normalizedValue: string;
      responses: SlimResponse[];
      totalResponses: number;
    }[] {
    if (flags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return responses.map(r => ({
        normalizedValue: r.value || '',
        responses: [r],
        totalResponses: 1
      }));
    }

    const groups = new Map<string, SlimResponse[]>();

    for (const response of responses) {
      const normalizedValue = this.normalizeValue(response.value, flags);
      const existing = groups.get(normalizedValue) || [];
      existing.push(response);
      groups.set(normalizedValue, existing);
    }

    return Array.from(groups.entries()).map(
      ([normalizedValue, groupResponses]) => ({
        normalizedValue,
        responses: groupResponses,
        totalResponses: groupResponses.length
      })
    );
  }

  private aggregateResponsesByVariableAndValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[],
    threshold: number | null,
    isDerivedResponse: (response: SlimResponse) => boolean
  ): {
      normalizedValue: string;
      responses: SlimResponse[];
      totalResponses: number;
    }[] {
    const derivedVariableMap = new Map<string, Set<string>>();
    responses.forEach(response => {
      if (!isDerivedResponse(response)) {
        return;
      }

      const unitKey = response.unitName.toUpperCase();
      const derivedVariables =
        derivedVariableMap.get(unitKey) || new Set<string>();
      derivedVariables.add(response.variableid);
      derivedVariableMap.set(unitKey, derivedVariables);
    });

    return buildAggregationGroups(
      this.withManualCodingDeduplicationFields(responses),
      flags,
      threshold,
      derivedVariableMap
    ).map(group => ({
      normalizedValue: group.key,
      responses: group.responses,
      totalResponses: group.responses.length
    }));
  }

  private withManualCodingDeduplicationFields(
    responses: SlimResponse[]
  ): Array<SlimResponse & ManualCodingDeduplicationResponse> {
    return responses.map(response => ({
      ...response,
      responseId: response.id,
      variableId: response.variableid
    }));
  }

  private deduplicateSlimResponsesForManualCoding(
    responses: SlimResponse[],
    assignedResponseIds: Set<number>
  ): {
      responses: SlimResponse[];
      assignedResponseIds: Set<number>;
    } {
    const responsesWithCaseFields =
      this.withManualCodingDeduplicationFields(responses);
    const assignedDeduplicationKeys = new Set(
      responsesWithCaseFields
        .filter(response => assignedResponseIds.has(response.responseId))
        .map(response => getManualCodingDeduplicationKey(response))
    );
    const dedupedResponses =
      deduplicateManualCodingResponses(responsesWithCaseFields);
    const assignedDedupedResponseIds = new Set(
      dedupedResponses
        .filter(response => (
          assignedResponseIds.has(response.responseId) ||
          assignedDeduplicationKeys.has(getManualCodingDeduplicationKey(response))
        ))
        .map(response => response.responseId)
    );

    return {
      responses: dedupedResponses,
      assignedResponseIds: assignedDedupedResponseIds
    };
  }

  private async filterSlimResponsesForAggregation(
    workspaceId: number,
    responses: SlimResponse[],
    aggregationThreshold: number,
    matchingFlags: ResponseMatchingFlag[]
  ): Promise<SlimResponse[]> {
    const derivedVariableMap =
      await this.getDerivedVariableMapForAggregation(workspaceId);
    const dedupedResponses = this.deduplicateSlimResponsesForManualCoding(
      responses,
      new Set()
    ).responses;
    const groups = buildAggregationGroups(
      this.withManualCodingDeduplicationFields(dedupedResponses),
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap
    );
    const filteredResponses: SlimResponse[] = [];

    for (const group of groups) {
      if (group.responses.length >= aggregationThreshold) {
        group.responses.sort((a, b) => a.id - b.id);
        filteredResponses.push(group.responses[0]);
      } else {
        filteredResponses.push(...group.responses);
      }
    }

    return filteredResponses;
  }

  async getResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[]
  ): Promise<ResponseEntity[]> {
    if (variables.length === 0) {
      return [];
    }

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)')
      .andWhere('(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)', {
        completedV2Status: statusStringToNumber('CODING_COMPLETE')
      });
    this.applyManualCodingCandidateStatusFilter(queryBuilder, variables);
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(
        `(unit.name = :${unitParam} AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder.orderBy('response.id', 'ASC').getMany();
  }

  async getSlimResponsesForVariables(
    workspaceId: number,
    variables: VariableReference[],
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    if (variables.length === 0) {
      return [];
    }

    const repository = manager ?
      manager.getRepository(ResponseEntity) :
      this.responseRepository;
    const queryBuilder = repository
      .createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
        {
          aggregatedCode: -111,
          defaultMirCode: await this.getDefaultMirCode(workspaceId)
        }
      )
      .andWhere('(response.status_v2 IS NULL OR response.status_v2 != :completedV2Status)', {
        completedV2Status: statusStringToNumber('CODING_COMPLETE')
      });
    this.applyManualCodingCandidateStatusFilter(queryBuilder, variables);
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `slimUnitName${index}`;
      const variableParam = `slimVariableId${index}`;
      conditions.push(
        `(unit.name = :${unitParam} AND response.variableid = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();

    return raw.map(r => ({
      id: Number(r.id),
      variableid: r.variableid,
      value: r.value ?? null,
      statusV1:
        r.statusV1 !== undefined && r.statusV1 !== null ?
          Number(r.statusV1) :
          null,
      statusV2:
        r.statusV2 !== undefined && r.statusV2 !== null ?
          Number(r.statusV2) :
          null,
      unitName: r.unitName ?? '',
      unitAlias: r.unitAlias ?? null,
      bookletName: r.bookletName ?? '',
      personLogin: r.personLogin ?? '',
      personCode: r.personCode ?? '',
      personGroup: r.personGroup ?? ''
    }));
  }

  async getSlimResponsesForVariableCoverage(
    workspaceId: number,
    variables: VariableReference[],
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    derivedVariableMap: Map<string, Set<string>>
  ): Promise<SlimResponse[]> {
    const activeResponses = await this.getSlimResponsesForVariables(
      workspaceId,
      variables
    );
    const aggregationActive = aggregationThreshold !== null &&
      !matchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);

    if (!aggregationActive || activeResponses.length === 0) {
      return activeResponses;
    }

    const peerKeys = buildAggregationPeerKeys(
      activeResponses.map(response => ({
        responseId: response.id,
        unitName: response.unitName,
        variableId: response.variableid,
        value: response.value
      })),
      matchingFlags,
      derivedVariableMap
    );

    if (peerKeys.length === 0) {
      return activeResponses;
    }

    const completedStatus = statusStringToNumber('CODING_COMPLETE');
    const defaultMirCode = await this.getDefaultMirCode(workspaceId);
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    const peerKeySet = new Set(
      peerKeys.map(peerKey => serializeAggregationPeerKey(peerKey))
    );
    const exactValueMatching =
      !matchingFlags.includes(ResponseMatchingFlag.IGNORE_CASE) &&
      !matchingFlags.includes(ResponseMatchingFlag.IGNORE_WHITESPACE);
    const createCompletedPeerQuery = (): SelectQueryBuilder<ResponseEntity> => {
      const query = this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.status_v2 = :completedStatus', { completedStatus })
        .andWhere(
          '(response.code_v2 IS NULL OR (response.code_v2 != :aggregatedCode AND response.code_v2 != :defaultMirCode))',
          { aggregatedCode: -111, defaultMirCode }
        )
        .andWhere(new Brackets(qb => {
          qb.where('response.code_v2 IS NULL')
            .orWhere(subQuery => {
              const exists = subQuery
                .subQuery()
                .select('1')
                .from('coding_job_unit', 'manual_cju')
                .innerJoin('coding_job', 'manual_cj', 'manual_cj.id = manual_cju.coding_job_id')
                .where('manual_cju.response_id = response.id')
                .andWhere('manual_cj.training_id IS NULL')
                .andWhere(getNonCodingIssueReviewJobSqlCondition('manual_cj'))
                .getQuery();
              return `EXISTS (${exists})`;
            });
        }));
      this.applyManualCodingCandidateStatusFilter(query, variables);
      applyResolvedExclusionsToQuery(query, exclusions);
      return query;
    };

    const peerVariableIds = Array.from(new Set(
      peerKeys.map(peerKey => peerKey.variableId)
    ));
    const peerUnitQuery = createCompletedPeerQuery()
      .select('DISTINCT unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .andWhere('response.variableid IN (:...peerVariableIds)', {
        peerVariableIds
      });
    const peerUnitKeys = buildAggregationPeerUnitKeys(
      peerKeys,
      await peerUnitQuery.getRawMany()
    );
    if (peerUnitKeys.length === 0) {
      return activeResponses;
    }

    const peerValueQuery = createCompletedPeerQuery()
      .select('DISTINCT unit.name', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.value', 'value')
      .andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerUnits AS jsonb))
            AS aggregation_peer_unit("unitName" text, "variableId" text)
          WHERE aggregation_peer_unit."unitName" = unit.name
            AND aggregation_peer_unit."variableId" = response.variableid
        )`,
        { aggregationPeerUnits: JSON.stringify(peerUnitKeys) }
      );
    if (exactValueMatching) {
      peerValueQuery.andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerValues AS jsonb))
            AS aggregation_peer_value("variableId" text, "normalizedValue" text)
          WHERE aggregation_peer_value."variableId" = response.variableid
            AND aggregation_peer_value."normalizedValue" = response.value
        )`,
        { aggregationPeerValues: JSON.stringify(peerKeys) }
      );
    }
    const peerLookupKeys = buildAggregationPeerLookupKeys(
      peerKeys,
      await peerValueQuery.getRawMany(),
      matchingFlags
    );
    if (peerLookupKeys.length === 0) {
      return activeResponses;
    }

    const queryBuilder = createCompletedPeerQuery()
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('response.status_v1', 'statusV1')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect("COALESCE(bookletinfo.name, '')", 'bookletName')
      .addSelect("COALESCE(person.login, '')", 'personLogin')
      .addSelect("COALESCE(person.code, '')", 'personCode')
      .addSelect("COALESCE(person.group, '')", 'personGroup')
      .andWhere(
        `EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(CAST(:aggregationPeerKeys AS jsonb))
            AS aggregation_peer("unitName" text, "variableId" text, "value" text)
          WHERE aggregation_peer."unitName" = unit.name
            AND aggregation_peer."variableId" = response.variableid
            AND aggregation_peer."value" = response.value
        )`,
        { aggregationPeerKeys: JSON.stringify(peerLookupKeys) }
      );
    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();
    const completedPeers: SlimResponse[] = raw.map(r => ({
      id: Number(r.id),
      variableid: r.variableid,
      value: r.value ?? null,
      statusV1:
        r.statusV1 !== undefined && r.statusV1 !== null ?
          Number(r.statusV1) :
          null,
      statusV2:
        r.statusV2 !== undefined && r.statusV2 !== null ?
          Number(r.statusV2) :
          null,
      unitName: r.unitName ?? '',
      unitAlias: r.unitAlias ?? null,
      bookletName: r.bookletName ?? '',
      personLogin: r.personLogin ?? '',
      personCode: r.personCode ?? '',
      personGroup: r.personGroup ?? ''
    })).filter(response => (
      isAggregatableValue(response.value) &&
      peerKeySet.has(serializeAggregationPeerKey(getAggregationPeerKey(
        response.unitName,
        response.variableid,
        response.value,
        matchingFlags
      )))
    ));

    return [...activeResponses, ...completedPeers];
  }

  private async getAssignedResponseIdsForVariables(
    workspaceId: number,
    variables: VariableReference[],
    excludeJobDefinitionId?: number,
    manager?: EntityManager
  ): Promise<Set<number>> {
    if (variables.length === 0) {
      return new Set();
    }

    const repository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const query = repository
      .createQueryBuilder('cju')
      .select('DISTINCT cju.response_id', 'responseId')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL');
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'assignedResponseIdsReviewJobType'
    );

    if (
      excludeJobDefinitionId !== undefined &&
      excludeJobDefinitionId !== null
    ) {
      query.andWhere(
        '(coding_job.job_definition_id IS NULL OR coding_job.job_definition_id != :excludeJobDefinitionId)',
        { excludeJobDefinitionId }
      );
    }

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `assignedUnitName${index}`;
      const variableParam = `assignedVariableId${index}`;
      conditions.push(
        `(cju.unit_name = :${unitParam} AND cju.variable_id = :${variableParam})`
      );
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    query.andWhere(`(${conditions.join(' OR ')})`, parameters);
    await this.applyCodingJobUnitExclusions(
      query,
      workspaceId,
      'assignedResponseIdsForVariables'
    );

    const rawResults = await query.getRawMany();
    return new Set(
      rawResults
        .map(row => Number(row.responseId))
        .filter(responseId => Number.isFinite(responseId))
    );
  }

  private getDistributableResponses(
    allItemResponses: SlimResponse[],
    assignedResponseIds: Set<number>,
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    isDerivedResponse: (response: SlimResponse) => boolean
  ): DistributableResponses {
    const {
      responses,
      assignedResponseIds: effectiveAssignedResponseIds
    } = this.deduplicateSlimResponsesForManualCoding(
      allItemResponses,
      assignedResponseIds
    );
    const filteredResponses: SlimResponse[] = [];
    const caseStatusesByResponseId = new Map<number, DistributionVariableUsageCaseStatus>();
    let uniqueCases = 0;
    let totalResponses = 0;

    if (aggregationThreshold !== null) {
      const aggregatedGroups = this.aggregateResponsesByVariableAndValue(
        responses,
        matchingFlags,
        aggregationThreshold,
        isDerivedResponse
      );

      aggregatedGroups.forEach(group => {
        if (group.responses.length >= aggregationThreshold) {
          const groupAlreadyAssigned = group.responses.some(response => effectiveAssignedResponseIds.has(response.id)
          );
          if (!groupAlreadyAssigned) {
            group.responses.sort((a, b) => a.id - b.id);
            const representativeResponse = group.responses[0];
            filteredResponses.push(representativeResponse);
            caseStatusesByResponseId.set(
              representativeResponse.id,
              this.getAggregatedCaseUsageStatus(group.responses)
            );
            uniqueCases += 1;
            totalResponses += group.responses.length;
          }
          return;
        }

        const unassignedResponses = group.responses.filter(
          response => !effectiveAssignedResponseIds.has(response.id)
        );
        filteredResponses.push(...unassignedResponses);
        unassignedResponses.forEach(response => {
          caseStatusesByResponseId.set(
            response.id,
            this.getResponseUsageStatus(response)
          );
        });
        uniqueCases += unassignedResponses.length;
        totalResponses += unassignedResponses.length;
      });

      return {
        filteredResponses,
        uniqueCases,
        totalResponses,
        caseStatusesByResponseId
      };
    }

    const unassignedResponses = responses.filter(
      response => !effectiveAssignedResponseIds.has(response.id)
    );
    unassignedResponses.forEach(response => {
      caseStatusesByResponseId.set(
        response.id,
        this.getResponseUsageStatus(response)
      );
    });

    return {
      filteredResponses: unassignedResponses,
      uniqueCases: unassignedResponses.length,
      totalResponses: unassignedResponses.length,
      caseStatusesByResponseId
    };
  }

  private getAggregatedCaseUsageStatus(
    responses: SlimResponse[]
  ): DistributionVariableUsageCaseStatus {
    return responses.some(response => response.statusV1 !== DERIVE_ERROR_STATUS) ?
      'regular' :
      'deriveError';
  }

  private getResponseUsageStatus(
    response: SlimResponse
  ): DistributionVariableUsageCaseStatus {
    return response.statusV1 === DERIVE_ERROR_STATUS ? 'deriveError' : 'regular';
  }

  private buildAvailabilityWarning(
    variable: VariableReference,
    allVariableResponses: SlimResponse[],
    assignedResponseIds: Set<number>,
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    isDerivedVariable: boolean
  ): JobCreationWarning | null {
    const totalCases = this.getDistributableResponses(
      allVariableResponses,
      new Set(),
      matchingFlags,
      aggregationThreshold,
      () => isDerivedVariable
    ).uniqueCases;
    const availableCases = this.getDistributableResponses(
      allVariableResponses,
      assignedResponseIds,
      matchingFlags,
      aggregationThreshold,
      () => isDerivedVariable
    ).uniqueCases;
    const casesInJobs = Math.max(0, totalCases - availableCases);

    if (totalCases === 0 || casesInJobs === 0 || availableCases >= totalCases) {
      return null;
    }

    return {
      unitName: variable.unitName,
      variableId: variable.variableId,
      message: `Variable: nur noch ${availableCases} von ${totalCases} Fällen verfügbar`,
      casesInJobs,
      availableCases
    };
  }

  private getDistributionSeed(
    workspaceId: number,
    request: Pick<
    DistributionPlanRequest,
    'distributionSeed' | 'jobDefinitionId'
    >
  ): string {
    if (
      request.distributionSeed !== undefined &&
      request.distributionSeed !== null &&
      request.distributionSeed !== ''
    ) {
      return String(request.distributionSeed);
    }

    if (
      request.jobDefinitionId !== undefined &&
      request.jobDefinitionId !== null
    ) {
      return `job-definition:${request.jobDefinitionId}`;
    }

    return `workspace:${workspaceId}:distributed-coding`;
  }

  private compareResponsesByMode(
    mode: 'continuous' | 'alternating',
    a: SlimResponse,
    b: SlimResponse
  ): number {
    if (mode === 'alternating') {
      if (a.personLogin !== b.personLogin) return a.personLogin.localeCompare(b.personLogin);
      if (a.personCode !== b.personCode) return a.personCode.localeCompare(b.personCode);
      if (a.personGroup !== b.personGroup) return a.personGroup.localeCompare(b.personGroup);
      if (a.bookletName !== b.bookletName) return a.bookletName.localeCompare(b.bookletName);
      if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
      if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);
      return a.id - b.id;
    }

    if (a.variableid !== b.variableid) return a.variableid.localeCompare(b.variableid);
    if (a.unitName !== b.unitName) return a.unitName.localeCompare(b.unitName);
    if (a.personLogin !== b.personLogin) return a.personLogin.localeCompare(b.personLogin);
    if (a.personCode !== b.personCode) return a.personCode.localeCompare(b.personCode);
    if (a.personGroup !== b.personGroup) return a.personGroup.localeCompare(b.personGroup);
    if (a.bookletName !== b.bookletName) return a.bookletName.localeCompare(b.bookletName);
    return a.id - b.id;
  }

  private getResponseStratumKey(
    response: SlimResponse,
    mode: 'continuous' | 'alternating'
  ): string {
    if (mode === 'alternating') {
      return [
        response.personGroup,
        response.bookletName,
        response.unitName,
        response.variableid
      ].join('::');
    }

    return [
      response.unitName,
      response.variableid,
      response.bookletName,
      response.personGroup
    ].join('::');
  }

  private getResponseAllocationCaseKey(
    response: SlimResponse,
    itemType: 'bundle' | 'variable'
  ): string {
    if (itemType === 'bundle') {
      return [
        'bundle-case',
        response.personLogin,
        response.personCode,
        response.personGroup,
        response.bookletName
      ].join('\u0000');
    }

    return `response:${response.id}`;
  }

  private getCaseGroupStratumKey(
    caseGroup: DistributionPlanCaseGroup,
    mode: 'continuous' | 'alternating',
    itemType: 'bundle' | 'variable'
  ): string {
    if (itemType === 'variable') {
      return this.getResponseStratumKey(
        caseGroup.representativeResponse,
        mode
      );
    }

    const response = caseGroup.representativeResponse;
    if (mode === 'alternating') {
      return [
        response.personGroup,
        response.bookletName
      ].join('::');
    }

    return [
      response.bookletName,
      response.personGroup
    ].join('::');
  }

  private sortCaseGroupsForDistribution(
    caseGroups: DistributionPlanCaseGroup[],
    mode: 'continuous' | 'alternating',
    seed: string,
    itemKey: string,
    itemType: 'bundle' | 'variable'
  ): DistributionPlanCaseGroup[] {
    const groups = new Map<string, DistributionPlanCaseGroup[]>();

    for (const caseGroup of caseGroups) {
      const key = this.getCaseGroupStratumKey(caseGroup, mode, itemType);
      const group = groups.get(key) || [];
      group.push(caseGroup);
      groups.set(key, group);
    }

    const groupEntries = Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        group: group.sort((a, b) => this.compareResponsesByMode(
          mode,
          a.representativeResponse,
          b.representativeResponse
        ))
      }))
      .sort((a, b) => {
        const hashA = this.distributionPlanner.stableHash(
          `${seed}:${itemKey}:stratum:${a.key}`
        );
        const hashB = this.distributionPlanner.stableHash(
          `${seed}:${itemKey}:stratum:${b.key}`
        );
        return hashA - hashB || a.key.localeCompare(b.key);
      });

    const result: DistributionPlanCaseGroup[] = [];
    let remaining = true;

    while (remaining) {
      remaining = false;
      for (const entry of groupEntries) {
        const caseGroup = entry.group.shift();
        if (caseGroup) {
          result.push(caseGroup);
          remaining = true;
        }
      }
    }

    return result;
  }

  private buildDistributionCaseGroups(
    itemType: 'bundle' | 'variable',
    allItemResponses: SlimResponse[],
    filteredResponses: SlimResponse[],
    assignedResponseIds: Set<number>,
    mode: 'continuous' | 'alternating',
    seed: string,
    itemKey: string
  ): DistributionPlanCaseGroup[] {
    const assignedBundleCaseKeys =
      itemType === 'bundle' ?
        new Set(
          allItemResponses
            .filter(response => assignedResponseIds.has(response.id))
            .map(response => this.getResponseAllocationCaseKey(response, itemType))
        ) :
        new Set<string>();
    const casesByKey = new Map<string, SlimResponse[]>();

    filteredResponses.forEach(response => {
      const caseKey = this.getResponseAllocationCaseKey(response, itemType);
      if (assignedBundleCaseKeys.has(caseKey)) {
        return;
      }

      const responses = casesByKey.get(caseKey) || [];
      responses.push(response);
      casesByKey.set(caseKey, responses);
    });

    const caseGroups = Array.from(casesByKey.entries()).map(
      ([caseKey, responses]) => {
        const sortedResponses = [...responses].sort((a, b) => this.compareResponsesByMode(mode, a, b));
        return {
          caseKey,
          responses: sortedResponses,
          representativeResponse: sortedResponses[0]
        };
      }
    );

    return this.sortCaseGroupsForDistribution(
      caseGroups,
      mode,
      seed,
      itemKey,
      itemType
    );
  }

  private countDistributionCasesInResponses(
    item: DistributionPlanItem,
    responses: SlimResponse[]
  ): number {
    return new Set(
      responses.map(response => this.getResponseAllocationCaseKey(
        response,
        item.type
      ))
    ).size;
  }

  private normalizeDistributionCoders(
    selectedCoders: DistributionCoderInput[],
    seed: string
  ): NormalizedDistributionCoder[] {
    if (!selectedCoders || selectedCoders.length === 0) {
      throw new BadRequestException('At least one coder must be selected.');
    }

    const seenCoderIds = new Set<number>();
    const nameCounts = new Map<string, number>();

    for (const coder of selectedCoders) {
      const coderId = Number(coder.id);
      if (!Number.isInteger(coderId) || coderId < 1) {
        throw new BadRequestException(
          'Selected coders must have positive integer IDs.'
        );
      }
      if (seenCoderIds.has(coderId)) {
        throw new BadRequestException(
          `Duplicate coder ID ${coderId} is not allowed.`
        );
      }
      seenCoderIds.add(coderId);
      nameCounts.set(coder.name, (nameCounts.get(coder.name) || 0) + 1);
    }

    return selectedCoders
      .map(coder => {
        let weight = DEFAULT_DISTRIBUTION_CODER_WEIGHT;

        if (coder.capacityPercent !== undefined) {
          const capacityPercent = Number(coder.capacityPercent);
          if (
            !Number.isFinite(capacityPercent) ||
            capacityPercent < MIN_DISTRIBUTION_CODER_CAPACITY_PERCENT ||
            capacityPercent > MAX_DISTRIBUTION_CODER_CAPACITY_PERCENT
          ) {
            throw new BadRequestException(
              `selectedCoders.capacityPercent must be between ${MIN_DISTRIBUTION_CODER_CAPACITY_PERCENT} and ${MAX_DISTRIBUTION_CODER_CAPACITY_PERCENT}.`
            );
          }
          weight = capacityPercent / 100;
        } else if (coder.weight !== undefined) {
          const explicitWeight = Number(coder.weight);
          if (!Number.isFinite(explicitWeight) || explicitWeight <= 0) {
            throw new BadRequestException(
              'selectedCoders.weight must be greater than 0.'
            );
          }
          weight = explicitWeight;
        }

        const displayKey =
          (nameCounts.get(coder.name) || 0) > 1 || !isSafeKey(coder.name) ?
            `${coder.name} (#${coder.id})` :
            coder.name;

        return {
          id: Number(coder.id),
          name: coder.name,
          username: coder.username,
          weight,
          displayKey,
          tieBreaker: this.distributionPlanner.stableHash(
            `${seed}:coder:${coder.id}`
          )
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }

  private buildDistributionItems(
    request: Pick<
    DistributionPlanRequest,
    'selectedVariables' | 'selectedVariableBundles'
    >
  ): DistributionItem[] {
    const items: DistributionItem[] = [];

    if (request.selectedVariableBundles) {
      for (const bundle of request.selectedVariableBundles) {
        items.push({ type: 'bundle', item: bundle });
      }
    }

    for (const variable of request.selectedVariables || []) {
      items.push({ type: 'variable', item: variable });
    }

    return items;
  }

  private getBundleNameCounts(items: DistributionItem[]): Map<string, number> {
    const bundleNameCounts = new Map<string, number>();
    items.forEach(itemObj => {
      if (itemObj.type === 'bundle') {
        const bundle = itemObj.item as BundleItem;
        bundleNameCounts.set(
          bundle.name,
          (bundleNameCounts.get(bundle.name) || 0) + 1
        );
      }
    });

    return bundleNameCounts;
  }

  private getBundleDistributionKey(bundle: Pick<BundleItem, 'id'>): string {
    return `bundle:${bundle.id}`;
  }

  private getItemDetails(
    itemObj: DistributionItem,
    caseOrderingMode: 'continuous' | 'alternating',
    bundleNameCounts = new Map<string, number>()
  ): {
      itemVariables: VariableReference[];
      itemKey: string;
      itemLabel: string;
      itemCaseOrderingMode: 'continuous' | 'alternating';
    } {
    if (itemObj.type === 'bundle') {
      const bundleItem = itemObj.item as BundleItem;
      return {
        itemVariables: bundleItem.variables,
        itemKey: this.getBundleDistributionKey(bundleItem),
        itemLabel:
          (bundleNameCounts.get(bundleItem.name) || 0) > 1 ?
            `${bundleItem.name} (#${bundleItem.id})` :
            bundleItem.name,
        itemCaseOrderingMode: bundleItem.caseOrderingMode || caseOrderingMode
      };
    }

    const variableItem = itemObj.item as VariableReference;
    return {
      itemVariables: [variableItem],
      itemKey: `${variableItem.unitName}::${variableItem.variableId}`,
      itemLabel: `${variableItem.unitName}::${variableItem.variableId}`,
      itemCaseOrderingMode: caseOrderingMode
    };
  }

  private getVariableUsageRequestVariables(
    request: DistributionVariableUsageRequest
  ): VariableReference[] {
    const caseOrderingMode = request.caseOrderingMode || 'continuous';
    const items = this.buildDistributionItems(request);
    const bundleNameCounts = this.getBundleNameCounts(items);

    return items.flatMap(
      itemObj => this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts)
        .itemVariables
    );
  }

  private deduplicateVariableReferences(
    variables: VariableReference[]
  ): VariableReference[] {
    const uniqueVariables = new Map<string, VariableReference>();

    variables.forEach(variable => {
      const key = `${variable.unitName}::${variable.variableId}`;
      const existing = uniqueVariables.get(key);
      uniqueVariables.set(key, {
        ...variable,
        includeDeriveError:
          existing?.includeDeriveError === true ||
          variable.includeDeriveError === true ?
            true :
            undefined
      });
    });

    return Array.from(uniqueVariables.values());
  }

  private buildDerivedVariableSets(
    derivedVariableMap: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });

    return derivedVariableSets;
  }

  private isDerivedVariable(
    derivedVariableSets: Map<string, Set<string>>,
    unitName: string,
    variableId: string
  ): boolean {
    return (
      derivedVariableSets.get(unitName.toUpperCase())?.has(variableId) ?? false
    );
  }

  private selectCasesWithGlobalCap(
    planItems: DistributionPlanItem[],
    maxCodingCases?: number
  ): { item: DistributionPlanItem; caseGroup: DistributionPlanCaseGroup }[] {
    const totalAvailable = planItems.reduce(
      (sum, item) => sum + item.availableCases.length,
      0
    );
    const targetCases =
      typeof maxCodingCases === 'number' && maxCodingCases > 0 ?
        Math.min(maxCodingCases, totalAvailable) :
        totalAvailable;
    const queues = planItems.map(item => ({
      item,
      cases: [...item.availableCases]
    }));
    const selected: {
      item: DistributionPlanItem;
      caseGroup: DistributionPlanCaseGroup;
    }[] = [];
    const selectedCaseKeys = new Set<string>();

    while (selected.length < targetCases) {
      let progressed = false;

      for (const queue of queues) {
        if (selected.length >= targetCases) {
          break;
        }

        while (queue.cases.length > 0) {
          const caseGroup = queue.cases.shift();
          const selectedCaseKey = caseGroup ?
            `${queue.item.itemKey}\u0000${caseGroup.caseKey}` :
            null;
          if (
            !caseGroup ||
            !selectedCaseKey ||
            selectedCaseKeys.has(selectedCaseKey)
          ) {
            continue;
          }

          selected.push({ item: queue.item, caseGroup });
          queue.item.selectedCases.push(caseGroup);
          selectedCaseKeys.add(selectedCaseKey);
          progressed = true;
          break;
        }
      }

      if (!progressed) {
        break;
      }
    }

    return selected;
  }

  private getDoubleCodingCount(
    request: DistributionPlanRequest,
    totalCases: number
  ): number {
    const { doubleCodingAbsolute, doubleCodingPercentage } =
      this.getDoubleCodingSettings(request);

    if (doubleCodingAbsolute > 0) {
      return Math.min(doubleCodingAbsolute, totalCases);
    }

    if (doubleCodingPercentage > 0) {
      return Math.min(
        Math.ceil((doubleCodingPercentage / 100) * totalCases),
        totalCases
      );
    }

    return 0;
  }

  private getDoubleCodingSettings(
    request: Pick<
    DistributionPlanRequest,
    'doubleCodingAbsolute' | 'doubleCodingPercentage'
    >
  ): { doubleCodingAbsolute: number; doubleCodingPercentage: number } {
    const doubleCodingAbsolute = Number(request.doubleCodingAbsolute || 0);
    const doubleCodingPercentage = Number(request.doubleCodingPercentage || 0);

    if (doubleCodingAbsolute > 0 && doubleCodingPercentage > 0) {
      throw new BadRequestException(
        'Use either doubleCodingAbsolute or doubleCodingPercentage, not both.'
      );
    }

    return { doubleCodingAbsolute, doubleCodingPercentage };
  }

  private getResponseVariableKey(response: SlimResponse): string {
    return `${response.unitName}::${response.variableid}`;
  }

  private buildEmptyDoubleCodingInfo(
    coders: NormalizedDistributionCoder[]
  ): DistributionDoubleCodingInfo {
    const doubleCodedCasesPerCoder: Record<string, number> = {};
    const doubleCodedCasesPerCoderId: Record<string, number> = {};

    coders.forEach(coder => {
      if (isSafeKey(coder.displayKey)) {
        doubleCodedCasesPerCoder[coder.displayKey] = 0;
      }
      doubleCodedCasesPerCoderId[String(coder.id)] = 0;
    });

    return {
      totalCases: 0,
      distinctCases: 0,
      codingTasksTotal: 0,
      doubleCodedCases: 0,
      singleCodedCasesAssigned: 0,
      doubleCodedCasesPerCoder,
      doubleCodedCasesPerCoderId
    };
  }

  private async buildDistributionPlan(
    workspaceId: number,
    request: DistributionPlanRequest,
    manager?: EntityManager
  ): Promise<DistributionPlan> {
    const caseOrderingMode = request.caseOrderingMode || 'continuous';
    const distributionSeed = this.getDistributionSeed(workspaceId, request);
    const coders = this.normalizeDistributionCoders(
      request.selectedCoders,
      distributionSeed
    );
    await this.assertCodersCanCodeInWorkspace(
      coders.map(coder => coder.id),
      workspaceId
    );
    const codersPerDoubleCodedCase = 2;

    const items = this.buildDistributionItems(request);
    const bundleNameCounts = this.getBundleNameCounts(items);

    if (items.length === 0) {
      return {
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        jobsToCreate: [],
        plannedCases: [],
        pairDistribution: {},
        tasksPerCoder: {},
        coderWeights: {}
      };
    }

    const matchingFlags = await this.getResponseMatchingMode(
      workspaceId,
      manager
    );
    const aggregationThreshold = await this.getAggregationThreshold(
      workspaceId,
      manager
    );
    const derivedVariableMap =
      await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets =
      this.buildDerivedVariableSets(derivedVariableMap);
    const isDerivedVariable = (unitName: string, variableId: string): boolean => this.isDerivedVariable(derivedVariableSets, unitName, variableId);

    const allVariables = this.deduplicateVariableReferences(
      items.flatMap(
        itemObj => this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts)
          .itemVariables
      )
    );
    const allResponses = await this.getSlimResponsesForVariables(
      workspaceId,
      allVariables,
      manager
    );
    const assignedResponseIds = await this.getAssignedResponseIdsForVariables(
      workspaceId,
      allVariables,
      request.jobDefinitionId,
      manager
    );
    const warnings: JobCreationWarning[] = [];
    const warnedVariables = new Set<string>();

    for (const variable of allVariables) {
      const variableKey = `${variable.unitName}::${variable.variableId}`;
      if (warnedVariables.has(variableKey)) {
        continue;
      }

      warnedVariables.add(variableKey);
      const variableResponses = allResponses.filter(r => this.responseMatchesVariableReference(r, variable)
      );
      const warning = this.buildAvailabilityWarning(
        variable,
        variableResponses,
        assignedResponseIds,
        matchingFlags,
        aggregationThreshold,
        isDerivedVariable(variable.unitName, variable.variableId)
      );

      if (warning) {
        warnings.push(warning);
      }
    }

    const planItems: DistributionPlanItem[] = [];
    const distribution: Record<string, Record<string, number>> = {};
    const distributionByCoderId: Record<string, Record<string, number>> = {};
    const doubleCodingInfo: Record<string, DistributionDoubleCodingInfo> = {};
    const aggregationInfo: Record<
    string,
    { uniqueCases: number; totalResponses: number }
    > = {};

    for (const itemObj of items) {
      const {
        itemVariables, itemKey, itemLabel, itemCaseOrderingMode
      } =
        this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts);

      if (!isSafeKey(itemKey)) {
        continue;
      }

      const allItemResponses = allResponses.filter(response => itemVariables.some(variable => this.responseMatchesVariableReference(response, variable)
      )
      );
      const {
        filteredResponses,
        totalResponses,
        caseStatusesByResponseId
      } = this.getDistributableResponses(
        allItemResponses,
        assignedResponseIds,
        matchingFlags,
        aggregationThreshold,
        response => isDerivedVariable(response.unitName, response.variableid)
      );
      const availableCases = this.buildDistributionCaseGroups(
        itemObj.type,
        allItemResponses,
        filteredResponses,
        assignedResponseIds,
        itemCaseOrderingMode,
        distributionSeed,
        itemKey
      );
      const planItem: DistributionPlanItem = {
        type: itemObj.type,
        item: itemObj.item,
        itemKey,
        itemLabel,
        itemVariables,
        itemCaseOrderingMode,
        uniqueCases: availableCases.length,
        totalResponses,
        availableCases,
        caseStatusesByResponseId,
        selectedCases: []
      };

      planItems.push(planItem);
      aggregationInfo[itemKey] = {
        uniqueCases: availableCases.length,
        totalResponses
      };
      distribution[itemKey] = {};
      distributionByCoderId[itemKey] = {};
      doubleCodingInfo[itemKey] = this.buildEmptyDoubleCodingInfo(coders);

      for (const coder of coders) {
        if (isSafeKey(coder.displayKey)) {
          distribution[itemKey][coder.displayKey] = 0;
        }
        distributionByCoderId[itemKey][String(coder.id)] = 0;
      }
    }

    const selectedCases = this.selectCasesWithGlobalCap(
      planItems,
      request.maxCodingCases
    );
    this.getDoubleCodingSettings(request);
    const selectedCaseCountsByItemKey = new Map<string, number>();
    selectedCases.forEach(selectedCase => {
      selectedCaseCountsByItemKey.set(
        selectedCase.item.itemKey,
        (selectedCaseCountsByItemKey.get(selectedCase.item.itemKey) || 0) + 1
      );
    });
    const doubleCodingCountsByItemKey = new Map<string, number>();
    selectedCaseCountsByItemKey.forEach((caseCount, itemKey) => {
      doubleCodingCountsByItemKey.set(
        itemKey,
        this.getDoubleCodingCount(request, caseCount)
      );
    });
    const totalDoubleCodingCount = Array.from(
      doubleCodingCountsByItemKey.values()
    ).reduce((sum, count) => sum + count, 0);

    if (
      totalDoubleCodingCount > 0 &&
      coders.length < codersPerDoubleCodedCase
    ) {
      throw new BadRequestException(
        `Double coding requires at least ${codersPerDoubleCodedCase} selected coders.`
      );
    }

    const coderLoads = new Map<number, DistributionCoderLoad>(
      coders.map(coder => [coder.id, { tasks: 0, doubleTasks: 0 }])
    );
    const coderLoadsByItemKey = new Map<
    string,
    Map<number, DistributionCoderLoad>
    >(
      planItems.map(item => [
        item.itemKey,
        new Map(coders.map(coder => [coder.id, { tasks: 0, doubleTasks: 0 }]))
      ])
    );
    const pairCounts = new Map<string, number>();
    const pairCountsByItemKey = new Map<string, Map<string, number>>(
      planItems.map(item => [item.itemKey, new Map<string, number>()])
    );
    const coderById = new Map(coders.map(coder => [coder.id, coder]));
    const jobsByItemAndCoder = new Map<string, Map<number, SlimResponse[]>>();
    const plannedCases: DistributionPlanCase[] = [];
    const doubleCodingCoderCombinations =
      totalDoubleCodingCount > 0 ?
        this.distributionPlanner.getCoderCombinations(
          coders,
          codersPerDoubleCodedCase
        ) :
        [];
    const codersHaveEqualWeights = coders.every(
      coder => coder.weight === coders[0]?.weight
    );
    const doubleCodingPairQuotasByItemKey = new Map<
    string,
    Map<string, number>
    >();
    let plannedDoubleCoderAssignments = new Map(
      coders.map(coder => [coder.id, 0])
    );
    let plannedDoublePairCounts = new Map<string, number>();
    if (codersHaveEqualWeights) {
      for (const [itemKey, doubleCodingCount] of doubleCodingCountsByItemKey) {
        const quotaPlan =
          this.distributionPlanner.planBalancedDoubleCodingPairQuotas(
            coders,
            doubleCodingCoderCombinations,
            doubleCodingCount,
            distributionSeed,
            itemKey,
            plannedDoubleCoderAssignments,
            plannedDoublePairCounts
          );
        doubleCodingPairQuotasByItemKey.set(
          itemKey,
          quotaPlan.pairQuotas
        );
        plannedDoubleCoderAssignments = quotaPlan.plannedCoderAssignments;
        plannedDoublePairCounts = quotaPlan.plannedPairCounts;
      }
    }
    const assignedDoubleCodingCountsByItemKey = new Map<string, number>();
    const selectedCaseAssignments = selectedCases.map(selectedCase => {
      const itemKey = selectedCase.item.itemKey;
      const assignedDoubleCodingCount =
        assignedDoubleCodingCountsByItemKey.get(itemKey) || 0;
      const isDoubleCoded =
        assignedDoubleCodingCount <
        (doubleCodingCountsByItemKey.get(itemKey) || 0);

      if (isDoubleCoded) {
        assignedDoubleCodingCountsByItemKey.set(
          itemKey,
          assignedDoubleCodingCount + 1
        );
      }

      return { selectedCase, isDoubleCoded };
    });
    const assignmentsByCaseGroup = new Map<
    DistributionPlanCaseGroup,
    {
      isDoubleCoded: boolean;
      assignedCoders: NormalizedDistributionCoder[];
    }
    >();

    [true, false].forEach(assignDoubleCodedCases => {
      selectedCaseAssignments
        .filter(({ isDoubleCoded }) => isDoubleCoded === assignDoubleCodedCases)
        .forEach(({ selectedCase, isDoubleCoded }) => {
          const itemKey = selectedCase.item.itemKey;
          const itemCoderLoads = coderLoadsByItemKey.get(itemKey) ||
            new Map<number, DistributionCoderLoad>();
          const itemPairCounts = pairCountsByItemKey.get(itemKey) ||
            new Map<string, number>();
          const taskCount = selectedCase.caseGroup.responses.length;
          let assignedCoders: NormalizedDistributionCoder[];

          if (isDoubleCoded) {
            const pairQuotas = doubleCodingPairQuotasByItemKey.get(itemKey);
            const availableDoubleCodingCombinations = pairQuotas ?
              doubleCodingCoderCombinations.filter(combination => {
                const pairKey =
                  this.distributionPlanner.getPairKey(combination);
                return (
                  (itemPairCounts.get(pairKey) || 0) <
                  (pairQuotas.get(pairKey) || 0)
                );
              }) :
              doubleCodingCoderCombinations;

            if (availableDoubleCodingCombinations.length === 0) {
              throw new Error('No planned double-coding pair is available.');
            }
            assignedCoders =
              this.distributionPlanner.chooseDoubleCodingCoders(
                availableDoubleCodingCombinations,
                itemCoderLoads,
                coderLoads,
                itemPairCounts,
                pairCounts,
                distributionSeed,
                selectedCase.caseGroup.representativeResponse.id,
                taskCount
              );
          } else {
            assignedCoders = [
              this.distributionPlanner.chooseSingleCoder(
                coders,
                itemCoderLoads,
                coderLoads,
                distributionSeed,
                selectedCase.caseGroup.representativeResponse.id,
                taskCount
              )
            ];
          }

          if (isDoubleCoded) {
            const pairKey = this.distributionPlanner.getPairKey(assignedCoders);
            itemPairCounts.set(
              pairKey,
              (itemPairCounts.get(pairKey) || 0) + 1
            );
            pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
          }

          assignedCoders.forEach(coder => {
            const itemLoad = itemCoderLoads.get(coder.id) || {
              tasks: 0,
              doubleTasks: 0
            };
            const load = coderLoads.get(coder.id) || {
              tasks: 0,
              doubleTasks: 0
            };

            itemLoad.tasks += taskCount;
            load.tasks += taskCount;
            if (isDoubleCoded) {
              itemLoad.doubleTasks += taskCount;
              load.doubleTasks += taskCount;
            }
            itemCoderLoads.set(coder.id, itemLoad);
            coderLoads.set(coder.id, load);
          });

          coderLoadsByItemKey.set(itemKey, itemCoderLoads);
          pairCountsByItemKey.set(itemKey, itemPairCounts);
          assignmentsByCaseGroup.set(selectedCase.caseGroup, {
            isDoubleCoded,
            assignedCoders
          });
        });
    });

    selectedCases.forEach(selectedCase => {
      const assignment = assignmentsByCaseGroup.get(selectedCase.caseGroup);
      if (!assignment) {
        throw new Error('Missing distribution assignment.');
      }

      const { isDoubleCoded, assignedCoders } = assignment;
      const assignedCoderIds = assignedCoders.map(coder => coder.id);

      assignedCoders.forEach(coder => {
        if (isSafeKey(coder.displayKey)) {
          distribution[selectedCase.item.itemKey][coder.displayKey] += 1;
        }
        distributionByCoderId[selectedCase.item.itemKey][String(coder.id)] += 1;
        if (isDoubleCoded && isSafeKey(coder.displayKey)) {
          doubleCodingInfo[selectedCase.item.itemKey].doubleCodedCasesPerCoder[
            coder.displayKey
          ] += 1;
        }
        if (isDoubleCoded) {
          doubleCodingInfo[
            selectedCase.item.itemKey
          ].doubleCodedCasesPerCoderId[String(coder.id)] += 1;
        }

        const itemJobs =
          jobsByItemAndCoder.get(selectedCase.item.itemKey) ||
          new Map<number, SlimResponse[]>();
        const coderResponses = itemJobs.get(coder.id) || [];
        coderResponses.push(...selectedCase.caseGroup.responses);
        itemJobs.set(coder.id, coderResponses);
        jobsByItemAndCoder.set(selectedCase.item.itemKey, itemJobs);
      });

      selectedCase.caseGroup.responses.forEach(response => {
        plannedCases.push({
          item: selectedCase.item,
          response,
          allocationCaseKey: selectedCase.caseGroup.caseKey,
          isDoubleCoded,
          assignedCoderIds
        });
      });
    });

    for (const planItem of planItems) {
      const itemCases = plannedCases.filter(
        plannedCase => plannedCase.item.itemKey === planItem.itemKey
      );
      const distinctCaseKeys = new Set(
        itemCases.map(plannedCase => plannedCase.allocationCaseKey)
      );
      const doubleCaseKeys = new Set(
        itemCases
          .filter(plannedCase => plannedCase.isDoubleCoded)
          .map(plannedCase => plannedCase.allocationCaseKey)
      );
      const codingTasksTotal = itemCases.reduce(
        (sum, plannedCase) => sum + plannedCase.assignedCoderIds.length,
        0
      );
      const doubleCases = doubleCaseKeys.size;
      const singleCases = distinctCaseKeys.size - doubleCases;

      doubleCodingInfo[planItem.itemKey].distinctCases = distinctCaseKeys.size;
      doubleCodingInfo[planItem.itemKey].codingTasksTotal = codingTasksTotal;
      doubleCodingInfo[planItem.itemKey].totalCases = codingTasksTotal;
      doubleCodingInfo[planItem.itemKey].doubleCodedCases = doubleCases;
      doubleCodingInfo[planItem.itemKey].singleCodedCasesAssigned = singleCases;
    }

    const jobsToCreate: DistributionPlanJob[] = [];
    for (const planItem of planItems) {
      const itemJobs = jobsByItemAndCoder.get(planItem.itemKey);
      if (!itemJobs) {
        continue;
      }

      for (const [coderId, unitSubset] of itemJobs.entries()) {
        const coder = coderById.get(coderId);
        if (coder && unitSubset.length > 0) {
          jobsToCreate.push({
            coder,
            item: planItem,
            unitSubset
          });
        }
      }
    }

    const tasksPerCoder: Record<string, number> = {};
    const coderWeights: Record<string, number> = {};
    coders.forEach(coder => {
      tasksPerCoder[String(coder.id)] = coderLoads.get(coder.id)?.tasks || 0;
      coderWeights[String(coder.id)] = coder.weight;
    });

    return {
      distribution,
      distributionByCoderId,
      doubleCodingInfo,
      aggregationInfo,
      matchingFlags,
      warnings,
      jobsToCreate,
      plannedCases,
      pairDistribution: Object.fromEntries(pairCounts.entries()),
      tasksPerCoder,
      coderWeights
    };
  }

  async calculateDistributionVariableUsage(
    workspaceId: number,
    request: DistributionVariableUsageRequest
  ): Promise<Map<string, number>> {
    const context = await this.createDistributionVariableUsageContext(
      workspaceId,
      [request]
    );
    return this.getTotalVariableUsageByVariable(
      this.calculateDistributionVariableUsageByStatusFromContext(
        workspaceId,
        request,
        context
      )
    );
  }

  async calculateDistributionVariableUsageBatch(
    workspaceId: number,
    requests: DistributionVariableUsageBatchRequest[]
  ): Promise<Map<string | number, Map<string, number>>> {
    const usageByRequestKey = new Map<string | number, Map<string, number>>();

    if (requests.length === 0) {
      return usageByRequestKey;
    }

    const context = await this.createDistributionVariableUsageContext(
      workspaceId,
      requests
    );
    requests.forEach(request => {
      usageByRequestKey.set(
        request.key,
        this.getTotalVariableUsageByVariable(
          this.calculateDistributionVariableUsageByStatusFromContext(
            workspaceId,
            request,
            context
          )
        )
      );
    });

    return usageByRequestKey;
  }

  async calculateDistributionVariableUsageByStatusBatch(
    workspaceId: number,
    requests: DistributionVariableUsageBatchRequest[]
  ): Promise<Map<string | number, Map<string, DistributionVariableUsageByStatus>>> {
    const usageByRequestKey = new Map<string | number, Map<string, DistributionVariableUsageByStatus>>();

    if (requests.length === 0) {
      return usageByRequestKey;
    }

    const context = await this.createDistributionVariableUsageContext(
      workspaceId,
      requests
    );
    requests.forEach(request => {
      usageByRequestKey.set(
        request.key,
        this.calculateDistributionVariableUsageByStatusFromContext(
          workspaceId,
          request,
          context
        )
      );
    });

    return usageByRequestKey;
  }

  private async createDistributionVariableUsageContext(
    workspaceId: number,
    requests: DistributionVariableUsageRequest[]
  ): Promise<DistributionVariableUsageContext> {
    const allVariables = this.deduplicateVariableReferences(
      requests.flatMap(request => this.getVariableUsageRequestVariables(request)
      )
    );

    if (allVariables.length === 0) {
      return {
        matchingFlags: [],
        aggregationThreshold: null,
        derivedVariableSets: new Map(),
        allResponses: [],
        assignedResponseIds: new Set(),
        assignedResponseIdsByExcludedJobDefinitionId: new Map()
      };
    }

    const excludedJobDefinitionIds = Array.from(
      new Set(
        requests
          .map(request => Number(request.excludeJobDefinitionId))
          .filter(jobDefinitionId => (
            Number.isInteger(jobDefinitionId) &&
            jobDefinitionId > 0
          ))
      )
    );
    const [
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap,
      allResponses,
      assignedResponseIds,
      assignedResponseIdsByExcludedJobDefinitionIdEntries
    ] = await Promise.all([
      this.getResponseMatchingMode(workspaceId),
      this.getAggregationThreshold(workspaceId),
      this.workspaceFilesService.getDerivedVariableMap(workspaceId),
      this.getSlimResponsesForVariables(workspaceId, allVariables),
      this.getAssignedResponseIdsForVariables(workspaceId, allVariables),
      Promise.all(
        excludedJobDefinitionIds.map(async jobDefinitionId => [
          jobDefinitionId,
          await this.getAssignedResponseIdsForVariables(
            workspaceId,
            allVariables,
            jobDefinitionId
          )
        ] as const)
      )
    ]);

    return {
      matchingFlags,
      aggregationThreshold,
      derivedVariableSets: this.buildDerivedVariableSets(derivedVariableMap),
      allResponses,
      assignedResponseIds,
      assignedResponseIdsByExcludedJobDefinitionId: new Map(
        assignedResponseIdsByExcludedJobDefinitionIdEntries
      )
    };
  }

  private calculateDistributionVariableUsageByStatusFromContext(
    workspaceId: number,
    request: DistributionVariableUsageRequest,
    context: DistributionVariableUsageContext
  ): Map<string, DistributionVariableUsageByStatus> {
    const caseOrderingMode = request.caseOrderingMode || 'continuous';
    const distributionSeed = this.getDistributionSeed(workspaceId, request);
    const items = this.buildDistributionItems(request);
    const bundleNameCounts = this.getBundleNameCounts(items);
    const normalizedExcludeJobDefinitionId = Number(request.excludeJobDefinitionId);
    const assignedResponseIdsByExcludedJobDefinitionId =
      context.assignedResponseIdsByExcludedJobDefinitionId ||
      new Map<number, Set<number>>();
    const assignedResponseIds =
      Number.isInteger(normalizedExcludeJobDefinitionId) &&
      normalizedExcludeJobDefinitionId > 0 ?
        assignedResponseIdsByExcludedJobDefinitionId.get(normalizedExcludeJobDefinitionId) ||
          context.assignedResponseIds :
        context.assignedResponseIds;

    if (items.length === 0) {
      return new Map();
    }

    const isDerivedVariable = (unitName: string, variableId: string): boolean => this.isDerivedVariable(context.derivedVariableSets, unitName, variableId);
    const planItems: DistributionPlanItem[] = [];

    for (const itemObj of items) {
      const {
        itemVariables, itemKey, itemLabel, itemCaseOrderingMode
      } =
        this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts);

      if (!isSafeKey(itemKey)) {
        continue;
      }

      const allItemResponses = context.allResponses.filter(response => itemVariables.some(variable => this.responseMatchesVariableReference(response, variable)
      )
      );
      const {
        filteredResponses,
        totalResponses,
        caseStatusesByResponseId
      } = this.getDistributableResponses(
        allItemResponses,
        assignedResponseIds,
        context.matchingFlags,
        context.aggregationThreshold,
        response => isDerivedVariable(response.unitName, response.variableid)
      );
      const availableCases = this.buildDistributionCaseGroups(
        itemObj.type,
        allItemResponses,
        filteredResponses,
        assignedResponseIds,
        itemCaseOrderingMode,
        distributionSeed,
        itemKey
      );

      planItems.push({
        type: itemObj.type,
        item: itemObj.item,
        itemKey,
        itemLabel,
        itemVariables,
        itemCaseOrderingMode,
        uniqueCases: availableCases.length,
        totalResponses,
        availableCases,
        caseStatusesByResponseId,
        selectedCases: []
      });
    }

    const selectedCases = this.selectCasesWithGlobalCap(
      planItems,
      request.maxCodingCases
    );
    const usageByVariable = new Map<string, DistributionVariableUsageByStatus>();

    selectedCases.forEach(({ item, caseGroup }) => {
      caseGroup.responses.forEach(response => {
        this.addResponseToVariableUsageByStatus(
          usageByVariable,
          response,
          item.caseStatusesByResponseId.get(response.id) ||
            this.getResponseUsageStatus(response)
        );
      });
    });

    return usageByVariable;
  }

  private addResponseToVariableUsageByStatus(
    usageByVariable: Map<string, DistributionVariableUsageByStatus>,
    response: SlimResponse,
    caseStatus: DistributionVariableUsageCaseStatus
  ): void {
    const variableKey = `${response.unitName}::${response.variableid}`;
    const usage = usageByVariable.get(variableKey) || {
      regular: 0,
      deriveError: 0,
      total: 0
    };

    if (caseStatus === 'deriveError') {
      usage.deriveError += 1;
    } else {
      usage.regular += 1;
    }
    usage.total += 1;
    usageByVariable.set(variableKey, usage);
  }

  private getTotalVariableUsageByVariable(
    usageByStatus: Map<string, DistributionVariableUsageByStatus>
  ): Map<string, number> {
    return new Map(
      Array.from(usageByStatus.entries()).map(([variableKey, usage]) => [
        variableKey,
        usage.total
      ])
    );
  }

  async calculateDistribution(
    workspaceId: number,
    request: {
      selectedVariables: VariableReference[];
      selectedVariableBundles?: BundleItem[];
      selectedCoders: DistributionCoderInput[];
      doubleCodingAbsolute?: number;
      doubleCodingPercentage?: number;
      caseOrderingMode?: 'continuous' | 'alternating';
      maxCodingCases?: number;
      distributionSeed?: string | number;
    }
  ): Promise<{
      distribution: Record<string, Record<string, number>>;
      distributionByCoderId: Record<string, Record<string, number>>;
      doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
      aggregationInfo: Record<
      string,
      { uniqueCases: number; totalResponses: number }
      >;
      matchingFlags: ResponseMatchingFlag[];
      warnings: JobCreationWarning[];
      pairDistribution: Record<string, number>;
      tasksPerCoder: Record<string, number>;
      coderWeights: Record<string, number>;
    }> {
    await this.assertDeriveErrorManualCodingEnabled(workspaceId, request);
    const plan = await this.buildDistributionPlan(workspaceId, request);
    return {
      distribution: plan.distribution,
      distributionByCoderId: plan.distributionByCoderId,
      doubleCodingInfo: plan.doubleCodingInfo,
      aggregationInfo: plan.aggregationInfo,
      matchingFlags: plan.matchingFlags,
      warnings: plan.warnings,
      pairDistribution: plan.pairDistribution,
      tasksPerCoder: plan.tasksPerCoder,
      coderWeights: plan.coderWeights
    };
  }

  async refreshDistributedCodingJobs(
    workspaceId: number,
    request: DistributionPlanRequest,
    afterRefreshInTransaction?: RefreshDistributedCodingJobsTransactionHook
  ): Promise<JobDefinitionRefreshCodingJobsResult> {
    const jobDefinitionId = Number(request.jobDefinitionId);
    if (!Number.isInteger(jobDefinitionId) || jobDefinitionId < 1) {
      throw new BadRequestException('A valid job definition id is required.');
    }

    let plan: DistributionPlan | null = null;
    let preview: JobDefinitionRefreshPreviewDto | null = null;
    const createdJobs: DistributionCreatedJob[] = [];

    await this.connection.transaction(async manager => {
      await lockWorkspaceTestResultsMutationInTransaction(manager, workspaceId);
      await this.assertDeriveErrorManualCodingEnabled(
        workspaceId,
        request,
        manager
      );
      await this.assertApprovedJobDefinitionCanBeUsed(
        manager,
        workspaceId,
        jobDefinitionId
      );
      await this.lockCodingJobUnitsForDefinition(
        manager,
        workspaceId,
        jobDefinitionId
      );

      const [existingRows, jobsRow, hasCodingWork] = await Promise.all([
        this.getJobDefinitionExistingTaskRows(
          workspaceId,
          jobDefinitionId,
          manager
        ),
        this.getJobDefinitionJobCounts(workspaceId, jobDefinitionId, manager),
        this.jobDefinitionHasAnyCodingWork(
          workspaceId,
          jobDefinitionId,
          manager
        )
      ]);

      const transactionPlan = await this.buildDistributionPlan(
        workspaceId,
        request,
        manager
      );
      plan = transactionPlan;

      preview = this.buildJobDefinitionRefreshPreview(
        jobDefinitionId,
        transactionPlan,
        existingRows,
        jobsRow,
        hasCodingWork
      );

      if (!preview.canApply) {
        throw new BadRequestException(
          preview.blockingReason || 'Job definition refresh cannot be applied.'
        );
      }

      if (preview.existingJobsCount > 0) {
        await this.deleteCodingJobsByDefinitionInManager(
          manager,
          workspaceId,
          jobDefinitionId
        );
      }

      createdJobs.push(
        ...(await this.createDistributedCodingJobsFromPlanInManager(
          workspaceId,
          request,
          transactionPlan,
          manager
        ))
      );

      if (afterRefreshInTransaction) {
        await afterRefreshInTransaction(manager, {
          ...this.buildDistributedCodingJobsResult(
            transactionPlan,
            createdJobs
          ),
          preview
        });
      }
    });

    await this.invalidateIncompleteVariablesCache(workspaceId);
    if (!plan || !preview) {
      throw new BadRequestException(
        'Job definition refresh could not be planned.'
      );
    }

    return {
      ...this.buildDistributedCodingJobsResult(plan, createdJobs),
      preview
    };
  }

  private async createDistributedCodingJobsFromPlanInManager(
    workspaceId: number,
    request: DistributionPlanRequest,
    plan: DistributionPlan,
    manager: EntityManager
  ): Promise<DistributionCreatedJob[]> {
    const createdJobs: DistributionCreatedJob[] = [];

    for (const job of plan.jobsToCreate) {
      const jobName =
        job.item.type === 'bundle' ?
          `Job ${job.item.itemLabel} (${job.coder.name})` :
          `Job ${(job.item.item as VariableReference).unitName} - ${(job.item.item as VariableReference).variableId} (${job.coder.name})`;
      const createCodingJobDto: InternalCreateCodingJobDto = {
        name: jobName,
        assignedCoders: [job.coder.id],
        caseOrderingMode: job.item.itemCaseOrderingMode,
        jobDefinitionId: request.jobDefinitionId,
        showScore: request.showScore,
        allowComments: request.allowComments,
        suppressGeneralInstructions: request.suppressGeneralInstructions,
        missings_profile_id: request.missingsProfileId,
        ...(job.item.type === 'bundle' ?
          { variableBundleIds: [(job.item.item as BundleItem).id] } :
          { variables: job.item.itemVariables })
      };
      const codingJob = await this.createCodingJobWithUnitSubsetInManager(
        workspaceId,
        createCodingJobDto,
        job.unitSubset,
        manager
      );

      createdJobs.push({
        itemKey: job.item.itemKey,
        coderId: job.coder.id,
        coderName: job.coder.name,
        variable:
          job.item.type === 'bundle' ?
            { unitName: job.item.itemLabel, variableId: '' } :
            {
              unitName: (job.item.item as VariableReference).unitName,
              variableId: (job.item.item as VariableReference).variableId
            },
        jobId: codingJob.id,
        jobName,
        caseCount: this.countDistributionCasesInResponses(
          job.item,
          job.unitSubset
        )
      });
    }

    return createdJobs;
  }

  private buildDistributedCodingJobsResult(
    plan: DistributionPlan,
    createdJobs: DistributionCreatedJob[]
  ): DistributedCodingJobsResult {
    return {
      success: true,
      jobsCreated: createdJobs.length,
      message: `Created ${createdJobs.length} distributed coding jobs`,
      distribution: plan.distribution,
      distributionByCoderId: plan.distributionByCoderId,
      doubleCodingInfo: plan.doubleCodingInfo,
      aggregationInfo: plan.aggregationInfo,
      matchingFlags: plan.matchingFlags,
      warnings: plan.warnings,
      pairDistribution: plan.pairDistribution,
      tasksPerCoder: plan.tasksPerCoder,
      coderWeights: plan.coderWeights,
      jobs: createdJobs
    };
  }

  async createDistributedCodingJobs(
    workspaceId: number,
    request: DistributionPlanRequest,
    afterCreateInTransaction?: DistributedCodingJobsTransactionHook
  ): Promise<DistributedCodingJobsResult> {
    this.logger.log(
      `Creating distributed coding jobs for workspace ${workspaceId}`
    );

    const createdJobs: DistributionCreatedJob[] = [];

    try {
      await this.assertDeriveErrorManualCodingEnabled(workspaceId, request);
      const plan = await this.buildDistributionPlan(workspaceId, request);

      if (
        plan.jobsToCreate.length > 0 ||
        request.jobDefinitionId !== undefined
      ) {
        await this.connection.transaction(async manager => {
          await this.assertApprovedJobDefinitionHasNoCreatedJobs(
            manager,
            workspaceId,
            request.jobDefinitionId
          );

          createdJobs.push(
            ...(await this.createDistributedCodingJobsFromPlanInManager(
              workspaceId,
              request,
              plan,
              manager
            ))
          );

          if (afterCreateInTransaction) {
            await afterCreateInTransaction(
              manager,
              this.buildDistributedCodingJobsResult(plan, createdJobs)
            );
          }
        });
      }

      this.logger.log(
        `Successfully created ${createdJobs.length} distributed coding jobs`
      );
      await this.invalidateIncompleteVariablesCache(workspaceId);

      return this.buildDistributedCodingJobsResult(plan, createdJobs);
    } catch (error) {
      this.logger.error(
        `Error creating distributed coding jobs: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        jobsCreated: 0,
        message: `Failed to create distributed jobs: ${error.message}`,
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: [],
        pairDistribution: {},
        tasksPerCoder: {},
        coderWeights: {},
        jobs: []
      };
    }
  }

  async hasCodingIssues(codingJobId: number): Promise<boolean> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id', 'job_type']
    });
    if (!codingJob) {
      return false;
    }

    const codingJobUnits = await this.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    return codingJobUnits.some(
      unit => this.codingJobUnitRequiresIssueReview(unit)
    );
  }

  private async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id');
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'variableCasesReviewMarker'
    );
    await this.applyCodingJobUnitExclusions(
      query,
      workspaceId,
      'codingJobVariableCasesInJobs'
    );
    const rawResults = await query.getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }

  async getBulkCodingProgress(
    codingJobIds: number[],
    workspaceId: number
  ): Promise<
    Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>
    > {
    if (codingJobIds.length === 0) {
      return {};
    }

    const codingJobs = await this.codingJobRepository.find({
      where: { id: In(codingJobIds), workspace_id: workspaceId },
      select: ['id', 'workspace_id']
    });

    if (codingJobs.length !== codingJobIds.length) {
      throw new NotFoundException(
        'One or more coding jobs not found in the workspace'
      );
    }

    const progressMap: Record<
    number,
    Record<string, SaveCodingProgressDto['selectedCode']>
    > = {};

    await Promise.all(
      codingJobs.map(async job => {
        progressMap[job.id] = await this.getCodingProgress(job.id);
      })
    );

    return progressMap;
  }

  /**
   * Get the duplicate aggregation threshold for a workspace
   * Returns 2 as default (aggregation enabled by default)
   */
  async getAggregationThreshold(
    workspaceId: number,
    manager?: EntityManager
  ): Promise<number | null> {
    const settingKey = `workspace-${workspaceId}-duplicate-aggregation-threshold`;
    const repository = manager ?
      manager.getRepository(Setting) :
      this.settingRepository;
    const setting = await repository.findOne({
      where: { key: settingKey }
    });

    if (!setting) {
      // Default: threshold = 2 (aggregation enabled)
      return 2;
    }

    // Allow explicit disable by setting to 'disabled' or '0'
    if (setting.content === 'disabled' || setting.content === '0') {
      return null;
    }

    const threshold = parseInt(setting.content, 10);
    if (Number.isNaN(threshold)) {
      return 2;
    }

    return Math.min(100, Math.max(2, threshold));
  }

  /**
   * Set the duplicate aggregation threshold for a workspace
   */
  async setAggregationThreshold(
    workspaceId: number,
    threshold: number | null
  ): Promise<void> {
    const settingKey = `workspace-${workspaceId}-duplicate-aggregation-threshold`;

    if (threshold === null) {
      // Explicitly disable aggregation
      await this.settingRepository.save({
        key: settingKey,
        content: 'disabled'
      });
    } else {
      await this.settingRepository.save({
        key: settingKey,
        content: threshold.toString()
      });
    }

    this.logger.log(
      `Set aggregation threshold for workspace ${workspaceId}: ${threshold}`
    );
  }

  /**
   * Filter responses to include only one representative per duplicate group
   * Groups responses by unit+variable+normalized_value and keeps only the first
   */
  private async filterResponsesForAggregation(
    responses: ResponseEntity[],
    threshold: number,
    workspaceId: number
  ): Promise<ResponseEntity[]> {
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);

    // Group responses by unit+variable+normalized_value
    const groupMap = new Map<string, ResponseEntity[]>();

    for (const response of responses) {
      const unit = response.unit;
      if (!unit) continue;

      if (!response.value || response.value === '') continue;

      const normalizedValue = this.normalizeValue(
        response.value,
        matchingFlags
      );
      const key = `${unit.name}_${response.variableid}_${normalizedValue}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(response);
    }

    // For each group, keep only first response if group size >= threshold
    const filteredResponses: ResponseEntity[] = [];

    for (const [key, group] of groupMap.entries()) {
      if (group.length >= threshold) {
        group.sort((a, b) => a.id - b.id);
        filteredResponses.push(group[0]);

        this.logger.debug(
          `Group ${key}: ${group.length} duplicates, keeping master ${group[0].id}`
        );
      } else {
        filteredResponses.push(...group);
      }
    }

    return filteredResponses;
  }
}
