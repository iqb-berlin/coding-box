import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Not, Connection, EntityManager, SelectQueryBuilder
} from 'typeorm';
import * as cheerio from 'cheerio';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { SaveCodingNotesDto } from '../../../admin/coding-job/dto/save-coding-notes.dto';
import { sortUnitsContinuous, sortUnitsAlternating } from '../../../utils/coding-utils';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
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
import { buildAggregationGroups } from './aggregation-metrics.util';
import {
  formatCodingTestPersonFromUnit,
  generateCodingProgressKey,
  parseCodingTestPerson
} from './coding-progress-key.util';
import {
  CodingJobFreshnessImpactDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../../api-dto/coding/job-refresh.dto';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';

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

type VariableReference = { unitName: string; variableId: string };
type BundleItem = { id: number; name: string; caseOrderingMode?: 'continuous' | 'alternating'; variables: VariableReference[] };
type DistributionItem = { type: 'bundle' | 'variable'; item: BundleItem | VariableReference };
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
};

type DistributionVariableUsageRequest = {
  selectedVariables: VariableReference[];
  selectedVariableBundles?: BundleItem[];
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number;
  jobDefinitionId?: number;
  distributionSeed?: string | number;
};

type DistributionVariableUsageBatchRequest = DistributionVariableUsageRequest & {
  key: string | number;
};

type DistributionVariableUsageContext = {
  matchingFlags: ResponseMatchingFlag[];
  aggregationThreshold: number | null;
  derivedVariableSets: Map<string, Set<string>>;
  allResponses: SlimResponse[];
  assignedResponseIds: Set<number>;
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
  availableResponses: SlimResponse[];
  selectedResponses: SlimResponse[];
};

