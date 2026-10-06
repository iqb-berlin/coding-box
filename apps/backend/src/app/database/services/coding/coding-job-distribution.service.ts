import {
  BadRequestException, Injectable, Logger, Inject, NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, EntityManager } from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { DERIVED_VARIABLE_READER, DerivedVariableReader } from '../workspace/derived-variable-reader.token';
import { getAggregationVariableKey } from './aggregation-metrics.util';
import { JobDefinitionRefreshCoderTaskDeltaDto, JobDefinitionRefreshItemDeltaDto, JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import { DERIVE_ERROR_STATUS } from '../../utils/manual-coding-candidate.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { CodingJobDistributionPlanner, DistributionCoderLoad } from './coding-job-distribution-planner';
import {
  isSafeKey, ResponseMatchingFlag, JobCreationWarning, VariableReference, BundleItem, DistributionItem, DistributionCoderInput, NormalizedDistributionCoder, DistributionDoubleCodingInfo, DistributionPlanRequest, DistributionVariableUsageRequest, DistributionVariableUsageBatchRequest, DistributionVariableUsageByStatus, DistributionVariableUsageCaseStatus, DistributionVariableUsageContext, DistributionPlanItem, DistributionPlanCaseGroup, DistributionPlanCase, DistributionPlanJob, DistributionPlan, JobDefinitionExistingTaskRow, DistributionCreatedJob, DistributedCodingJobsResult, DistributedCodingJobsTransactionHook, RefreshDistributedCodingJobsTransactionHook, JobDefinitionRefreshCodingJobsResult, DEFAULT_DISTRIBUTION_CODER_WEIGHT, MIN_DISTRIBUTION_CODER_CAPACITY_PERCENT, MAX_DISTRIBUTION_CODER_CAPACITY_PERCENT, SlimResponse, DistributableResponses, InternalCreateCodingJobDto
} from './coding-job.types';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobAggregationService } from './coding-job-aggregation.service';
import { CodingJobResponsesService } from './coding-job-responses.service';
import { CodingJobMutationService } from './coding-job-mutation.service';

