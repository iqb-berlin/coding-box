import { randomUUID } from 'crypto';
import {
  Injectable, NotFoundException, BadRequestException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  JobDefinition,
  JobDefinitionCoderConfig,
  JobDefinitionVariable,
  JobDefinitionVariableBundle,
  CaseOrderingMode
} from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import User from '../../entities/user.entity';
import { CodingJobService } from '../coding/coding-job.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { CreateJobDefinitionDto } from '../../../admin/coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../../../admin/coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../../../admin/coding-job/dto/approve-job-definition.dto';
import {
  JobDefinitionRefreshApplyResultDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../../api-dto/coding/job-refresh.dto';

type JobDefinitionBundleForUsage = JobDefinitionVariableBundle & {
  variables?: JobDefinitionVariable[];
};

type HydratedJobDefinitionVariableBundle = JobDefinitionVariableBundle & {
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  variables?: JobDefinitionVariable[];
};

type CoderAssignmentInput = {
  assignedCoders?: number[];
  assignedCoderConfigs?: JobDefinitionCoderConfig[];
};

type ResolvedCoderAssignments = {
  assignedCoders: number[];
  assignedCoderConfigs: JobDefinitionCoderConfig[];
};

interface JobDefinitionForUsage {
  id?: number;
  assigned_variables?: JobDefinitionVariable[];
  assigned_variable_bundles?: JobDefinitionBundleForUsage[];
  max_coding_cases?: number;
  case_ordering_mode?: CaseOrderingMode;
  distribution_seed?: string;
}

export type JobDefinitionWithCreatedJobsCount = JobDefinition & {
  createdJobsCount: number;
  created_jobs_count: number;
  blockingCreatedJobsCount: number;
  blocking_created_jobs_count: number;
  openCreatedJobsCount: number;
  open_created_jobs_count: number;
  plannedVariableUsage: Record<string, number>;
  planned_variable_usage: Record<string, number>;
};

interface JobDefinitionValidationState {
  status?: JobDefinition['status'];
  assignedVariables?: JobDefinitionVariable[];
  assignedVariableBundles?: JobDefinitionVariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: CaseOrderingMode;
}

interface VariableConflictCheckRequest {
  jobDefinitionId?: number;
  assignedVariables: JobDefinitionVariable[];
  assignedVariableBundles: JobDefinitionVariableBundle[];
  maxCodingCases?: number;
  caseOrderingMode?: CaseOrderingMode;
  distributionSeed?: string;
  excludeJobDefinitionId?: number;
  requireAssignedBundles?: boolean;
}

type PlannedVariableUsageBatchRequest = {
  key: string | number;
  selectedVariables: JobDefinitionVariable[];
  selectedVariableBundles: {
    id: number;
    name: string;
    caseOrderingMode?: CaseOrderingMode;
    variables: JobDefinitionVariable[];
  }[];
  maxCodingCases?: number;
  caseOrderingMode?: CaseOrderingMode;
  jobDefinitionId?: number;
  distributionSeed?: string;
};

type DefinitionDistributionRequest = {
  selectedVariables: JobDefinitionVariable[];
  selectedVariableBundles: {
    id: number;
    name: string;
    caseOrderingMode?: CaseOrderingMode;
    variables: JobDefinitionVariable[];
  }[];
  selectedCoders: {
    id: number;
    name: string;
    username: string;
    capacityPercent: number;
  }[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: CaseOrderingMode;
  maxCodingCases?: number;
  jobDefinitionId: number;
  distributionSeed: string;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
};

const DEFAULT_CODER_CAPACITY_PERCENT = 100;
const MIN_CODER_CAPACITY_PERCENT = 10;
const MAX_CODER_CAPACITY_PERCENT = 300;

@Injectable()
export class JobDefinitionService {
  constructor(
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private codingJobService: CodingJobService,
    private codingValidationService: CodingValidationService
  ) { }

  private async checkVariableConflicts(
    workspaceId: number,
    request: VariableConflictCheckRequest
  ): Promise<string[]> {
    const hydratedAssignedBundles = await this.hydrateVariableBundles(
      request.assignedVariableBundles,
      request.requireAssignedBundles
    );
    const incompleteVariables = await this.codingValidationService.getCodingIncompleteVariables(workspaceId);
    const availableCasesByVariable = new Map(
      incompleteVariables.map(variable => [
        this.makeVariableKey(variable.unitName, variable.variableId),
        variable.availableCases
      ])
    );

    const existingDefinitions = await this.jobDefinitionRepository.find({
      where: { workspace_id: workspaceId }
    });
    const existingDefinitionIds = existingDefinitions
      .map(definition => definition.id)
      .filter((definitionId): definitionId is number => definitionId !== undefined);
    const createdJobsCountByDefinitionId = await this.codingJobService.getCodingJobCountsByDefinitionIds(
      workspaceId,
      existingDefinitionIds
    );

    const reservedCases = new Map<string, number>();
    const requestedUsageKey = 'requested';
    const requestedUsageRequest = this.buildPlannedVariableUsageBatchRequest(
      requestedUsageKey,
      {
        id: request.jobDefinitionId,
        assigned_variables: request.assignedVariables || [],
        assigned_variable_bundles: hydratedAssignedBundles,
        max_coding_cases: request.maxCodingCases,
        case_ordering_mode: request.caseOrderingMode,
        distribution_seed: request.distributionSeed
      }
    );
    const existingUsageRequests = (await Promise.all(
      existingDefinitions.map(async definition => {
        if (definition.id === request.excludeJobDefinitionId) {
          return undefined;
        }
        if ((createdJobsCountByDefinitionId.get(definition.id) || 0) > 0) {
          return undefined;
        }

        const hydratedBundles = await this.hydrateVariableBundles(definition.assigned_variable_bundles || []);
        return this.buildPlannedVariableUsageBatchRequest(definition.id, {
          id: definition.id,
          assigned_variables: definition.assigned_variables || [],
          assigned_variable_bundles: hydratedBundles,
          max_coding_cases: definition.max_coding_cases,
          case_ordering_mode: definition.case_ordering_mode,
          distribution_seed: this.getDefinitionDistributionSeed(definition)
        });
      })
    )).filter((usageRequest): usageRequest is PlannedVariableUsageBatchRequest => usageRequest !== undefined);
    const usageByRequestKey = await this.codingJobService.calculateDistributionVariableUsageBatch(
      workspaceId,
      [requestedUsageRequest, ...existingUsageRequests]
    );
    const requestedUsage = usageByRequestKey.get(requestedUsageKey) || new Map<string, number>();

    existingUsageRequests.forEach(usageRequest => {
      const usage = usageByRequestKey.get(usageRequest.key) || new Map<string, number>();
      usage.forEach((usageCount, variableKey) => {
        reservedCases.set(variableKey, (reservedCases.get(variableKey) || 0) + usageCount);
      });
    });

    const unavailableVariables: string[] = [];

    requestedUsage.forEach((requestedCases, variableKey) => {
      const availableCases = availableCasesByVariable.get(variableKey);
      const remainingCases = (availableCases ?? 0) - (reservedCases.get(variableKey) || 0);

      if (availableCases === undefined || remainingCases <= 0 || requestedCases > remainingCases) {
        unavailableVariables.push(variableKey.replace('::', ':'));
      }
    });

    return unavailableVariables;
  }

  private makeVariableKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  private createDistributionSeed(workspaceId: number): string {
    return `job-definition:${workspaceId}:${randomUUID()}`;
  }

  private getDefinitionDistributionSeed(
    jobDefinition: Pick<JobDefinition, 'id' | 'workspace_id' | 'distribution_seed'>
  ): string {
    if (jobDefinition.distribution_seed) {
      return jobDefinition.distribution_seed;
    }

    if (jobDefinition.id !== undefined && jobDefinition.id !== null) {
      return `job-definition:${jobDefinition.id}`;
    }

    return this.createDistributionSeed(jobDefinition.workspace_id);
  }

  private buildPlannedVariableUsageBatchRequest(
    key: string | number,
    definition: JobDefinitionForUsage
  ): PlannedVariableUsageBatchRequest {
    return {
      key,
      selectedVariables: definition.assigned_variables || [],
      selectedVariableBundles: (definition.assigned_variable_bundles || []).map(bundle => ({
        id: bundle.id,
        name: bundle.name,
        caseOrderingMode: bundle.caseOrderingMode,
        variables: bundle.variables || []
      })),
      caseOrderingMode: definition.case_ordering_mode,
      maxCodingCases: definition.max_coding_cases,
      jobDefinitionId: definition.id,
      distributionSeed: definition.distribution_seed
    };
  }

  private async hydrateVariableBundles(
    assignedVariableBundles?: JobDefinitionVariableBundle[],
    requireAllBundles = false
  ): Promise<JobDefinitionBundleForUsage[]> {
    if (!assignedVariableBundles || assignedVariableBundles.length === 0) {
      return [];
    }

    const bundleIds = assignedVariableBundles.map(bundle => bundle.id);
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(bundleIds) }
    });
    const variableBundlesById = new Map(variableBundles.map(bundle => [bundle.id, bundle]));

    if (requireAllBundles) {
      const missingBundleIds = bundleIds.filter(id => !variableBundlesById.has(id));
      if (missingBundleIds.length > 0) {
        throw new BadRequestException(
          `Unknown variable bundle IDs: ${missingBundleIds.join(', ')}`
        );
      }
    }

    return assignedVariableBundles.map(bundle => ({
      ...bundle,
      variables: variableBundlesById.get(bundle.id)?.variables || []
    }));
  }

  private async hydrateAssignedVariableBundles(jobDefinition: JobDefinition): Promise<JobDefinition> {
    const assignedBundles = jobDefinition.assigned_variable_bundles;

    if (!assignedBundles || assignedBundles.length === 0) {
      return jobDefinition;
    }

    const bundleIds = assignedBundles.map(bundle => bundle.id);
    const savedBundleModes = new Map(assignedBundles.map(bundle => [bundle.id, bundle.caseOrderingMode]));
    const fullBundles = await this.variableBundleRepository.find({
      where: { id: In(bundleIds) }
    });
    const fullBundlesById = new Map(fullBundles.map(bundle => [bundle.id, bundle]));

    jobDefinition.assigned_variable_bundles = assignedBundles
      .map((savedBundle): HydratedJobDefinitionVariableBundle | undefined => {
        const fullBundle = fullBundlesById.get(savedBundle.id);

        if (!fullBundle) {
          return undefined;
        }

        return {
          id: fullBundle.id,
          name: fullBundle.name,
          description: fullBundle.description,
          createdAt: fullBundle.created_at,
          updatedAt: fullBundle.updated_at,
          variables: fullBundle.variables,
          caseOrderingMode: savedBundleModes.get(fullBundle.id)
        };
      })
      .filter((bundle): bundle is JobDefinitionVariableBundle => bundle !== undefined);

    return jobDefinition;
  }

  private validateDefinitionState(definition: JobDefinitionValidationState): void {
    const assignedVariables = definition.assignedVariables || [];
    const assignedVariableBundles = definition.assignedVariableBundles || [];
    const assignedCoders = definition.assignedCoders || [];

    if (assignedVariables.length === 0 && assignedVariableBundles.length === 0) {
      throw new BadRequestException('At least one variable or variable bundle must be assigned.');
    }

    if (assignedCoders.length === 0) {
      throw new BadRequestException('At least one coder must be assigned.');
    }

    this.validatePositiveNumber(definition.durationSeconds, 'durationSeconds', 1);
    this.validatePositiveNumber(definition.maxCodingCases, 'maxCodingCases', 1);
    this.validatePositiveNumber(definition.doubleCodingAbsolute, 'doubleCodingAbsolute', 0);
    this.validatePositiveNumber(definition.doubleCodingPercentage, 'doubleCodingPercentage', 0, 100);

    if (
      (definition.doubleCodingAbsolute || 0) > 0 &&
      (definition.doubleCodingPercentage || 0) > 0
    ) {
      throw new BadRequestException(
        'Use either doubleCodingAbsolute or doubleCodingPercentage, not both.'
      );
    }

    if (
      ((definition.doubleCodingAbsolute || 0) > 0 ||
        Number(definition.doubleCodingPercentage || 0) > 0) &&
      assignedCoders.length < 2
    ) {
      throw new BadRequestException(
        'Double coding requires at least two assigned coders.'
      );
    }

    if (
      definition.caseOrderingMode !== undefined &&
      !['continuous', 'alternating'].includes(definition.caseOrderingMode)
    ) {
      throw new BadRequestException('caseOrderingMode must be either continuous or alternating.');
    }

    assignedVariableBundles.forEach(bundle => {
      if (
        bundle.caseOrderingMode !== undefined &&
        !['continuous', 'alternating'].includes(bundle.caseOrderingMode)
      ) {
        throw new BadRequestException(
          `Invalid case ordering mode for variable bundle ${bundle.id}.`
        );
      }
    });
  }

  private validatePositiveNumber(
    value: unknown,
    fieldName: string,
    min: number,
    max?: number
  ): void {
    if (value === undefined || value === null) {
      return;
    }

    const numberValue = Number(value);

    if (Number.isNaN(numberValue)) {
      throw new BadRequestException(`${fieldName} must be a number.`);
    }

    if (numberValue < min) {
      throw new BadRequestException(`${fieldName} must be greater than or equal to ${min}.`);
    }

    if (max !== undefined && numberValue > max) {
      throw new BadRequestException(`${fieldName} must be less than or equal to ${max}.`);
    }
  }

  private toOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? undefined : numberValue;
  }

  private normalizeCoderConfigs(
    configs: JobDefinitionCoderConfig[] = []
  ): ResolvedCoderAssignments {
    const assignedCoders: number[] = [];
    const assignedCoderConfigs: JobDefinitionCoderConfig[] = [];
    const seenCoderIds = new Set<number>();

    configs.forEach(config => {
      const coderId = Number(config.coderId);
      const capacityPercent = Number(config.capacityPercent);

      if (!Number.isInteger(coderId) || coderId < 1) {
        throw new BadRequestException('assignedCoderConfigs.coderId must be a positive integer.');
      }

      if (seenCoderIds.has(coderId)) {
        throw new BadRequestException(`Duplicate coder ID in assignedCoderConfigs: ${coderId}`);
      }

      if (
        !Number.isFinite(capacityPercent) ||
        capacityPercent < MIN_CODER_CAPACITY_PERCENT ||
        capacityPercent > MAX_CODER_CAPACITY_PERCENT
      ) {
        throw new BadRequestException(
          `assignedCoderConfigs.capacityPercent must be between ${MIN_CODER_CAPACITY_PERCENT} and ${MAX_CODER_CAPACITY_PERCENT}.`
        );
      }

      seenCoderIds.add(coderId);
      assignedCoders.push(coderId);
      assignedCoderConfigs.push({
        coderId,
        capacityPercent
      });
    });

    return {
      assignedCoders,
      assignedCoderConfigs
    };
  }

  private buildCoderAssignmentsFromIds(
    coderIds: number[] = [],
    existingConfigs: JobDefinitionCoderConfig[] = []
  ): ResolvedCoderAssignments {
    const existingCapacityByCoderId = new Map(
      this.normalizeCoderConfigs(existingConfigs).assignedCoderConfigs
        .map(config => [config.coderId, config.capacityPercent])
    );

    return this.normalizeCoderConfigs(
      coderIds.map(coderId => ({
        coderId: Number(coderId),
        capacityPercent: existingCapacityByCoderId.get(Number(coderId)) ??
          DEFAULT_CODER_CAPACITY_PERCENT
      }))
    );
  }

  private getStoredCoderAssignments(jobDefinition: JobDefinition): ResolvedCoderAssignments {
    if (jobDefinition.assigned_coder_configs !== undefined && jobDefinition.assigned_coder_configs !== null) {
      return this.normalizeCoderConfigs(jobDefinition.assigned_coder_configs || []);
    }

    return this.buildCoderAssignmentsFromIds(jobDefinition.assigned_coders || []);
  }

  private resolveCoderAssignments(
    input: CoderAssignmentInput,
    existingAssignments?: ResolvedCoderAssignments
  ): ResolvedCoderAssignments {
    if (input.assignedCoderConfigs !== undefined) {
      return this.normalizeCoderConfigs(input.assignedCoderConfigs || []);
    }

    if (input.assignedCoders !== undefined) {
      return this.buildCoderAssignmentsFromIds(
        input.assignedCoders || [],
        existingAssignments?.assignedCoderConfigs || []
      );
    }

    if (existingAssignments) {
      return existingAssignments;
    }

    return this.buildCoderAssignmentsFromIds([]);
  }

  private validateStatusTransition(
    currentStatus: JobDefinition['status'],
    nextStatus?: JobDefinition['status']
  ): void {
    if (!nextStatus || currentStatus === nextStatus) {
      return;
    }

    const allowedTransitions = new Set([
      'draft->pending_review',
      'draft->approved',
      'pending_review->draft',
      'pending_review->approved',
      'approved->draft'
    ]);

    const transition = `${currentStatus}->${nextStatus}`;

    if (!allowedTransitions.has(transition)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${nextStatus}`
      );
    }
  }

  private mapVariableUsageToRecord(usage: Map<string, number>): Record<string, number> {
    return Object.fromEntries(usage.entries());
  }

  async createJobDefinition(createDto: CreateJobDefinitionDto, workspaceId: number): Promise<JobDefinition> {
    const coderAssignments = this.resolveCoderAssignments(createDto);
    const distributionSeed = this.createDistributionSeed(workspaceId);

    this.validateDefinitionState({
      status: createDto.status ?? 'draft',
      assignedVariables: createDto.assignedVariables,
      assignedVariableBundles: createDto.assignedVariableBundles,
      assignedCoders: coderAssignments.assignedCoders,
      durationSeconds: createDto.durationSeconds,
      maxCodingCases: createDto.maxCodingCases,
      doubleCodingAbsolute: createDto.doubleCodingAbsolute,
      doubleCodingPercentage: createDto.doubleCodingPercentage,
      caseOrderingMode: createDto.caseOrderingMode
    });
    await this.codingJobService.assertCodersCanCodeInWorkspace(
      coderAssignments.assignedCoders,
      workspaceId
    );

    const conflicts = await this.checkVariableConflicts(
      workspaceId,
      {
        assignedVariables: createDto.assignedVariables || [],
        assignedVariableBundles: createDto.assignedVariableBundles || [],
        maxCodingCases: createDto.maxCodingCases,
        caseOrderingMode: createDto.caseOrderingMode,
        distributionSeed,
        requireAssignedBundles: true
      }
    );

    if (conflicts.length > 0) {
      throw new BadRequestException(
        `The following variables have no remaining cases for this job definition: ${conflicts.join(', ')}`
      );
    }

    const jobDefinition = this.jobDefinitionRepository.create({
      workspace_id: workspaceId,
      status: createDto.status ?? 'draft',
      assigned_variables: createDto.assignedVariables,
      assigned_variable_bundles: createDto.assignedVariableBundles?.map(bundle => ({
        id: bundle.id,
        name: bundle.name,
        caseOrderingMode: bundle.caseOrderingMode as CaseOrderingMode
      })),
      assigned_coders: coderAssignments.assignedCoders,
      assigned_coder_configs: coderAssignments.assignedCoderConfigs,
      distribution_seed: distributionSeed,
      duration_seconds: createDto.durationSeconds,
      max_coding_cases: createDto.maxCodingCases,
      double_coding_absolute: createDto.doubleCodingAbsolute,
      double_coding_percentage: createDto.doubleCodingPercentage,
      case_ordering_mode: createDto.caseOrderingMode,
      show_score: createDto.showScore ?? false,
      allow_comments: createDto.allowComments ?? true,
      suppress_general_instructions: createDto.suppressGeneralInstructions ?? false
    });

    return this.jobDefinitionRepository.save(jobDefinition);
  }

  async getJobDefinition(id: number): Promise<JobDefinition> {
    const jobDefinition = await this.jobDefinitionRepository.findOne({
      where: { id }
    });

    if (!jobDefinition) {
      throw new NotFoundException(`Job definition with ID ${id} not found`);
    }

    await this.hydrateAssignedVariableBundles(jobDefinition);

    return jobDefinition;
  }

  private async attachCreatedJobsCounts(
    definitions: JobDefinition[]
  ): Promise<JobDefinitionWithCreatedJobsCount[]> {
    const definitionsByWorkspaceId = new Map<number, JobDefinition[]>();

    definitions.forEach(definition => {
      if (definition.id === undefined || definition.workspace_id === undefined) {
        return;
      }

      const workspaceDefinitions = definitionsByWorkspaceId.get(definition.workspace_id) || [];
      workspaceDefinitions.push(definition);
      definitionsByWorkspaceId.set(definition.workspace_id, workspaceDefinitions);
    });

    const workspaceEntries = Array.from(definitionsByWorkspaceId.entries());

    await Promise.all(
      workspaceEntries.map(async ([definitionWorkspaceId, workspaceDefinitions]) => {
        const definitionIds = workspaceDefinitions
          .map(definition => definition.id)
          .filter((definitionId): definitionId is number => definitionId !== undefined);
        const [
          countsByDefinitionId,
          blockingCountsByDefinitionId
        ] = await Promise.all([
          this.codingJobService.getCodingJobCountsByDefinitionIds(
            definitionWorkspaceId,
            definitionIds
          ),
          this.codingJobService.getBlockingCodingJobCountsByDefinitionIds(
            definitionWorkspaceId,
            definitionIds
          )
        ]);
        const plannedUsageByDefinitionId = new Map<number, Record<string, number>>();

        const usageRequestPromises: Promise<PlannedVariableUsageBatchRequest | undefined>[] =
          workspaceDefinitions.map(async definition => {
            if (definition.id === undefined) {
              return undefined;
            }

            const createdJobsCount = countsByDefinitionId.get(definition.id) || 0;
            if (createdJobsCount > 0) {
              plannedUsageByDefinitionId.set(definition.id, {});
              return undefined;
            }

            const hydratedBundles = await this.hydrateVariableBundles(
              definition.assigned_variable_bundles || []
            );

            return {
              key: definition.id,
              selectedVariables: definition.assigned_variables || [],
              selectedVariableBundles: hydratedBundles.map(bundle => ({
                id: bundle.id,
                name: bundle.name,
                caseOrderingMode: bundle.caseOrderingMode,
                variables: bundle.variables || []
              })),
              maxCodingCases: definition.max_coding_cases,
              caseOrderingMode: definition.case_ordering_mode,
              jobDefinitionId: definition.id,
              distributionSeed: this.getDefinitionDistributionSeed(definition)
            };
          });
        const usageRequests = (await Promise.all(usageRequestPromises))
          .filter((request): request is PlannedVariableUsageBatchRequest => request !== undefined);

        if (usageRequests.length > 0) {
          const usageByDefinitionId = await this.codingJobService.calculateDistributionVariableUsageBatch(
            definitionWorkspaceId,
            usageRequests
          );

          usageRequests.forEach(request => {
            if (typeof request.key === 'number') {
              plannedUsageByDefinitionId.set(
                request.key,
                this.mapVariableUsageToRecord(usageByDefinitionId.get(request.key) || new Map())
              );
            }
          });
        }

        workspaceDefinitions.forEach(definition => {
          const createdJobsCount = definition.id === undefined ?
            0 :
            countsByDefinitionId.get(definition.id) || 0;
          const blockingCreatedJobsCount = definition.id === undefined ?
            0 :
            blockingCountsByDefinitionId.get(definition.id) || 0;
          Object.assign(definition, {
            createdJobsCount,
            created_jobs_count: createdJobsCount,
            blockingCreatedJobsCount,
            blocking_created_jobs_count: blockingCreatedJobsCount,
            openCreatedJobsCount: blockingCreatedJobsCount,
            open_created_jobs_count: blockingCreatedJobsCount,
            plannedVariableUsage: definition.id === undefined ?
              {} :
              plannedUsageByDefinitionId.get(definition.id) || {},
            planned_variable_usage: definition.id === undefined ?
              {} :
              plannedUsageByDefinitionId.get(definition.id) || {}
          });
        });
      })
    );

    definitions.forEach(definition => {
      if (!Object.prototype.hasOwnProperty.call(definition, 'createdJobsCount')) {
        Object.assign(definition, {
          createdJobsCount: 0,
          created_jobs_count: 0,
          blockingCreatedJobsCount: 0,
          blocking_created_jobs_count: 0,
          openCreatedJobsCount: 0,
          open_created_jobs_count: 0,
          plannedVariableUsage: {},
          planned_variable_usage: {}
        });
      }
    });

    return definitions as JobDefinitionWithCreatedJobsCount[];
  }

  async getJobDefinitions(workspaceId?: number): Promise<JobDefinitionWithCreatedJobsCount[]> {
    const whereClause = workspaceId ? {
      workspace_id: workspaceId
    } : {};

    const definitions = await this.jobDefinitionRepository.find({
      where: whereClause,
      order: { created_at: 'DESC' }
    });

    for (const definition of definitions) {
      await this.hydrateAssignedVariableBundles(definition);
    }

    return this.attachCreatedJobsCounts(definitions);
  }

  private async assertJobDefinitionHasNoCreatedJobs(jobDefinition: JobDefinition): Promise<void> {
    const countsByDefinitionId = await this.codingJobService.getCodingJobCountsByDefinitionIds(
      jobDefinition.workspace_id,
      [jobDefinition.id]
    );
    const createdJobsCount = countsByDefinitionId.get(jobDefinition.id) || 0;

    if (createdJobsCount > 0) {
      throw new BadRequestException(
        `Cannot modify job definition ${jobDefinition.id} because ${createdJobsCount} coding jobs already exist`
      );
    }
  }

  private async assertJobDefinitionHasNoBlockingCreatedJobs(jobDefinition: JobDefinition): Promise<void> {
    const countsByDefinitionId = await this.codingJobService.getBlockingCodingJobCountsByDefinitionIds(
      jobDefinition.workspace_id,
      [jobDefinition.id]
    );
    const blockingCreatedJobsCount = countsByDefinitionId.get(jobDefinition.id) || 0;

    if (blockingCreatedJobsCount > 0) {
      throw new BadRequestException(
        `Cannot delete job definition ${jobDefinition.id} because ${blockingCreatedJobsCount} coding jobs still block deletion`
      );
    }
  }

  async updateJobDefinition(id: number, updateDto: UpdateJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);
    await this.assertJobDefinitionHasNoCreatedJobs(jobDefinition);
    const existingCoderAssignments = this.getStoredCoderAssignments(jobDefinition);
    const nextCoderAssignments = this.resolveCoderAssignments(updateDto, existingCoderAssignments);
    const distributionSeed = this.getDefinitionDistributionSeed(jobDefinition);
    const nextState: JobDefinitionValidationState = {
      status: updateDto.status ?? jobDefinition.status,
      assignedVariables: updateDto.assignedVariables ?? jobDefinition.assigned_variables ?? [],
      assignedVariableBundles: updateDto.assignedVariableBundles ?? jobDefinition.assigned_variable_bundles ?? [],
      assignedCoders: nextCoderAssignments.assignedCoders,
      durationSeconds: updateDto.durationSeconds ?? jobDefinition.duration_seconds,
      maxCodingCases: updateDto.maxCodingCases ?? jobDefinition.max_coding_cases,
      doubleCodingAbsolute: updateDto.doubleCodingAbsolute ?? jobDefinition.double_coding_absolute,
      doubleCodingPercentage: updateDto.doubleCodingPercentage ??
        this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: updateDto.caseOrderingMode ?? jobDefinition.case_ordering_mode
    };

    this.validateStatusTransition(jobDefinition.status, updateDto.status);
    this.validateDefinitionState(nextState);
    const coderAssignmentsChanged = updateDto.assignedCoders !== undefined ||
      updateDto.assignedCoderConfigs !== undefined;
    const approvesDefinition = updateDto.status === 'approved' && jobDefinition.status !== 'approved';
    if (coderAssignmentsChanged || approvesDefinition) {
      await this.codingJobService.assertCodersCanCodeInWorkspace(
        nextCoderAssignments.assignedCoders,
        jobDefinition.workspace_id
      );
    }

    if (
      updateDto.assignedVariables !== undefined ||
      updateDto.assignedVariableBundles !== undefined ||
      updateDto.maxCodingCases !== undefined ||
      updateDto.caseOrderingMode !== undefined
    ) {
      const conflicts = await this.checkVariableConflicts(
        jobDefinition.workspace_id,
        {
          jobDefinitionId: id,
          assignedVariables: nextState.assignedVariables || [],
          assignedVariableBundles: nextState.assignedVariableBundles || [],
          maxCodingCases: nextState.maxCodingCases,
          caseOrderingMode: nextState.caseOrderingMode,
          distributionSeed,
          excludeJobDefinitionId: id,
          requireAssignedBundles: updateDto.assignedVariableBundles !== undefined
        }
      );

      if (conflicts.length > 0) {
        throw new BadRequestException(
          `The following variables have no remaining cases for this job definition: ${conflicts.join(', ')}`
        );
      }
    }

    if (updateDto.status === 'approved' && jobDefinition.status !== 'approved') {
      await this.validateVariableAvailability({
        ...jobDefinition,
        assigned_variables: nextState.assignedVariables,
        assigned_variable_bundles: nextState.assignedVariableBundles,
        max_coding_cases: nextState.maxCodingCases,
        case_ordering_mode: nextState.caseOrderingMode,
        distribution_seed: distributionSeed
      } as JobDefinition);
    }

    if (updateDto.status !== undefined) {
      jobDefinition.status = updateDto.status;
    }
    if (updateDto.assignedVariables !== undefined) {
      jobDefinition.assigned_variables = updateDto.assignedVariables;
    }
    if (updateDto.assignedVariableBundles !== undefined) {
      jobDefinition.assigned_variable_bundles = updateDto.assignedVariableBundles?.map(bundle => ({
        id: bundle.id,
        name: bundle.name,
        caseOrderingMode: bundle.caseOrderingMode as CaseOrderingMode
      }));
    }
    if (updateDto.assignedCoders !== undefined) {
      jobDefinition.assigned_coders = nextCoderAssignments.assignedCoders;
      jobDefinition.assigned_coder_configs = nextCoderAssignments.assignedCoderConfigs;
    }
    if (updateDto.assignedCoderConfigs !== undefined) {
      jobDefinition.assigned_coders = nextCoderAssignments.assignedCoders;
      jobDefinition.assigned_coder_configs = nextCoderAssignments.assignedCoderConfigs;
    }
    if (updateDto.durationSeconds !== undefined) {
      jobDefinition.duration_seconds = updateDto.durationSeconds;
    }
    if (updateDto.maxCodingCases !== undefined) {
      jobDefinition.max_coding_cases = updateDto.maxCodingCases;
    }
    if (updateDto.doubleCodingAbsolute !== undefined) {
      jobDefinition.double_coding_absolute = updateDto.doubleCodingAbsolute;
    }
    if (updateDto.doubleCodingPercentage !== undefined) {
      jobDefinition.double_coding_percentage = updateDto.doubleCodingPercentage;
    }
    if (updateDto.caseOrderingMode !== undefined) {
      jobDefinition.case_ordering_mode = updateDto.caseOrderingMode;
    }
    if (updateDto.showScore !== undefined) {
      jobDefinition.show_score = updateDto.showScore;
    }
    if (updateDto.allowComments !== undefined) {
      jobDefinition.allow_comments = updateDto.allowComments;
    }
    if (updateDto.suppressGeneralInstructions !== undefined) {
      jobDefinition.suppress_general_instructions = updateDto.suppressGeneralInstructions;
    }

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  async approveJobDefinition(id: number, approveDto: ApproveJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);
    const coderAssignments = this.getStoredCoderAssignments(jobDefinition);

    this.validateStatusTransition(jobDefinition.status, approveDto.status);
    this.validateDefinitionState({
      status: approveDto.status,
      assignedVariables: jobDefinition.assigned_variables || [],
      assignedVariableBundles: jobDefinition.assigned_variable_bundles || [],
      assignedCoders: coderAssignments.assignedCoders,
      durationSeconds: jobDefinition.duration_seconds,
      maxCodingCases: jobDefinition.max_coding_cases,
      doubleCodingAbsolute: jobDefinition.double_coding_absolute,
      doubleCodingPercentage: this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: jobDefinition.case_ordering_mode
    });

    if (approveDto.status === jobDefinition.status) {
      return jobDefinition;
    }

    if (approveDto.status === 'pending_review' && jobDefinition.status === 'draft') {
      jobDefinition.status = 'pending_review';
    } else if (approveDto.status === 'approved' && ['draft', 'pending_review'].includes(jobDefinition.status)) {
      await this.codingJobService.assertCodersCanCodeInWorkspace(
        coderAssignments.assignedCoders,
        jobDefinition.workspace_id
      );
      // Validate variable availability before approving
      await this.validateVariableAvailability(jobDefinition);
      jobDefinition.status = 'approved';
    } else {
      throw new BadRequestException(`Invalid status transition from ${jobDefinition.status} to ${approveDto.status}`);
    }

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  /**
   * Validate that assigned variables still have available cases
   */
  private async validateVariableAvailability(jobDefinition: JobDefinition): Promise<void> {
    const unavailableVariables = await this.checkVariableConflicts(
      jobDefinition.workspace_id,
      {
        jobDefinitionId: jobDefinition.id,
        assignedVariables: jobDefinition.assigned_variables || [],
        assignedVariableBundles: jobDefinition.assigned_variable_bundles || [],
        maxCodingCases: jobDefinition.max_coding_cases,
        caseOrderingMode: jobDefinition.case_ordering_mode,
        distributionSeed: this.getDefinitionDistributionSeed(jobDefinition),
        excludeJobDefinitionId: jobDefinition.id
      }
    );

    if (unavailableVariables.length > 0) {
      throw new BadRequestException(
        `Cannot approve job definition: The following variables have no remaining cases: ${unavailableVariables.join(', ')}`
      );
    }
  }

  async deleteJobDefinition(id: number): Promise<void> {
    const jobDefinition = await this.getJobDefinition(id);
    await this.assertJobDefinitionHasNoBlockingCreatedJobs(jobDefinition);
    await this.jobDefinitionRepository.remove(jobDefinition);
  }

  async getApprovedJobDefinitions(workspaceId?: number): Promise<JobDefinition[]> {
    let definitions: JobDefinition[];

    if (workspaceId) {
      definitions = await this.jobDefinitionRepository.find({
        where: {
          status: 'approved' as const,
          workspace_id: workspaceId
        },
        order: { created_at: 'DESC' }
      });
    } else {
      definitions = await this.jobDefinitionRepository.find({
        where: {
          status: 'approved' as const
        },
        order: { created_at: 'DESC' }
      });
    }

    for (const definition of definitions) {
      await this.hydrateAssignedVariableBundles(definition);
    }

    return definitions;
  }

  private async buildDistributionRequestFromDefinition(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<DefinitionDistributionRequest> {
    const jobDefinition = await this.getJobDefinition(jobDefinitionId);

    if (jobDefinition.status !== 'approved') {
      throw new BadRequestException('Only approved job definitions can be used to create coding jobs');
    }

    if (jobDefinition.workspace_id !== workspaceId) {
      throw new NotFoundException(`Job definition with ID ${jobDefinitionId} not found`);
    }

    const variableBundleIds = jobDefinition.assigned_variable_bundles?.map(bundle => bundle.id) || [];
    const fullVariableBundles = variableBundleIds.length > 0 ?
      await this.variableBundleRepository.find({
        where: { id: In(variableBundleIds) }
      }) :
      [];

    const savedBundleModes = new Map(
      (jobDefinition.assigned_variable_bundles || [])
        .map(bundle => [bundle.id, bundle.caseOrderingMode])
    );
    const assignedVariableOptionsByKey = new Map(
      (jobDefinition.assigned_variables || []).map(variable => [
        `${variable.unitName}-${variable.variableId}`,
        variable
      ])
    );
    const selectedVariableBundles = fullVariableBundles.map(bundle => ({
      id: bundle.id,
      name: bundle.name,
      variables: (bundle.variables || []).map(variable => ({
        ...variable,
        ...(assignedVariableOptionsByKey.get(`${variable.unitName}-${variable.variableId}`)?.includeDeriveError === true ?
          { includeDeriveError: true } :
          {})
      })),
      caseOrderingMode: savedBundleModes.get(bundle.id)
    }));
    const bundleVariables = selectedVariableBundles.flatMap(bundle => bundle.variables || []);
    const bundleVariableKeys = new Set(bundleVariables.map(v => `${v.unitName}-${v.variableId}`));

    const filteredVariables = (jobDefinition.assigned_variables || []).filter(v => !bundleVariableKeys.has(`${v.unitName}-${v.variableId}`)
    );
    const coderAssignments = this.getStoredCoderAssignments(jobDefinition);
    const capacityByCoderId = new Map(
      coderAssignments.assignedCoderConfigs.map(config => [config.coderId, config.capacityPercent])
    );
    const assignedCoderIds = coderAssignments.assignedCoders;
    const assignedUsers = assignedCoderIds.length > 0 ?
      await this.usersRepository.find({ where: { id: In(assignedCoderIds) } }) :
      [];
    const assignedUsersById = new Map(assignedUsers.map(user => [user.id, user]));
    const selectedCoders = assignedCoderIds.map(coderId => {
      const username = assignedUsersById.get(coderId)?.username || `Coder ${coderId}`;
      return {
        id: coderId,
        name: username,
        username,
        capacityPercent: capacityByCoderId.get(coderId) ?? DEFAULT_CODER_CAPACITY_PERCENT
      };
    });

    return {
      selectedVariables: filteredVariables,
      selectedVariableBundles,
      selectedCoders,
      doubleCodingAbsolute: jobDefinition.double_coding_absolute,
      doubleCodingPercentage: this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: jobDefinition.case_ordering_mode,
      maxCodingCases: jobDefinition.max_coding_cases,
      jobDefinitionId,
      distributionSeed: this.getDefinitionDistributionSeed(jobDefinition),
      showScore: jobDefinition.show_score,
      allowComments: jobDefinition.allow_comments,
      suppressGeneralInstructions: jobDefinition.suppress_general_instructions
    };
  }

  async createCodingJobFromDefinition(jobDefinitionId: number, workspaceId: number) {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    return this.codingJobService.createDistributedCodingJobs(workspaceId, request);
  }

  async previewJobDefinitionRefresh(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<JobDefinitionRefreshPreviewDto> {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    return this.codingJobService.previewJobDefinitionRefresh(workspaceId, request);
  }

  async refreshCodingJobFromDefinition(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<JobDefinitionRefreshApplyResultDto> {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    const result = await this.codingJobService.refreshDistributedCodingJobs(workspaceId, request);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    return {
      success: true,
      message: `Updated job definition ${jobDefinitionId}: created ${result.jobsCreated} coding jobs.`,
      preview: result.preview,
      jobsCreated: result.jobsCreated
    };
  }
}