type DistributionPlanCase = {
  item: DistributionPlanItem;
  response: SlimResponse;
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
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  jobsToCreate: DistributionPlanJob[];
  plannedCases: DistributionPlanCase[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
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

type DistributedCodingJobsResult = {
  success: boolean;
  jobsCreated: number;
  message: string;
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionDoubleCodingInfo>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: ResponseMatchingFlag[];
  warnings: JobCreationWarning[];
  pairDistribution: Record<string, number>;
  tasksPerCoder: Record<string, number>;
  coderWeights: Record<string, number>;
  jobs: DistributionCreatedJob[];
};

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
}

interface CodingJobCountRow {
  jobDefinitionId: number | string;
  jobsCount: number | string;
}

const JOB_DEFINITION_DELETE_READY_STATUSES = [
  'results_applied',
  'review'
];

type InternalCreateCodingJobDto = CreateCodingJobDto & {
  jobDefinitionId?: number;
};

const UPDATABLE_CODING_JOB_STATUSES = new Set([
  'pending',
  'active',
  'paused',
  'open',
  'completed'
]);

export interface CodingJobAggregationSettings {
  aggregationEnabled: boolean;
  aggregationThreshold: number | null;
  responseMatchingFlags: ResponseMatchingFlag[];
  aggregationSettingsVersion: number | null;
  fromJobSnapshot: boolean;
}

@Injectable()
export class CodingJobService {
  private readonly logger = new Logger(CodingJobService.name);

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
    private usersService: UsersService
  ) { }

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
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const isAdmin = await this.usersService.getUserIsAdmin(userId);
    if (isAdmin) {
      return;
    }

    const accessLevel = await this.usersService.getUserAccessLevel(userId, workspaceId);
    if ((accessLevel ?? 0) >= managerAccessLevel) {
      return;
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

  private async applyCodingJobUnitExclusions<T>(
    queryBuilder: SelectQueryBuilder<T>,
    workspaceId: number,
    parameterPrefix: string
  ): Promise<void> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
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
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return codingJobUnits.filter(unit => !isExcludedByResolvedExclusions(
      exclusions,
      unit.booklet_name,
      unit.unit_name
    ));
  }

  async getCodingJobProgress(jobId: number): Promise<{ progress: number; coded: number; total: number; open: number }> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: jobId },
      select: ['id', 'workspace_id']
    });

    if (!codingJob) {
      return {
        progress: 0, coded: 0, total: 0, open: 0
      };
    }

    const totalUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId });
    await this.applyCodingJobUnitExclusions(totalUnitsQuery, codingJob.workspace_id, 'codingJobProgressTotal');
    const totalUnits = await totalUnitsQuery.getCount();

    if (totalUnits === 0) {
      return {
        progress: 0, coded: 0, total: 0, open: 0
      };
    }

    const codedUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.code IS NOT NULL');
    await this.applyCodingJobUnitExclusions(codedUnitsQuery, codingJob.workspace_id, 'codingJobProgressCoded');

    const openUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    await this.applyCodingJobUnitExclusions(openUnitsQuery, codingJob.workspace_id, 'codingJobProgressOpen');

    const [codedUnits, openUnits] = await Promise.all([
      codedUnitsQuery.getCount(),
      openUnitsQuery.getCount()
    ]);

    const progress = totalUnits > 0 ? Math.round((Math.min(totalUnits, codedUnits) / totalUnits) * 100) : 0;

    return {
      progress, coded: codedUnits, total: totalUnits, open: openUnits
    };
  }

  async getCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(new Set(
      definitionIds.filter(definitionId => Number.isFinite(definitionId))
    ));

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const rows: CodingJobCountRow[] = await this.codingJobRepository
      .createQueryBuilder('coding_job')
      .select('coding_job.job_definition_id', 'jobDefinitionId')
      .addSelect('COUNT(coding_job.id)', 'jobsCount')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id IN (:...definitionIds)', {
        definitionIds: uniqueDefinitionIds
      })
      .groupBy('coding_job.job_definition_id')
      .getRawMany();

    return new Map(rows.map(row => [
      Number(row.jobDefinitionId),
      Number(row.jobsCount)
    ]));
  }

  async getBlockingCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(new Set(
      definitionIds.filter(definitionId => Number.isFinite(definitionId))
    ));

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const rows: CodingJobCountRow[] = await this.codingJobRepository
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
      .groupBy('coding_job.job_definition_id')
      .getRawMany();

    return new Map(rows.map(row => [
      Number(row.jobDefinitionId),
      Number(row.jobsCount)
    ]));
  }

  async getCodingJobFreshnessImpact(
    workspaceId: number,
    codingJobId: number
  ): Promise<CodingJobFreshnessImpactDto> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
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

    await this.applyCodingJobUnitExclusions(countsQuery, workspaceId, 'codingJobFreshnessImpact');
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

    const [
      plan,
      existingRows,
      jobsRow,
      hasCodingWork
    ] = await Promise.all([
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
    existingRows: Array<{ responseId: number; taskCount: number }>,
    jobsRow: { existingJobsCount: number; staleJobsCount: number },
    hasCodingWork: boolean
  ): JobDefinitionRefreshPreviewDto {
    const existingResponseIds = new Set(existingRows.map(row => row.responseId));
    const plannedResponseIds = new Set(plan.plannedCases.map(plannedCase => plannedCase.response.id));
    const existingTaskCountByResponseId = new Map(existingRows.map(row => [row.responseId, row.taskCount]));
    const plannedTaskCountByResponseId = new Map<number, number>();

    plan.plannedCases.forEach(plannedCase => {
      plannedTaskCountByResponseId.set(
        plannedCase.response.id,
        (plannedTaskCountByResponseId.get(plannedCase.response.id) || 0) +
        plannedCase.assignedCoderIds.length
      );
    });

    const retainedCases = [...plannedResponseIds]
      .filter(responseId => existingResponseIds.has(responseId))
      .length;
    const addedCases = [...plannedResponseIds]
      .filter(responseId => !existingResponseIds.has(responseId))
      .length;
    const removedCases = [...existingResponseIds]
      .filter(responseId => !plannedResponseIds.has(responseId))
      .length;
    let addedCodingTasks = 0;
    let removedCodingTasks = 0;
    const responseIdsForTaskDelta = new Set([
      ...existingTaskCountByResponseId.keys(),
      ...plannedTaskCountByResponseId.keys()
    ]);

    responseIdsForTaskDelta.forEach(responseId => {
      const taskDelta = (plannedTaskCountByResponseId.get(responseId) || 0) -
        (existingTaskCountByResponseId.get(responseId) || 0);
      if (taskDelta > 0) {
        addedCodingTasks += taskDelta;
      } else {
        removedCodingTasks += Math.abs(taskDelta);
      }
    });
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
      addedCodingTasks,
      removedCodingTasks,
      canApply,
      ...(canApply ? {} : {
        blockingReason: 'Bestehende Kodierjobs enthalten bereits Kodierarbeit. Bitte pruefen Sie die betroffenen Jobs, bevor die Definition neu verteilt wird.'
      })
    };
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
    const repository = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
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
  ): Promise<Array<{ responseId: number; taskCount: number }>> {
    const repository = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
    const query = repository
      .createQueryBuilder('cju')
      .select('cju.response_id', 'responseId')
      .addSelect('COUNT(cju.id)', 'taskCount')
      .innerJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', { jobDefinitionId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.response_id');

    await this.applyCodingJobUnitExclusions(query, workspaceId, 'jobDefinitionExistingTasks');
    const rows = await query.getRawMany<{ responseId: string | number; taskCount: string | number }>();
    return rows.map(row => ({
      responseId: Number(row.responseId),
      taskCount: Number(row.taskCount)
    })).filter(row => Number.isFinite(row.responseId) && Number.isFinite(row.taskCount));
  }

  private async getJobDefinitionJobCounts(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager
  ): Promise<{ existingJobsCount: number; staleJobsCount: number }> {
    const repository = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
    const row = await repository
      .createQueryBuilder('coding_job')
      .select('COUNT(coding_job.id)', 'existingJobsCount')
      .addSelect(
        "COUNT(CASE WHEN coding_job.freshness_status <> 'current' THEN 1 END)",
        'staleJobsCount'
      )
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', { jobDefinitionId })
      .getRawOne<{ existingJobsCount?: string | number; staleJobsCount?: string | number }>();

    return {
      existingJobsCount: Number(row?.existingJobsCount || 0),
      staleJobsCount: Number(row?.staleJobsCount || 0)
    };
  }

  private async jobDefinitionHasCodingWork(
    workspaceId: number,
    jobDefinitionId: number,
    manager?: EntityManager,
    applyExclusions = true
  ): Promise<boolean> {
    const repository = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
    const query = repository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', { jobDefinitionId })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere(
        `(cju.code IS NOT NULL
          OR cju.score IS NOT NULL
          OR cju.is_open = true
          OR cju.notes IS NOT NULL
          OR cju.supervisor_comment IS NOT NULL
          OR cju.coding_issue_option IS NOT NULL)`
      );

    if (applyExclusions) {
      await this.applyCodingJobUnitExclusions(query, workspaceId, 'jobDefinitionCodingWork');
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
    await manager.getRepository(CodingJobUnit)
      .createQueryBuilder('cju')
      .select('cju.id', 'id')
      .innerJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id = :jobDefinitionId', { jobDefinitionId })
      .andWhere('coding_job.training_id IS NULL')
      .setLock('pessimistic_write')
      .getRawMany();
  }

  private async assertApprovedJobDefinitionHasNoCreatedJobs(
    manager: EntityManager,
    workspaceId: number,
    jobDefinitionId?: number
  ): Promise<void> {
    if (jobDefinitionId === undefined || jobDefinitionId === null) {
      return;
    }

    const normalizedJobDefinitionId = await this.assertApprovedJobDefinitionCanBeUsed(
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
    limit?: number
  ): Promise<{
      data: (CodingJob & {
        assignedCoders?: number[];
        assignedVariables?: { unitName: string; variableId: string }[];
        assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
        progress?: number;
        codedUnits?: number;
        totalUnits?: number;
        openUnits?: number;
      })[]; total: number; totalOpenUnits?: number; page: number; limit?: number
    }> {
    const validPage = page > 0 ? page : 1;
    const shouldPaginate = limit !== undefined && limit > 0;
    const skip = shouldPaginate ? (validPage - 1) * limit : undefined;
    const take = shouldPaginate ? limit : undefined;

    const total = await this.codingJobRepository.count({
      where: { workspace_id: workspaceId }
    });

    const jobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['training'],
      order: { created_at: 'DESC' },
      skip,
      take
    });

    const jobIds = jobs.map(job => job.id);

    const [allCoders, allVariables, variableBundleEntities, progressData] = await Promise.all([
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
      Promise.all(jobIds.map(jobId => this.getCodingJobProgress(jobId)))
    ]);

    const codersByJobId = new Map<number, number[]>();
    allCoders.forEach(coder => {
      if (!codersByJobId.has(coder.coding_job_id)) {
        codersByJobId.set(coder.coding_job_id, []);
      }
      codersByJobId.get(coder.coding_job_id)!.push(coder.user_id);
    });

    const variablesByJobId = new Map<number, { unitName: string; variableId: string }[]>();
    allVariables.forEach(variable => {
      if (!variablesByJobId.has(variable.coding_job_id)) {
        variablesByJobId.set(variable.coding_job_id, []);
      }
      variablesByJobId.get(variable.coding_job_id)!.push({
        unitName: variable.unit_name,
        variableId: variable.variable_id
      });
    });

    const variableBundlesByJobId = new Map<number, { name: string; variables: { unitName: string; variableId: string }[] }[]>();
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

    const data = jobs.map((job, index) => ({
      ...job,
      assignedCoders: codersByJobId.get(job.id) || [],
      assignedVariables: variablesByJobId.get(job.id) || [],
      assignedVariableBundles: variableBundlesByJobId.get(job.id) || [],
      progress: progressData[index]?.progress || 0,
      codedUnits: progressData[index]?.coded || 0,
      totalUnits: progressData[index]?.total || 0,
      openUnits: progressData[index]?.open || 0
    }));

    const totalOpenUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    await this.applyCodingJobUnitExclusions(totalOpenUnitsQuery, workspaceId, 'codingJobsOpenUnits');
    const totalOpenUnits = await totalOpenUnitsQuery.getCount();

    return {
      data,
      total,
      totalOpenUnits,
      page: validPage,
      limit
    };
  }

  async getCodingJob(id: number, workspaceId?: number): Promise<{
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
        throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
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

    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: id }
    });
    const variableBundleIds = codingJobVariableBundles.map(bundle => bundle.variable_bundle_id);
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(variableBundleIds) }
    });

    // Include variables from bundles
    const bundleVariables = variableBundles.flatMap(bundle => bundle.variables || []);
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
    return this.connection.transaction(async manager => {
      const codingJobRepo = manager.getRepository(CodingJob);
      const aggregationSettings = await this.getCurrentAggregationSettingsSnapshot(workspaceId);
      const codingJob = codingJobRepo.create({
        workspace_id: workspaceId,
        name: createCodingJobDto.name,
        description: createCodingJobDto.description,
        status: createCodingJobDto.status || 'pending',
        showScore: createCodingJobDto.showScore ?? false,
        allowComments: createCodingJobDto.allowComments ?? true,
        suppressGeneralInstructions: createCodingJobDto.suppressGeneralInstructions ?? false,
        missings_profile_id: createCodingJobDto.missings_profile_id,
        aggregation_enabled: aggregationSettings.aggregationEnabled,
        aggregation_threshold: aggregationSettings.aggregationThreshold,
        response_matching_flags: aggregationSettings.responseMatchingFlags,
        aggregation_settings_version: aggregationSettings.aggregationSettingsVersion
      });

      const savedCodingJob = await codingJobRepo.save(codingJob);

      if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
      }

      if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
        await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables, manager);
      }

      if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds, manager);
      } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
        if (createCodingJobDto.variableBundles[0].id) {
          const bundleIds = createCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(savedCodingJob.id, bundleIds, manager);
          }
        } else {
          const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
          if (variables.length > 0) {
            await this.assignVariables(savedCodingJob.id, variables, manager);
          }
        }
      }
      await this.saveCodingJobUnits(savedCodingJob.id, createCodingJobDto.maxCodingCases, manager);

      return savedCodingJob;
    });
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
        throw new BadRequestException(`Unsupported coding job status: ${targetStatus}`);
      }
      if (codingJob.codingJob.status === 'results_applied') {
        throw new Error(`Cannot change status of coding job ${id} because it has already been applied to results (status: results_applied)`);
      }
      if (codingJob.codingJob.status === 'completed' && targetStatus !== 'completed') {
        throw new BadRequestException(`Cannot change status of completed coding job ${id}`);
      }
      if (codingJob.codingJob.status !== 'completed' && targetStatus === 'completed') {
        await this.assertCodingJobCanBeCompleted(id);
      }
      codingJob.codingJob.status = targetStatus;
    }
    if (updateCodingJobDto.comment !== undefined) {
      codingJob.codingJob.comment = updateCodingJobDto.comment;
    }
    if (updateCodingJobDto.missingsProfileId !== undefined) {
      codingJob.codingJob.missings_profile_id = updateCodingJobDto.missingsProfileId;
    }
    if (updateCodingJobDto.showScore !== undefined) {
      codingJob.codingJob.showScore = updateCodingJobDto.showScore;
    }
    if (updateCodingJobDto.allowComments !== undefined) {
      codingJob.codingJob.allowComments = updateCodingJobDto.allowComments;
    }
    if (updateCodingJobDto.suppressGeneralInstructions !== undefined) {
      codingJob.codingJob.suppressGeneralInstructions = updateCodingJobDto.suppressGeneralInstructions;
    }

    const savedCodingJob = await this.codingJobRepository.save(codingJob.codingJob);

    if (updateCodingJobDto.assignedCoders !== undefined) {
      await this.codingJobCoderRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(id, updateCodingJobDto.assignedCoders);
      }
    }

    if (updateCodingJobDto.variables !== undefined) {
      await this.codingJobVariableRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variables.length > 0) {
        await this.assignVariables(id, updateCodingJobDto.variables);
      }
    }

    if (updateCodingJobDto.variableBundleIds !== undefined) {
      await this.codingJobVariableBundleRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(id, updateCodingJobDto.variableBundleIds);
      }
    } else if (updateCodingJobDto.variableBundles !== undefined) {
      await this.codingJobVariableBundleRepository.delete({ coding_job_id: id });

      if (updateCodingJobDto.variableBundles.length > 0) {
        if (updateCodingJobDto.variableBundles[0].id) {
          const bundleIds = updateCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(id, bundleIds);
          }
        } else {
          const variables = updateCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
          if (variables.length > 0) {
            await this.assignVariables(id, variables);
          }
        }
      }
    }

    return savedCodingJob;
  }

  async markCodingJobResultsApplied(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepository = this.getCodingJobRepository(manager);
    const codingJob = await this.getCodingJobByIdForWorkspace(id, workspaceId, manager);

    if (codingJob.status === 'results_applied') {
      return codingJob;
    }

    if (codingJob.freshness_status === 'stale_source') {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because its source responses changed`
      );
    }

    if (codingJob.status !== 'completed') {
      throw new BadRequestException(
        `Cannot apply results for coding job ${id} because it is not completed`
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
      throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
    }

    return codingJob;
  }

  private getCodingJobRepository(manager?: EntityManager): Repository<CodingJob> {
    return manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
  }

  async deleteCodingJob(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    await this.codingJobRepository.remove(codingJob.codingJob);

    // Invalidate the incomplete variables cache since coding job units were deleted
    await this.invalidateIncompleteVariablesCache(workspaceId);

    return { success: true };
  }

  private async invalidateIncompleteVariablesCache(workspaceId: number): Promise<void> {
    const cacheKey = `coding_incomplete_variables_v3:${workspaceId}`;
    await this.cacheService.delete(cacheKey);
    this.logger.log(`Invalidated manual coding variables cache for workspace ${workspaceId}`);
  }

  async assignCoders(codingJobId: number, userIds: number[], manager?: EntityManager): Promise<CodingJobCoder[]> {
    const repo = manager ? manager.getRepository(CodingJobCoder) : this.codingJobCoderRepository;
    await repo.delete({ coding_job_id: codingJobId });
    const coders = userIds.map(userId => repo.create({
      coding_job_id: codingJobId,
      user_id: userId
    }));

    return repo.save(coders);
  }

  async transferCodingCases(
    workspaceId: number,
    sourceCoderId: number,
    targetCoderId: number
  ): Promise<TransferCodingCasesResult> {
    if (sourceCoderId === targetCoderId) {
      throw new BadRequestException('Source and target coder must be different');
    }

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

      const affectedJobIds = [...new Set(sourceAssignments.map(assignment => assignment.coding_job_id))];

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
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
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
    const repo = manager ? manager.getRepository(CodingJobVariable) : this.codingJobVariableRepository;
    const codingJobVariables = variables.map(variable => repo.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    }));

    return repo.save(codingJobVariables);
  }

  private async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[],
    manager?: EntityManager
  ): Promise<CodingJobVariableBundle[]> {
    const repo = manager ? manager.getRepository(CodingJobVariableBundle) : this.codingJobVariableBundleRepository;
    const variableBundles = variableBundleIds.map(variableBundleId => repo.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    }));

    return repo.save(variableBundles);
  }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { user_id: coderId },
      relations: ['coding_job']
    });

    return codingJobCoders.map(cjc => cjc.coding_job);
  }

  async getCodersByJobId(jobId: number): Promise<number[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: jobId }
    });

    return codingJobCoders.map(cjc => cjc.user_id);
  }

  async getCodingJobById(id: number): Promise<CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: { name: string; variables: { unitName: string; variableId: string }[] }[];
  }> {
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

    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
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

  async getResponsesForCodingJob(codingJobId: number, manager?: EntityManager): Promise<ResponseEntity[]> {
    const jobRepo = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
    const variableRepo = manager ? manager.getRepository(CodingJobVariable) : this.codingJobVariableRepository;
    const bundleRepo = manager ? manager.getRepository(CodingJobVariableBundle) : this.codingJobVariableBundleRepository;
    const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;

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

    const allVariables: { unit_name: string; variable_id: string }[] = codingJobVariables.map(v => ({
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

    const queryBuilder = responseRepo.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId: codingJob.workspace_id })
      .andWhere('person.consider = :consider', { consider: true });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    // Exclude aggregated duplicates (marked with code_v2 = -111)
    queryBuilder.andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)');
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(codingJob.workspace_id);
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  async saveCodingProgress(
    codingJobId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    if (codingJob.status === 'results_applied') {
      throw new BadRequestException('Cannot save progress for a coding job whose results have already been applied');
    }

    const {
      login: personLogin,
      code: personCode,
      group: personGroup,
      booklet: bookletName
    } = parseCodingTestPerson(progress.testPerson);

    const whereCondition: Partial<CodingJobUnit> = {
      coding_job_id: codingJobId,
      unit_name: progress.unitId,
      variable_id: progress.variableId,
      person_login: personLogin,
      person_code: personCode,
      booklet_name: bookletName
    };

    if (personGroup !== undefined) {
      whereCondition.person_group = personGroup;
    }

    const codingJobUnit = await this.codingJobUnitRepository.findOne({
      where: whereCondition
    });

    if (!codingJobUnit) {
      throw new NotFoundException('Coding job unit not found for progress entry');
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(codingJob.workspace_id);
    if (isExcludedByResolvedExclusions(exclusions, codingJobUnit.booklet_name, codingJobUnit.unit_name)) {
      throw new NotFoundException('Coding job unit not found for progress entry');
    }

    const selectedCode = await this.validateProgressSelectedCode(progress, codingJobUnit, codingJob.workspace_id);

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
      codingJobUnit.coding_issue_option = selectedCode.codingIssueOption ?? null;
    }

    if (progress.notes !== undefined) {
      codingJobUnit.notes = progress.notes || null;
    }

    await this.codingJobUnitRepository.save(codingJobUnit);

    await this.checkAndUpdateCodingJobCompletion(codingJobId);

    return codingJob;
  }

  private async validateProgressSelectedCode(
    progress: SaveCodingProgressDto,
    codingJobUnit: CodingJobUnit,
    workspaceId: number
  ): Promise<NonNullable<SaveCodingProgressDto['selectedCode']> | null> {
    if (progress.isOpen === true) {
      return null;
    }

    const selectedCode = progress.selectedCode;
    if (selectedCode === null) {
      return null;
    }

    if (!selectedCode || typeof selectedCode !== 'object') {
      throw new BadRequestException('selectedCode must be an object, null, or omitted only when isOpen is true');
    }

    if (!Number.isInteger(selectedCode.id)) {
      throw new BadRequestException('selectedCode.id must be an integer');
    }

    const allowedIssueCodes = new Set([-1, -2, -3, -4]);
    if (selectedCode.id < 0 && !allowedIssueCodes.has(selectedCode.id)) {
      throw new BadRequestException(`Unsupported coding issue code: ${selectedCode.id}`);
    }

    if (
      selectedCode.codingIssueOption !== undefined &&
      selectedCode.codingIssueOption !== null &&
      !allowedIssueCodes.has(selectedCode.codingIssueOption)
    ) {
      throw new BadRequestException(`Unsupported coding issue option: ${selectedCode.codingIssueOption}`);
    }

    if (selectedCode.id < 0) {
      selectedCode.score = null;
      return selectedCode;
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(codingJobUnit, workspaceId, selectedCode.id);
    selectedCode.score = schemeCode.score ?? null;

    if (
      selectedCode.score !== undefined &&
      selectedCode.score !== null &&
      !Number.isFinite(selectedCode.score)
    ) {
      throw new BadRequestException('selectedCode.score must be a finite number');
    }

    return selectedCode;
  }

  private async getCodingSchemeCodeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number
  ): Promise<CodingSchemeCode> {
    const codingScheme = await this.getRequiredCodingSchemeForUnit(codingJobUnit, workspaceId);
    const variableCoding = this.findVariableCoding(codingScheme, codingJobUnit.variable_id);
    if (!variableCoding?.codes) {
      throw new BadRequestException(`Coding scheme variable not found: ${codingJobUnit.variable_id}`);
    }

    const schemeCode = variableCoding.codes.find(code => Number(code.id) === codeId);
    if (!schemeCode) {
      throw new BadRequestException(`Unsupported code for variable ${codingJobUnit.variable_id}: ${codeId}`);
    }

    return schemeCode;
  }

  private findVariableCoding(
    codingScheme: CodingScheme,
    variableId: string
  ): CodingSchemeVariableCoding | undefined {
    return codingScheme.variableCodings?.find(vc => vc.id === variableId || vc.alias === variableId);
  }

  private async getCodingSchemeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number
  ): Promise<CodingScheme | undefined> {
    const codingSchemesByUnit = await this.getCodingSchemesForUnits([codingJobUnit], workspaceId);
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
      const unitFile = this.findFileByCandidates(unitFileById, unitFileCandidatesByUnit.get(unit) ?? []);
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

    const codingSchemes = await this.getCodingSchemes([...codingSchemeRefs], workspaceId);
    codingSchemeRefsByUnit.forEach((refs, unit) => {
      const scheme = refs
        .map(ref => codingSchemes.get(ref))
        .find((candidate): candidate is CodingScheme => candidate !== undefined);
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
    const codingScheme = await this.getCodingSchemeForUnit(codingJobUnit, workspaceId);
    if (!codingScheme) {
      throw new BadRequestException('Coding scheme not found for coding job unit');
    }

    return codingScheme;
  }

  private getUnitFileIdCandidates(codingJobUnit: CodingJobUnit): string[] {
    return this.getFileIdCandidates(codingJobUnit.unit_alias, codingJobUnit.unit_name, '.XML');
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
      return $('codingSchemeRef').first().text().trim() ||
        $('CodingSchemeRef').first().text().trim() ||
        null;
    } catch (error) {
      this.logger.warn(`Could not parse unit file ${unitFile.file_id}: ${error.message}`);
      return null;
    }
  }

  async saveCodingNotes(
    codingJobId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    if (codingJob.status === 'results_applied') {
      throw new BadRequestException('Cannot save notes for a coding job whose results have already been applied');
    }

    const {
      login: personLogin,
      code: personCode,
      group: personGroup,
      booklet: bookletName
    } = parseCodingTestPerson(notesDto.testPerson);

    const whereCondition: Partial<CodingJobUnit> = {
      coding_job_id: codingJobId,
      unit_name: notesDto.unitId,
      variable_id: notesDto.variableId,
      person_login: personLogin,
      person_code: personCode,
      booklet_name: bookletName
    };

    if (personGroup !== undefined) {
      whereCondition.person_group = personGroup;
    }

    const codingJobUnit = await this.codingJobUnitRepository.findOne({
      where: whereCondition
    });

    if (!codingJobUnit) {
      throw new NotFoundException('Coding job unit not found for notes entry');
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(codingJob.workspace_id);
    if (isExcludedByResolvedExclusions(exclusions, codingJobUnit.booklet_name, codingJobUnit.unit_name)) {
      throw new NotFoundException('Coding job unit not found for notes entry');
    }

    codingJobUnit.notes = notesDto.notes?.trim() || null;
    await this.codingJobUnitRepository.save(codingJobUnit);

    return codingJob;
  }

  async getCodingProgress(codingJobId: number): Promise<Record<string, SaveCodingProgressDto['selectedCode']>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const codingJobUnits = await this.getVisibleCodingJobUnits(codingJobId, codingJob.workspace_id);

    if (codingJobUnits.length === 0) {
      return {};
    }

    const codedUnits = codingJobUnits.filter(unit => !unit.is_open && unit.code !== null && unit.code >= 0);
    const codingSchemesByUnit = await this.getCodingSchemesForUnits(codedUnits, codingJob.workspace_id);

    const progressMap: Record<string, SaveCodingProgressDto['selectedCode']> = {};

    codingJobUnits.forEach(unit => {
      const compositeKey = generateCodingProgressKey(
        formatCodingTestPersonFromUnit(unit),
        unit.unit_name,
        unit.variable_id
      );

      if (unit.is_open) {
        progressMap[`${compositeKey}:open`] = {
          id: -1,
          code: '',
          label: 'OPEN'
        };
      } else if (unit.code !== null) {
        const codingScheme = codingSchemesByUnit.get(unit);
        let code: string | undefined;
        let label: string | undefined;

        if (codingScheme) {
          const variableCoding = this.findVariableCoding(codingScheme, unit.variable_id);
          if (variableCoding?.codes) {
            const codeEntry = variableCoding.codes.find(c => Number(c.id) === unit.code);
            if (codeEntry) {
              code = codeEntry.code;
              label = codeEntry.label;
            }
          }
        }

        progressMap[compositeKey] = {
          id: unit.code,
          code,
          label
        };

        if (unit.score !== null) {
          progressMap[compositeKey].score = unit.score;
        }

        if (unit.coding_issue_option !== null) {
          (progressMap[compositeKey]).codingIssueOption = unit.coding_issue_option;
        }
      }
    });

    return progressMap;
  }

  async getCodingNotes(codingJobId: number): Promise<Record<string, string>> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId }
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${codingJobId} not found`);
    }

    const codingJobUnits = await this.getVisibleCodingJobUnits(codingJobId, codingJob.workspace_id);

    if (codingJobUnits.length === 0) {
      return {};
    }

    const notesMap: Record<string, string> = {};

    codingJobUnits.forEach(unit => {
      if (unit.notes) {
        const compositeKey = generateCodingProgressKey(
          formatCodingTestPersonFromUnit(unit),
          unit.unit_name,
          unit.variable_id
        );
        notesMap[compositeKey] = unit.notes;
      }
    });

    return notesMap;
  }

  async getCodingJobUnits(codingJobId: number, onlyOpen: boolean = false): Promise<{
    responseId: number;
    unitName: string;
    unitAlias: string | null;
    variableId: string;
    variableAnchor: string;
    bookletName: string;
    personLogin: string;
    personCode: string;
    personGroup: string;
    notes: string | null;
    variableBundleId: number | null;
    isDoubleCoded: boolean;
    otherCoders: string[];
  }[]> {
    const whereClause: { coding_job_id: number; is_open?: boolean } = { coding_job_id: codingJobId };

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

    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: whereClause,
      select: [
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
        'variable_bundle_id'
      ]
    });
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(codingJob.workspace_id);
    const visibleCodingJobUnits = codingJobUnits.filter(unit => !isExcludedByResolvedExclusions(
      exclusions,
      unit.booklet_name,
      unit.unit_name
    ));

    // Detect double coding and other coders in the same logical coding scope.
    const responseIds = visibleCodingJobUnits.map(unit => unit.response_id);
    const otherCodersMap = new Map<number, Set<string>>();
    const currentCoderIds = new Set((codingJob.codingJobCoders || []).map(cjc => cjc.user_id));

    if (responseIds.length > 0) {
      const otherUnits = await this.codingJobUnitRepository.find({
        where: {
          response_id: In(responseIds),
          coding_job_id: Not(codingJobId)
        },
        relations: ['coding_job', 'coding_job.codingJobCoders', 'coding_job.codingJobCoders.user']
      });

      otherUnits.forEach(unit => {
        const otherJob = unit.coding_job;
        if (!otherJob ||
          otherJob.workspace_id !== codingJob.workspace_id ||
          !this.isComparableDoubleCodingScope(codingJob, otherJob)) {
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
      const mode = key === 'unbundled' ? globalMode : (bundleModes.get(key as number) || globalMode);
      units.sort(mode === 'alternating' ? sortUnitsAlternating : sortUnitsContinuous);
      sortedUnits = sortedUnits.concat(units);
    }

    return sortedUnits.map(unit => {
      const otherCoders = Array.from(otherCodersMap.get(unit.response_id) || []);
      return {
        responseId: unit.response_id,
        unitName: unit.unit_name,
        unitAlias: unit.unit_alias,
        variableId: unit.variable_id,
        variableAnchor: unit.variable_anchor,
        bookletName: unit.booklet_name,
        personLogin: unit.person_login,
        personCode: unit.person_code,
        personGroup: unit.person_group,
        notes: unit.notes,
        variableBundleId: unit.variable_bundle_id,
        isDoubleCoded: otherCoders.length > 0,
        otherCoders: otherCoders
      };
    });
  }

  private isComparableDoubleCodingScope(currentJob: CodingJob, otherJob: CodingJob): boolean {
    if (currentJob.training_id || otherJob.training_id) {
      return currentJob.training_id === otherJob.training_id;
    }

    if (currentJob.job_definition_id || otherJob.job_definition_id) {
      return currentJob.job_definition_id === otherJob.job_definition_id;
    }

    return true;
  }

  private async getSlimResponsesForCodingJob(codingJobId: number, manager?: EntityManager): Promise<SlimResponse[]> {
    const jobRepo = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
    const variableRepo = manager ? manager.getRepository(CodingJobVariable) : this.codingJobVariableRepository;
    const bundleRepo = manager ? manager.getRepository(CodingJobVariableBundle) : this.codingJobVariableBundleRepository;

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
    const allVariables: { unit_name: string; variable_id: string }[] = codingJobVariables.map(v => ({
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
          variableBundleMap.set(`${variable.unitName}::${variable.variableId}`, bundle.variable_bundle_id);
        });
      }
    });

    if (allVariables.length === 0) {
      return [];
    }

    const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;
    const queryBuilder = responseRepo.createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect('COALESCE(bookletinfo.name, \'\')', 'bookletName')
      .addSelect('COALESCE(person.login, \'\')', 'personLogin')
      .addSelect('COALESCE(person.code, \'\')', 'personCode')
      .addSelect('COALESCE(person.group, \'\')', 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      });

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    allVariables.forEach((variable, index) => {
      const unitParam = `cjUnitName${index}`;
      const variableParam = `cjVariableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unit_name;
      parameters[variableParam] = variable.variable_id;
    });

    queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    queryBuilder.andWhere('(response.code_v2 IS NULL OR (response.code_v2 != -111 AND response.code_v2 != -98))');
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const raw = await queryBuilder.orderBy('response.id', 'ASC').getRawMany();

    return raw.map(r => {
      const unitName = r.unitName ?? '';
      const variableid = r.variableid;
      return {
        id: Number(r.id),
        variableid: variableid,
        value: r.value ?? null,
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

  private async saveCodingJobUnits(codingJobId: number, maxCodingCases?: number, manager?: EntityManager): Promise<void> {
    let responses = await this.getSlimResponsesForCodingJob(codingJobId, manager);

    if (responses.length === 0) {
      return;
    }

    // Get coding job to find workspace ID
    const codingJobRepo = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
    const codingJob = await codingJobRepo.findOne({ where: { id: codingJobId } });
    if (!codingJob) {
      throw new Error(`Coding job ${codingJobId} not found`);
    }
    const workspaceId = codingJob.workspace_id;

    const aggregationSettings = await this.getAggregationSettingsForCodingJob(codingJob);
    const aggregationThreshold = aggregationSettings.aggregationThreshold;

    // If aggregation is enabled, filter to unique cases using slim-compatible logic
    if (aggregationSettings.aggregationEnabled && aggregationThreshold !== null && aggregationThreshold >= 2) {
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
    if (maxCodingCases && maxCodingCases > 0 && responses.length > maxCodingCases) {
      // Shuffle responses to ensure random distribution across variables (Fisher-Yates)
      for (let i = responses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [responses[i], responses[j]] = [responses[j], responses[i]];
      }
      responses = responses.slice(0, maxCodingCases);
    }

    const repo = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
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
      }));
      await repo.save(units);

      // Reset response status for non-training jobs to ensure a fresh coding/review cycle
      if (!codingJob.training_id) {
        const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;
        const responseIds = chunk.map(r => r.id);
        const incompleteStatus = statusStringToNumber('CODING_INCOMPLETE');

        await responseRepo.update(
          { id: In(responseIds) },
          {
            status_v2: incompleteStatus,
            code_v2: null,
            score_v2: null
          }
        );
      }
    }
  }

  private async getCodingSchemes(unitAliases: string[], workspaceId: number): Promise<Map<string, CodingScheme>> {
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
        const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        codingSchemes.set(file.file_id, data);
      } catch (error) {
        codingSchemes.set(file.file_id, {});
      }
    }

    return codingSchemes;
  }

  async restartCodingJobWithOpenUnits(codingJobId: number, workspaceId: number): Promise<CodingJob> {
    const codingJob = await this.getCodingJob(codingJobId, workspaceId);
    codingJob.codingJob.status = 'open';
    await this.codingJobRepository.save(codingJob.codingJob);

    return codingJob.codingJob;
  }

  private async checkAndUpdateCodingJobCompletion(codingJobId: number): Promise<void> {
    const progress = await this.getCodingJobProgress(codingJobId);

    if (progress.total > 0 && progress.coded + progress.open >= progress.total) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      await this.codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }

  private async assertCodingJobCanBeCompleted(codingJobId: number): Promise<void> {
    const progress = await this.getCodingJobProgress(codingJobId);
    const missingUnits = Math.max(0, progress.total - progress.coded - progress.open);

    if (progress.total === 0) {
      throw new BadRequestException('Cannot complete a coding job without coding units');
    }

    if (missingUnits > 0 || progress.open > 0 || progress.coded < progress.total) {
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
    return this.connection.transaction(manager => this.createCodingJobWithUnitSubsetInManager(
      workspaceId,
      createCodingJobDto,
      unitSubset,
      manager
    ));
  }

  private async createCodingJobWithUnitSubsetInManager(
    workspaceId: number,
    createCodingJobDto: InternalCreateCodingJobDto,
    unitSubset: SlimResponse[],
    manager: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepo = manager.getRepository(CodingJob);
    const aggregationSettings = await this.getCurrentAggregationSettingsSnapshot(workspaceId);
    const codingJob = codingJobRepo.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending',
      showScore: createCodingJobDto.showScore ?? false,
      allowComments: createCodingJobDto.allowComments ?? true,
      suppressGeneralInstructions: createCodingJobDto.suppressGeneralInstructions ?? false,
      missings_profile_id: createCodingJobDto.missings_profile_id,
      job_definition_id: createCodingJobDto.jobDefinitionId,
      case_ordering_mode: createCodingJobDto.caseOrderingMode || 'continuous',
      aggregation_enabled: aggregationSettings.aggregationEnabled,
      aggregation_threshold: aggregationSettings.aggregationThreshold,
      response_matching_flags: aggregationSettings.responseMatchingFlags,
      aggregation_settings_version: aggregationSettings.aggregationSettingsVersion
    });

    const savedCodingJob = await codingJobRepo.save(codingJob);

    if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
      await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders, manager);
    }

    if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
      await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables, manager);
    }

    if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
      await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds, manager);
    } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
      if (createCodingJobDto.variableBundles[0].id) {
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(savedCodingJob.id, bundleIds, manager);
        }
      } else {
        const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables, manager);
        }
      }
    }

    await this.saveCodingJobUnitsSubset(savedCodingJob.id, workspaceId, unitSubset, manager);

    return savedCodingJob;
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

    // Get coding job to check if it's a training job
    const codingJobRepo = manager ? manager.getRepository(CodingJob) : this.codingJobRepository;
    const codingJob = await codingJobRepo.findOne({ where: { id: codingJobId } });
    const isTraining = codingJob?.training_id !== null && codingJob?.training_id !== undefined;

    const unitRepo = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
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
      }));
      await unitRepo.save(units);

      // Reset response status for non-training jobs
      if (!isTraining) {
        const responseRepo = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;
        const responseIds = chunk.map(r => r.id);
        const incompleteStatus = statusStringToNumber('CODING_INCOMPLETE');

        await responseRepo.update(
          { id: In(responseIds) },
          {
            status_v2: incompleteStatus,
            code_v2: null,
            score_v2: null
          }
        );
      }
    }
  }

  async getCurrentAggregationSettingsSnapshot(workspaceId: number): Promise<CodingJobAggregationSettings> {
    const [aggregationThreshold, responseMatchingFlags] = await Promise.all([
      this.getAggregationThreshold(workspaceId),
      this.getResponseMatchingMode(workspaceId)
    ]);
    const aggregationEnabled =
      aggregationThreshold !== null && !responseMatchingFlags.includes(ResponseMatchingFlag.NO_AGGREGATION);

    return {
      aggregationEnabled,
      aggregationThreshold,
      responseMatchingFlags,
      aggregationSettingsVersion: 1,
      fromJobSnapshot: false
    };
  }

  async getAggregationSettingsForCodingJob(codingJob: CodingJob): Promise<CodingJobAggregationSettings> {
    if (codingJob.aggregation_settings_version !== null && codingJob.aggregation_settings_version !== undefined) {
      const responseMatchingFlags = this.normalizeResponseMatchingFlags(
        codingJob.response_matching_flags as ResponseMatchingFlag[] | undefined | null
      );
      const aggregationThreshold = codingJob.aggregation_enabled ? codingJob.aggregation_threshold : null;

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

  async getDerivedVariableMapForAggregation(workspaceId: number): Promise<Map<string, Set<string>>> {
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });
    return derivedVariableSets;
  }

  async getResponseMatchingMode(workspaceId: number, manager?: EntityManager): Promise<ResponseMatchingFlag[]> {
    const settingKey = `workspace-${workspaceId}-response-matching-mode`;
    const repository = manager ? manager.getRepository(Setting) : this.settingRepository;
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

    this.logger.log(`Set response matching mode for workspace ${workspaceId}: ${normalizedFlags.join(', ')}`);
    return normalizedFlags;
  }

  normalizeResponseMatchingFlags(flags: ResponseMatchingFlag[] | undefined | null): ResponseMatchingFlag[] {
    const allowedFlags = new Set(Object.values(ResponseMatchingFlag));
    const normalizedFlags = Array.from(new Set(flags ?? []))
      .filter((flag): flag is ResponseMatchingFlag => allowedFlags.has(flag));

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
  ): { normalizedValue: string; responses: SlimResponse[]; totalResponses: number }[] {
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

    return Array.from(groups.entries()).map(([normalizedValue, groupResponses]) => ({
      normalizedValue,
      responses: groupResponses,
      totalResponses: groupResponses.length
    }));
  }

  private aggregateResponsesByVariableAndValue(
    responses: SlimResponse[],
    flags: ResponseMatchingFlag[],
    isDerivedResponse: (response: SlimResponse) => boolean
  ): { normalizedValue: string; responses: SlimResponse[]; totalResponses: number }[] {
    if (flags.includes(ResponseMatchingFlag.NO_AGGREGATION)) {
      return responses.map(r => ({
        normalizedValue: r.value || '',
        responses: [r],
        totalResponses: 1
      }));
    }

    const groups = new Map<string, { normalizedValue: string; responses: SlimResponse[] }>();

    for (const response of responses) {
      const normalizedValue = this.normalizeValue(response.value, flags);
      const aggregationKey = isDerivedResponse(response) ?
        `${response.unitName.toUpperCase()}::${response.variableid}::${response.id}` :
        `${response.unitName.toUpperCase()}::${response.variableid}::${normalizedValue}`;
      const existing = groups.get(aggregationKey) || { normalizedValue, responses: [] };
      existing.responses.push(response);
      groups.set(aggregationKey, existing);
    }

    return Array.from(groups.values()).map(group => ({
      normalizedValue: group.normalizedValue,
      responses: group.responses,
      totalResponses: group.responses.length
    }));
  }

  private async filterSlimResponsesForAggregation(
    workspaceId: number,
    responses: SlimResponse[],
    aggregationThreshold: number,
    matchingFlags: ResponseMatchingFlag[]
  ): Promise<SlimResponse[]> {
    const derivedVariableMap = await this.getDerivedVariableMapForAggregation(workspaceId);
    const groups = buildAggregationGroups(
      responses.map(response => ({
        ...response,
        responseId: response.id,
        variableId: response.variableid
      })),
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

  async getResponsesForVariables(workspaceId: number, variables: { unitName: string; variableId: string }[]): Promise<ResponseEntity[]> {
    if (variables.length === 0) {
      return [];
    }

    const queryBuilder = this.responseRepository.createQueryBuilder('response')
      .leftJoinAndSelect('response.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .leftJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('(response.code_v2 IS NULL OR response.code_v2 != -111)');
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `unitName${index}`;
      const variableParam = `variableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    return queryBuilder
      .orderBy('response.id', 'ASC')
      .getMany();
  }

  async getSlimResponsesForVariables(
    workspaceId: number,
    variables: { unitName: string; variableId: string }[],
    manager?: EntityManager
  ): Promise<SlimResponse[]> {
    if (variables.length === 0) {
      return [];
    }

    const repository = manager ? manager.getRepository(ResponseEntity) : this.responseRepository;
    const queryBuilder = repository.createQueryBuilder('response')
      .select('response.id', 'id')
      .addSelect('response.variableid', 'variableid')
      .addSelect('response.value', 'value')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect('COALESCE(bookletinfo.name, \'\')', 'bookletName')
      .addSelect('COALESCE(person.login, \'\')', 'personLogin')
      .addSelect('COALESCE(person.code, \'\')', 'personCode')
      .addSelect('COALESCE(person.group, \'\')', 'personGroup')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('(response.code_v2 IS NULL OR (response.code_v2 != -111 AND response.code_v2 != -98))');
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(queryBuilder, exclusions);

    const conditions: string[] = [];
    const parameters: Record<string, string> = {};

    variables.forEach((variable, index) => {
      const unitParam = `slimUnitName${index}`;
      const variableParam = `slimVariableId${index}`;
      conditions.push(`(unit.name = :${unitParam} AND response.variableid = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    if (conditions.length > 0) {
      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, parameters);
    }

    const raw = await queryBuilder
      .orderBy('response.id', 'ASC')
      .getRawMany();

    return raw.map(r => ({
      id: Number(r.id),
      variableid: r.variableid,
      value: r.value ?? null,
      unitName: r.unitName ?? '',
      unitAlias: r.unitAlias ?? null,
      bookletName: r.bookletName ?? '',
      personLogin: r.personLogin ?? '',
      personCode: r.personCode ?? '',
      personGroup: r.personGroup ?? ''
    }));
  }

  private async getAssignedResponseIdsForVariables(
    workspaceId: number,
    variables: { unitName: string; variableId: string }[],
    excludeJobDefinitionId?: number,
    manager?: EntityManager
  ): Promise<Set<number>> {
    if (variables.length === 0) {
      return new Set();
    }

    const repository = manager ? manager.getRepository(CodingJobUnit) : this.codingJobUnitRepository;
    const query = repository.createQueryBuilder('cju')
      .select('DISTINCT cju.response_id', 'responseId')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL');

    if (excludeJobDefinitionId !== undefined && excludeJobDefinitionId !== null) {
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
      conditions.push(`(cju.unit_name = :${unitParam} AND cju.variable_id = :${variableParam})`);
      parameters[unitParam] = variable.unitName;
      parameters[variableParam] = variable.variableId;
    });

    query.andWhere(`(${conditions.join(' OR ')})`, parameters);
    await this.applyCodingJobUnitExclusions(query, workspaceId, 'assignedResponseIdsForVariables');

    const rawResults = await query.getRawMany();
    return new Set(rawResults
      .map(row => Number(row.responseId))
      .filter(responseId => Number.isFinite(responseId)));
  }

  private getDistributableResponses(
    allItemResponses: SlimResponse[],
    assignedResponseIds: Set<number>,
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    isDerivedResponse: (response: SlimResponse) => boolean
  ): DistributableResponses {
    const filteredResponses: SlimResponse[] = [];
    let uniqueCases = 0;
    let totalResponses = 0;

    if (aggregationThreshold !== null) {
      const aggregatedGroups = this.aggregateResponsesByVariableAndValue(
        allItemResponses,
        matchingFlags,
        isDerivedResponse
      );

      aggregatedGroups.forEach(group => {
        if (group.responses.length >= aggregationThreshold) {
          const groupAlreadyAssigned = group.responses.some(response => assignedResponseIds.has(response.id));
          if (!groupAlreadyAssigned) {
            group.responses.sort((a, b) => a.id - b.id);
            filteredResponses.push(group.responses[0]);
            uniqueCases += 1;
            totalResponses += group.responses.length;
          }
          return;
        }

        const unassignedResponses = group.responses.filter(response => !assignedResponseIds.has(response.id));
        filteredResponses.push(...unassignedResponses);
        uniqueCases += unassignedResponses.length;
        totalResponses += unassignedResponses.length;
      });

      return { filteredResponses, uniqueCases, totalResponses };
    }

    const unassignedResponses = allItemResponses.filter(response => !assignedResponseIds.has(response.id));

    return {
      filteredResponses: unassignedResponses,
      uniqueCases: unassignedResponses.length,
      totalResponses: unassignedResponses.length
    };
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
    request: Pick<DistributionPlanRequest, 'distributionSeed' | 'jobDefinitionId'>
  ): string {
    if (request.distributionSeed !== undefined && request.distributionSeed !== null && request.distributionSeed !== '') {
      return String(request.distributionSeed);
    }

    if (request.jobDefinitionId !== undefined && request.jobDefinitionId !== null) {
      return `job-definition:${request.jobDefinitionId}`;
    }

    return `workspace:${workspaceId}:distributed-coding`;
  }

  private stableHash(value: string): number {
    let hash = 0;

    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 4294967291;
    }

    return hash;
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

  private sortResponsesForDistribution(
    responses: SlimResponse[],
    mode: 'continuous' | 'alternating',
    seed: string,
    itemKey: string
  ): SlimResponse[] {
    const groups = new Map<string, SlimResponse[]>();

    for (const response of responses) {
      const key = this.getResponseStratumKey(response, mode);
      const group = groups.get(key) || [];
      group.push(response);
      groups.set(key, group);
    }

    const groupEntries = Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        group: group.sort((a, b) => this.compareResponsesByMode(mode, a, b))
      }))
      .sort((a, b) => {
        const hashA = this.stableHash(`${seed}:${itemKey}:stratum:${a.key}`);
        const hashB = this.stableHash(`${seed}:${itemKey}:stratum:${b.key}`);
        return hashA - hashB || a.key.localeCompare(b.key);
      });

    const result: SlimResponse[] = [];
    let remaining = true;

    while (remaining) {
      remaining = false;
      for (const entry of groupEntries) {
        const response = entry.group.shift();
        if (response) {
          result.push(response);
          remaining = true;
        }
      }
    }

    return result;
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
        throw new BadRequestException('Selected coders must have positive integer IDs.');
      }
      if (seenCoderIds.has(coderId)) {
        throw new BadRequestException(`Duplicate coder ID ${coderId} is not allowed.`);
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
            throw new BadRequestException('selectedCoders.weight must be greater than 0.');
          }
          weight = explicitWeight;
        }

        const displayKey = (nameCounts.get(coder.name) || 0) > 1 || !isSafeKey(coder.name) ?
          `${coder.name} (#${coder.id})` :
          coder.name;

        return {
          id: Number(coder.id),
          name: coder.name,
          username: coder.username,
          weight,
          displayKey,
          tieBreaker: this.stableHash(`${seed}:coder:${coder.id}`)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }

  private buildDistributionItems(
    request: Pick<DistributionPlanRequest, 'selectedVariables' | 'selectedVariableBundles'>
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
        bundleNameCounts.set(bundle.name, (bundleNameCounts.get(bundle.name) || 0) + 1);
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
        itemLabel: (bundleNameCounts.get(bundleItem.name) || 0) > 1 ?
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
      itemObj => this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts).itemVariables
    );
  }

  private deduplicateVariableReferences(variables: VariableReference[]): VariableReference[] {
    const uniqueVariables = new Map<string, VariableReference>();

    variables.forEach(variable => {
      uniqueVariables.set(`${variable.unitName}::${variable.variableId}`, variable);
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
    return derivedVariableSets.get(unitName.toUpperCase())?.has(variableId) ?? false;
  }

  private selectCasesWithGlobalCap(
    planItems: DistributionPlanItem[],
    maxCodingCases?: number
  ): { item: DistributionPlanItem; response: SlimResponse }[] {
    const totalAvailable = planItems.reduce((sum, item) => sum + item.availableResponses.length, 0);
    const targetCases = typeof maxCodingCases === 'number' && maxCodingCases > 0 ?
      Math.min(maxCodingCases, totalAvailable) :
      totalAvailable;
    const queues = planItems.map(item => ({
      item,
      responses: [...item.availableResponses]
    }));
    const selected: { item: DistributionPlanItem; response: SlimResponse }[] = [];
    const selectedResponseIds = new Set<number>();

    while (selected.length < targetCases) {
      let progressed = false;

      for (const queue of queues) {
        if (selected.length >= targetCases) {
          break;
        }

        while (queue.responses.length > 0) {
          const response = queue.responses.shift();
          if (!response || selectedResponseIds.has(response.id)) {
            continue;
          }

          selected.push({ item: queue.item, response });
          queue.item.selectedResponses.push(response);
          selectedResponseIds.add(response.id);
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
    const doubleCodingAbsolute = Number(request.doubleCodingAbsolute || 0);
    const doubleCodingPercentage = Number(request.doubleCodingPercentage || 0);

    if (doubleCodingAbsolute > 0 && doubleCodingPercentage > 0) {
      throw new BadRequestException('Use either doubleCodingAbsolute or doubleCodingPercentage, not both.');
    }

    if (doubleCodingAbsolute > 0) {
      return Math.min(doubleCodingAbsolute, totalCases);
    }

    if (doubleCodingPercentage > 0) {
      return Math.min(Math.floor((doubleCodingPercentage / 100) * totalCases), totalCases);
    }

    return 0;
  }

  private getCoderLoadRatio(
    coder: NormalizedDistributionCoder,
    load: { tasks: number; doubleTasks: number }
  ): number {
    return load.tasks / coder.weight;
  }

  private chooseSingleCoder(
    coders: NormalizedDistributionCoder[],
    coderLoads: Map<number, { tasks: number; doubleTasks: number }>,
    seed: string,
    response: SlimResponse
  ): NormalizedDistributionCoder {
    return [...coders].sort((a, b) => {
      const loadA = coderLoads.get(a.id) || { tasks: 0, doubleTasks: 0 };
      const loadB = coderLoads.get(b.id) || { tasks: 0, doubleTasks: 0 };
      const ratioA = this.getCoderLoadRatio(a, loadA);
      const ratioB = this.getCoderLoadRatio(b, loadB);
      const tieA = this.stableHash(`${seed}:single:${response.id}:${a.id}`);
      const tieB = this.stableHash(`${seed}:single:${response.id}:${b.id}`);

      return ratioA - ratioB ||
        loadA.tasks - loadB.tasks ||
        tieA - tieB ||
        a.tieBreaker - b.tieBreaker;
    })[0];
  }

  private getCoderCombinations(
    coders: NormalizedDistributionCoder[],
    size: number,
    startIndex = 0,
    prefix: NormalizedDistributionCoder[] = []
  ): NormalizedDistributionCoder[][] {
    if (prefix.length === size) {
      return [prefix];
    }

    const combinations: NormalizedDistributionCoder[][] = [];

    for (let i = startIndex; i < coders.length; i += 1) {
      combinations.push(...this.getCoderCombinations(coders, size, i + 1, [...prefix, coders[i]]));
    }

    return combinations;
  }

  private chooseDoubleCodingCoders(
    coderCombinations: NormalizedDistributionCoder[][],
    coderLoads: Map<number, { tasks: number; doubleTasks: number }>,
    pairCounts: Map<string, number>,
    seed: string,
    response: SlimResponse
  ): NormalizedDistributionCoder[] {
    return [...coderCombinations].sort((a, b) => {
      const score = (combination: NormalizedDistributionCoder[]) => {
        const projectedRatios = combination.map(coder => {
          const load = coderLoads.get(coder.id) || { tasks: 0, doubleTasks: 0 };
          return (load.tasks + 1) / coder.weight;
        });
        const projectedDoubleRatios = combination.map(coder => {
          const load = coderLoads.get(coder.id) || { tasks: 0, doubleTasks: 0 };
          return (load.doubleTasks + 1) / coder.weight;
        });
        const pairKey = combination.map(coder => coder.id).sort((x, y) => x - y).join('-');

        return {
          maxLoad: Math.max(...projectedRatios),
          totalLoad: projectedRatios.reduce((sum, value) => sum + value, 0),
          maxDoubleLoad: Math.max(...projectedDoubleRatios),
          pairCount: pairCounts.get(pairKey) || 0,
          tie: this.stableHash(`${seed}:double:${response.id}:${pairKey}`)
        };
      };
      const scoreA = score(a);
      const scoreB = score(b);

      return scoreA.maxLoad - scoreB.maxLoad ||
        scoreA.pairCount - scoreB.pairCount ||
        scoreA.maxDoubleLoad - scoreB.maxDoubleLoad ||
        scoreA.totalLoad - scoreB.totalLoad ||
        scoreA.tie - scoreB.tie;
    })[0];
  }

  private buildEmptyDoubleCodingInfo(coders: NormalizedDistributionCoder[]): DistributionDoubleCodingInfo {
    const doubleCodedCasesPerCoder: Record<string, number> = {};

    coders.forEach(coder => {
      if (isSafeKey(coder.displayKey)) {
        doubleCodedCasesPerCoder[coder.displayKey] = 0;
      }
    });

    return {
      totalCases: 0,
      distinctCases: 0,
      codingTasksTotal: 0,
      doubleCodedCases: 0,
      singleCodedCasesAssigned: 0,
      doubleCodedCasesPerCoder
    };
  }

  private async buildDistributionPlan(
    workspaceId: number,
    request: DistributionPlanRequest,
    manager?: EntityManager
  ): Promise<DistributionPlan> {
    const caseOrderingMode = request.caseOrderingMode || 'continuous';
    const distributionSeed = this.getDistributionSeed(workspaceId, request);
    const coders = this.normalizeDistributionCoders(request.selectedCoders, distributionSeed);
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

    const matchingFlags = await this.getResponseMatchingMode(workspaceId, manager);
    const aggregationThreshold = await this.getAggregationThreshold(workspaceId, manager);
    const derivedVariableMap = await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    const derivedVariableSets = this.buildDerivedVariableSets(derivedVariableMap);
    const isDerivedVariable = (unitName: string, variableId: string): boolean => this.isDerivedVariable(
      derivedVariableSets,
      unitName,
      variableId
    );

    const allVariables = items.flatMap(
      itemObj => this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts).itemVariables
    );
    const allResponses = await this.getSlimResponsesForVariables(workspaceId, allVariables, manager);
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
      const variableResponses = allResponses.filter(r => r.unitName === variable.unitName && r.variableid === variable.variableId);
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
    const aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }> = {};

    for (const itemObj of items) {
      const {
        itemVariables,
        itemKey,
        itemLabel,
        itemCaseOrderingMode
      } = this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts);

      if (!isSafeKey(itemKey)) {
        continue;
      }

      const allItemResponses = allResponses.filter(response => itemVariables.some(v => v.unitName === response.unitName && v.variableId === response.variableid)
      );
      const { filteredResponses, uniqueCases, totalResponses } = this.getDistributableResponses(
        allItemResponses,
        assignedResponseIds,
        matchingFlags,
        aggregationThreshold,
        response => isDerivedVariable(response.unitName, response.variableid)
      );
      const availableResponses = this.sortResponsesForDistribution(
        filteredResponses,
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
        uniqueCases,
        totalResponses,
        availableResponses,
        selectedResponses: []
      };

      planItems.push(planItem);
      aggregationInfo[itemKey] = {
        uniqueCases,
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

    const selectedCases = this.selectCasesWithGlobalCap(planItems, request.maxCodingCases);
    const doubleCodingCount = this.getDoubleCodingCount(request, selectedCases.length);

    if (doubleCodingCount > 0 && coders.length < codersPerDoubleCodedCase) {
      throw new BadRequestException(
        `Double coding requires at least ${codersPerDoubleCodedCase} selected coders.`
      );
    }

    const coderLoads = new Map<number, { tasks: number; doubleTasks: number }>(
      coders.map(coder => [coder.id, { tasks: 0, doubleTasks: 0 }])
    );
    const pairCounts = new Map<string, number>();
    const coderById = new Map(coders.map(coder => [coder.id, coder]));
    const jobsByItemAndCoder = new Map<string, Map<number, SlimResponse[]>>();
    const plannedCases: DistributionPlanCase[] = [];
    const doubleCodingCoderCombinations = doubleCodingCount > 0 ?
      this.getCoderCombinations(coders, codersPerDoubleCodedCase) :
      [];

    selectedCases.forEach((selectedCase, index) => {
      const isDoubleCoded = index < doubleCodingCount;
      const assignedCoders = isDoubleCoded ?
        this.chooseDoubleCodingCoders(
          doubleCodingCoderCombinations,
          coderLoads,
          pairCounts,
          distributionSeed,
          selectedCase.response
        ) :
        [this.chooseSingleCoder(coders, coderLoads, distributionSeed, selectedCase.response)];
      const assignedCoderIds = assignedCoders.map(coder => coder.id);

      if (isDoubleCoded) {
        const pairKey = [...assignedCoderIds].sort((a, b) => a - b).join('-');
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }

      assignedCoders.forEach(coder => {
        const load = coderLoads.get(coder.id) || { tasks: 0, doubleTasks: 0 };
        load.tasks += 1;
        if (isDoubleCoded) {
          load.doubleTasks += 1;
        }
        coderLoads.set(coder.id, load);

        if (isSafeKey(coder.displayKey)) {
          distribution[selectedCase.item.itemKey][coder.displayKey] += 1;
        }
        distributionByCoderId[selectedCase.item.itemKey][String(coder.id)] += 1;
        if (isDoubleCoded && isSafeKey(coder.displayKey)) {
          doubleCodingInfo[selectedCase.item.itemKey].doubleCodedCasesPerCoder[coder.displayKey] += 1;
        }

        const itemJobs = jobsByItemAndCoder.get(selectedCase.item.itemKey) || new Map<number, SlimResponse[]>();
        const coderResponses = itemJobs.get(coder.id) || [];
        coderResponses.push(selectedCase.response);
        itemJobs.set(coder.id, coderResponses);
        jobsByItemAndCoder.set(selectedCase.item.itemKey, itemJobs);
      });

      plannedCases.push({
        item: selectedCase.item,
        response: selectedCase.response,
        isDoubleCoded,
        assignedCoderIds
      });
    });

    for (const planItem of planItems) {
      const itemCases = plannedCases.filter(plannedCase => plannedCase.item.itemKey === planItem.itemKey);
      const doubleCases = itemCases.filter(plannedCase => plannedCase.isDoubleCoded).length;
      const singleCases = itemCases.length - doubleCases;
      const codingTasksTotal = Object.values(distributionByCoderId[planItem.itemKey])
        .reduce((sum, value) => sum + value, 0);

      doubleCodingInfo[planItem.itemKey].distinctCases = itemCases.length;
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
    const context = await this.createDistributionVariableUsageContext(workspaceId, [request]);
    return this.calculateDistributionVariableUsageFromContext(workspaceId, request, context);
  }

  async calculateDistributionVariableUsageBatch(
    workspaceId: number,
    requests: DistributionVariableUsageBatchRequest[]
  ): Promise<Map<string | number, Map<string, number>>> {
    const usageByRequestKey = new Map<string | number, Map<string, number>>();

    if (requests.length === 0) {
      return usageByRequestKey;
    }

    const context = await this.createDistributionVariableUsageContext(workspaceId, requests);
    requests.forEach(request => {
      usageByRequestKey.set(
        request.key,
        this.calculateDistributionVariableUsageFromContext(workspaceId, request, context)
      );
    });

    return usageByRequestKey;
  }

  private async createDistributionVariableUsageContext(
    workspaceId: number,
    requests: DistributionVariableUsageRequest[]
  ): Promise<DistributionVariableUsageContext> {
    const allVariables = this.deduplicateVariableReferences(
      requests.flatMap(request => this.getVariableUsageRequestVariables(request))
    );

    if (allVariables.length === 0) {
      return {
        matchingFlags: [],
        aggregationThreshold: null,
        derivedVariableSets: new Map(),
        allResponses: [],
        assignedResponseIds: new Set()
      };
    }

    const [
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap,
      allResponses,
      assignedResponseIds
    ] = await Promise.all([
      this.getResponseMatchingMode(workspaceId),
      this.getAggregationThreshold(workspaceId),
      this.workspaceFilesService.getDerivedVariableMap(workspaceId),
      this.getSlimResponsesForVariables(workspaceId, allVariables),
      this.getAssignedResponseIdsForVariables(workspaceId, allVariables)
    ]);

    return {
      matchingFlags,
      aggregationThreshold,
      derivedVariableSets: this.buildDerivedVariableSets(derivedVariableMap),
      allResponses,
      assignedResponseIds
    };
  }

  private calculateDistributionVariableUsageFromContext(
    workspaceId: number,
    request: DistributionVariableUsageRequest,
    context: DistributionVariableUsageContext
  ): Map<string, number> {
    const caseOrderingMode = request.caseOrderingMode || 'continuous';
    const distributionSeed = this.getDistributionSeed(workspaceId, request);
    const items = this.buildDistributionItems(request);
    const bundleNameCounts = this.getBundleNameCounts(items);

    if (items.length === 0) {
      return new Map();
    }

    const isDerivedVariable = (unitName: string, variableId: string): boolean => this.isDerivedVariable(
      context.derivedVariableSets,
      unitName,
      variableId
    );
    const planItems: DistributionPlanItem[] = [];

    for (const itemObj of items) {
      const {
        itemVariables,
        itemKey,
        itemLabel,
        itemCaseOrderingMode
      } = this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts);

      if (!isSafeKey(itemKey)) {
        continue;
      }

      const allItemResponses = context.allResponses.filter(response => itemVariables.some(v => (
        v.unitName === response.unitName &&
        v.variableId === response.variableid
      )));
      const { filteredResponses, uniqueCases, totalResponses } = this.getDistributableResponses(
        allItemResponses,
        context.assignedResponseIds,
        context.matchingFlags,
        context.aggregationThreshold,
        response => isDerivedVariable(response.unitName, response.variableid)
      );
      const availableResponses = this.sortResponsesForDistribution(
        filteredResponses,
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
        uniqueCases,
        totalResponses,
        availableResponses,
        selectedResponses: []
      });
    }

    const selectedCases = this.selectCasesWithGlobalCap(planItems, request.maxCodingCases);
    const usageByVariable = new Map<string, number>();

    selectedCases.forEach(({ response }) => {
      const variableKey = `${response.unitName}::${response.variableid}`;
      usageByVariable.set(variableKey, (usageByVariable.get(variableKey) || 0) + 1);
    });

    return usageByVariable;
  }

  async calculateDistribution(
    workspaceId: number,
    request: {
      selectedVariables: { unitName: string; variableId: string }[];
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
      aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
      matchingFlags: ResponseMatchingFlag[];
      warnings: JobCreationWarning[];
      pairDistribution: Record<string, number>;
      tasksPerCoder: Record<string, number>;
      coderWeights: Record<string, number>;
    }> {
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
    request: DistributionPlanRequest
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
      await this.assertApprovedJobDefinitionCanBeUsed(
        manager,
        workspaceId,
        jobDefinitionId
      );
      await this.lockCodingJobUnitsForDefinition(manager, workspaceId, jobDefinitionId);

      const [
        existingRows,
        jobsRow,
        hasCodingWork
      ] = await Promise.all([
        this.getJobDefinitionExistingTaskRows(workspaceId, jobDefinitionId, manager),
        this.getJobDefinitionJobCounts(workspaceId, jobDefinitionId, manager),
        this.jobDefinitionHasAnyCodingWork(workspaceId, jobDefinitionId, manager)
      ]);

      const transactionPlan = await this.buildDistributionPlan(workspaceId, request, manager);
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

      createdJobs.push(...await this.createDistributedCodingJobsFromPlanInManager(
        workspaceId,
        request,
        transactionPlan,
        manager
      ));
    });

    await this.invalidateIncompleteVariablesCache(workspaceId);
    if (!plan || !preview) {
      throw new BadRequestException('Job definition refresh could not be planned.');
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
      const jobName = job.item.type === 'bundle' ?
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
        ...(job.item.type === 'bundle' ?
          { variableBundleIds: [(job.item.item as BundleItem).id] } :
          { variables: job.item.itemVariables }
        )
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
        variable: job.item.type === 'bundle' ?
          { unitName: job.item.itemLabel, variableId: '' } :
          { unitName: (job.item.item as VariableReference).unitName, variableId: (job.item.item as VariableReference).variableId },
        jobId: codingJob.id,
        jobName,
        caseCount: job.unitSubset.length
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
    request: DistributionPlanRequest
  ): Promise<DistributedCodingJobsResult> {
    this.logger.log(`Creating distributed coding jobs for workspace ${workspaceId}`);

    const createdJobs: DistributionCreatedJob[] = [];

    try {
      const plan = await this.buildDistributionPlan(workspaceId, request);

      if (plan.jobsToCreate.length > 0 || request.jobDefinitionId !== undefined) {
        await this.connection.transaction(async manager => {
          await this.assertApprovedJobDefinitionHasNoCreatedJobs(
            manager,
            workspaceId,
            request.jobDefinitionId
          );

          createdJobs.push(...await this.createDistributedCodingJobsFromPlanInManager(
            workspaceId,
            request,
            plan,
            manager
          ));
        });
      }

      this.logger.log(`Successfully created ${createdJobs.length} distributed coding jobs`);

      return this.buildDistributedCodingJobsResult(plan, createdJobs);
    } catch (error) {
      this.logger.error(`Error creating distributed coding jobs: ${error.message}`, error.stack);
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
      select: ['id', 'workspace_id']
    });
    if (!codingJob) {
      return false;
    }

    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select(['cju.code', 'cju.coding_issue_option'])
      .where('cju.coding_job_id = :codingJobId', { codingJobId });
    await this.applyCodingJobUnitExclusions(query, codingJob.workspace_id, 'codingIssues');
    const codingJobUnits = await query.getMany();

    return codingJobUnits.some(unit => unit.coding_issue_option === -1 ||
      unit.coding_issue_option === -2 ||
      unit.code === -1 ||
      unit.code === -2
    );
  }

  private async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const query = this.codingJobUnitRepository.createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id');
    await this.applyCodingJobUnitExclusions(query, workspaceId, 'codingJobVariableCasesInJobs');
    const rawResults = await query.getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }

  async getBulkCodingProgress(codingJobIds: number[], workspaceId: number): Promise<Record<number, Record<string, SaveCodingProgressDto['selectedCode']>>> {
    if (codingJobIds.length === 0) {
      return {};
    }

    const codingJobs = await this.codingJobRepository.find({
      where: { id: In(codingJobIds), workspace_id: workspaceId },
      select: ['id', 'workspace_id']
    });

    if (codingJobs.length !== codingJobIds.length) {
      throw new NotFoundException('One or more coding jobs not found in the workspace');
    }

    const progressMap: Record<number, Record<string, SaveCodingProgressDto['selectedCode']>> = {};

    await Promise.all(codingJobs.map(async job => {
      progressMap[job.id] = await this.getCodingProgress(job.id);
    }));

    return progressMap;
  }

  /**
   * Get the duplicate aggregation threshold for a workspace
   * Returns 2 as default (aggregation enabled by default)
   */
  async getAggregationThreshold(workspaceId: number, manager?: EntityManager): Promise<number | null> {
    const settingKey = `workspace-${workspaceId}-duplicate-aggregation-threshold`;
    const repository = manager ? manager.getRepository(Setting) : this.settingRepository;
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

    this.logger.log(`Set aggregation threshold for workspace ${workspaceId}: ${threshold}`);
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

      const normalizedValue = this.normalizeValue(response.value, matchingFlags);
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