@Injectable()
export class CodingJobDistributionService {
  private readonly logger = new Logger(CodingJobDistributionService.name);
  private readonly distributionPlanner = new CodingJobDistributionPlanner();
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    private readonly connection: Connection,
    @Inject(DERIVED_VARIABLE_READER) private readonly derivedVariableReader: DerivedVariableReader,
    private readonly access: CodingJobAccessService,
    private readonly query: CodingJobQueryService,
    private readonly aggregation: CodingJobAggregationService,
    private readonly responses: CodingJobResponsesService,
    private readonly mutation: CodingJobMutationService
  ) {}

  async previewJobDefinitionRefresh(
    workspaceId: number,
    request: DistributionPlanRequest
  ): Promise<JobDefinitionRefreshPreviewDto> {
    const jobDefinitionId = Number(request.jobDefinitionId);
    if (!Number.isInteger(jobDefinitionId) || jobDefinitionId < 1) {
      throw new BadRequestException('A valid job definition id is required.');
    }

    await this.access.assertDeriveErrorManualCodingEnabled(workspaceId, request);

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

  buildJobDefinitionRefreshPreview(
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

  createEmptyRefreshCoderTaskDelta(
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

  incrementRefreshCoderTaskDelta(
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

  getRefreshTaskKey(
    itemKey: string,
    coderId: number,
    responseId: number
  ): string {
    return `${itemKey}\u0000${coderId}\u0000${responseId}`;
  }

  buildExistingTaskCountByItemCoderAndResponse(
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

  buildPlannedTaskCountByItemCoderAndResponse(
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

  buildJobDefinitionRefreshCoderDeltas(
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

  buildJobDefinitionRefreshItemDeltas(
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

  async getJobDefinitionExistingTaskRows(
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
    this.query.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'jobDefinitionExistingTasksReviewJobType'
    );

    await this.query.applyCodingJobUnitExclusions(
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

  async getJobDefinitionJobCounts(
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
    this.query.applyNonCodingIssueReviewJobFilter(
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

  async jobDefinitionHasCodingWork(
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
    this.query.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'jobDefinitionCodingWorkReviewJobType'
    );

    if (applyExclusions) {
      await this.query.applyCodingJobUnitExclusions(
        query,
        workspaceId,
        'jobDefinitionCodingWork'
      );
    }
    return (await query.getCount()) > 0;
  }

  async jobDefinitionHasAnyCodingWork(
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

  async lockCodingJobUnitsForDefinition(
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
    this.query.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'lockCodingJobUnitsReviewJobType'
    );
    await query.getRawMany();
  }

  async assertApprovedJobDefinitionHasNoCreatedJobs(
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

  async assertApprovedJobDefinitionCanBeUsed(
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

  getDistributableResponses(
    allItemResponses: SlimResponse[],
    assignedResponseIds: Set<number>,
    matchingFlags: ResponseMatchingFlag[],
    aggregationThreshold: number | null,
    isDerivedResponse: (response: SlimResponse) => boolean
  ): DistributableResponses {
    const {
      responses,
      assignedResponseIds: effectiveAssignedResponseIds
    } = this.aggregation.deduplicateSlimResponsesForManualCoding(
      allItemResponses,
      assignedResponseIds
    );
    const filteredResponses: SlimResponse[] = [];
    const caseStatusesByResponseId = new Map<number, DistributionVariableUsageCaseStatus>();
    let uniqueCases = 0;
    let totalResponses = 0;

    if (aggregationThreshold !== null) {
      const aggregatedGroups = this.aggregation.aggregateResponsesByVariableAndValue(
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

  addCompletedResponsesToAssignedSets(
    responses: SlimResponse[],
    assignedResponseIdSets: Set<number>[]
  ): void {
    const completedStatus = statusStringToNumber('CODING_COMPLETE');
    responses
      .filter(response => response.statusV2 === completedStatus)
      .forEach(response => {
        assignedResponseIdSets.forEach(assignedResponseIds => {
          assignedResponseIds.add(response.id);
        });
      });
  }

  getAggregatedCaseUsageStatus(
    responses: SlimResponse[]
  ): DistributionVariableUsageCaseStatus {
    return responses.some(response => response.statusV1 !== DERIVE_ERROR_STATUS) ?
      'regular' :
      'deriveError';
  }

  getResponseUsageStatus(
    response: SlimResponse
  ): DistributionVariableUsageCaseStatus {
    return response.statusV1 === DERIVE_ERROR_STATUS ? 'deriveError' : 'regular';
  }

  buildAvailabilityWarning(
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

  getDistributionSeed(
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

  compareResponsesByMode(
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

  getResponseStratumKey(
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

  getResponseAllocationCaseKey(
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

  getCaseGroupStratumKey(
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

  sortCaseGroupsForDistribution(
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

  buildDistributionCaseGroups(
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

  countDistributionCasesInResponses(
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

  normalizeDistributionCoders(
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

  buildDistributionItems(
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

  getBundleNameCounts(items: DistributionItem[]): Map<string, number> {
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

  getBundleDistributionKey(bundle: Pick<BundleItem, 'id'>): string {
    return `bundle:${bundle.id}`;
  }

  getItemDetails(
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

  getVariableUsageRequestVariables(
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

  deduplicateVariableReferences(
    variables: VariableReference[]
  ): VariableReference[] {
    const uniqueVariables = new Map<string, VariableReference>();

    variables.forEach(variable => {
      const key = getAggregationVariableKey(
        variable.unitName,
        variable.variableId
      );
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

  buildDerivedVariableSets(
    derivedVariableMap: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const derivedVariableSets = new Map<string, Set<string>>();
    derivedVariableMap.forEach((vars, unitNameKey) => {
      derivedVariableSets.set(unitNameKey.toUpperCase(), vars);
    });

    return derivedVariableSets;
  }

  isDerivedVariable(
    derivedVariableSets: Map<string, Set<string>>,
    unitName: string,
    variableId: string
  ): boolean {
    return (
      derivedVariableSets.get(unitName.toUpperCase())?.has(variableId) ?? false
    );
  }

  selectCasesWithGlobalCap(
    planItems: DistributionPlanItem[],
    maxCodingCases?: number | null
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

  getDoubleCodingCount(
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

  getDoubleCodingSettings(
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

  getResponseVariableKey(response: SlimResponse): string {
    return `${response.unitName}::${response.variableid}`;
  }

  buildEmptyDoubleCodingInfo(
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

  async buildDistributionPlan(
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
    await this.access.assertCodersCanCodeInWorkspace(
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

    const matchingFlags = await this.aggregation.getResponseMatchingMode(
      workspaceId,
      manager
    );
    const aggregationThreshold = await this.aggregation.getAggregationThreshold(
      workspaceId,
      manager
    );
    const derivedVariableMap =
      await this.derivedVariableReader.getDerivedVariableMap(workspaceId);
    const derivedVariableSets =
      this.buildDerivedVariableSets(derivedVariableMap);
    const isDerivedVariable = (unitName: string, variableId: string): boolean => this.isDerivedVariable(derivedVariableSets, unitName, variableId);

    const allVariables = this.deduplicateVariableReferences(
      items.flatMap(
        itemObj => this.getItemDetails(itemObj, caseOrderingMode, bundleNameCounts)
          .itemVariables
      )
    );
    const allResponses = await this.responses.getSlimResponsesForVariableCoverage(
      workspaceId,
      allVariables,
      matchingFlags,
      aggregationThreshold,
      derivedVariableMap,
      manager
    );
    const assignedResponseIds = await this.responses.getAssignedResponseIdsForVariables(
      workspaceId,
      allVariables,
      request.jobDefinitionId,
      manager
    );
    this.addCompletedResponsesToAssignedSets(allResponses, [
      assignedResponseIds
    ]);
    const warnings: JobCreationWarning[] = [];
    const warnedVariables = new Set<string>();

    for (const variable of allVariables) {
      const variableKey = `${variable.unitName}::${variable.variableId}`;
      if (warnedVariables.has(variableKey)) {
        continue;
      }

      warnedVariables.add(variableKey);
      const variableResponses = allResponses.filter(r => this.responses.responseMatchesVariableReference(r, variable)
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

      const allItemResponses = allResponses.filter(response => itemVariables.some(variable => this.responses.responseMatchesVariableReference(response, variable)
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

  async createDistributionVariableUsageContext(
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
      derivedVariableMap
    ] = await Promise.all([
      this.aggregation.getResponseMatchingMode(workspaceId),
      this.aggregation.getAggregationThreshold(workspaceId),
      this.derivedVariableReader.getDerivedVariableMap(workspaceId)
    ]);
    const [
      allResponses,
      assignedResponseIds,
      assignedResponseIdsByExcludedJobDefinitionIdEntries
    ] = await Promise.all([
      this.responses.getSlimResponsesForVariableCoverage(
        workspaceId,
        allVariables,
        matchingFlags,
        aggregationThreshold,
        derivedVariableMap
      ),
      this.responses.getAssignedResponseIdsForVariables(workspaceId, allVariables),
      Promise.all(
        excludedJobDefinitionIds.map(async jobDefinitionId => [
          jobDefinitionId,
          await this.responses.getAssignedResponseIdsForVariables(
            workspaceId,
            allVariables,
            jobDefinitionId
          )
        ] as const)
      )
    ]);
    this.addCompletedResponsesToAssignedSets(allResponses, [
      assignedResponseIds,
      ...assignedResponseIdsByExcludedJobDefinitionIdEntries.map(([, ids]) => ids)
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

  calculateDistributionVariableUsageByStatusFromContext(
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

      const allItemResponses = context.allResponses.filter(response => itemVariables.some(variable => this.responses.responseMatchesVariableReference(response, variable)
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
        const selectedVariable = item.itemVariables.find(variable => (
          this.responses.responseMatchesVariableReference(response, variable)
        ));
        this.addResponseToVariableUsageByStatus(
          usageByVariable,
          response,
          item.caseStatusesByResponseId.get(response.id) ||
            this.getResponseUsageStatus(response),
          selectedVariable
        );
      });
    });

    return usageByVariable;
  }

  addResponseToVariableUsageByStatus(
    usageByVariable: Map<string, DistributionVariableUsageByStatus>,
    response: SlimResponse,
    caseStatus: DistributionVariableUsageCaseStatus,
    selectedVariable?: VariableReference
  ): void {
    const variableKey = selectedVariable ?
      `${selectedVariable.unitName}::${selectedVariable.variableId}` :
      `${response.unitName}::${response.variableid}`;
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

  getTotalVariableUsageByVariable(
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
      maxCodingCases?: number | null;
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
    await this.access.assertDeriveErrorManualCodingEnabled(workspaceId, request);
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
      await this.access.assertDeriveErrorManualCodingEnabled(
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
        await this.mutation.deleteCodingJobsByDefinitionInManager(
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

    await this.mutation.invalidateIncompleteVariablesCache(workspaceId);
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

  async createDistributedCodingJobsFromPlanInManager(
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
      const codingJob = await this.mutation.createCodingJobWithUnitSubsetInManager(
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

  buildDistributedCodingJobsResult(
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
      await this.access.assertDeriveErrorManualCodingEnabled(workspaceId, request);
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
      await this.mutation.invalidateIncompleteVariablesCache(workspaceId);

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
}
