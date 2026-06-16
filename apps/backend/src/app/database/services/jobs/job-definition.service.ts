import { randomUUID } from 'crypto';
import {
  Injectable, NotFoundException, BadRequestException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, In } from 'typeorm';
import * as fastCsv from 'fast-csv';
import {
  JobDefinition,
  JobDefinitionCoderConfig,
  JobDefinitionDistributionSnapshot,
  JobDefinitionDistributionSnapshotDoubleCodingInfo,
  JobDefinitionDistributionSnapshotSource,
  JobDefinitionVariable,
  JobDefinitionVariableBundle,
  CaseOrderingMode
} from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import User from '../../entities/user.entity';
import {
  CodingJobService,
  DistributionVariableUsageByStatus
} from '../coding/coding-job.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { MissingsProfilesService } from '../coding/missings-profiles.service';
import { CreateJobDefinitionDto } from '../../../admin/coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../../../admin/coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../../../admin/coding-job/dto/approve-job-definition.dto';
import {
  JobDefinitionRefreshApplyResultDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../../api-dto/coding/job-refresh.dto';
import { sanitizeCsvText } from '../../../utils/csv.util';

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
  max_coding_cases?: number | null;
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
  plannedVariableUsageByStatus: Record<string, DistributionVariableUsageByStatus>;
  planned_variable_usage_by_status: Record<string, DistributionVariableUsageByStatus>;
};

interface JobDefinitionValidationState {
  status?: JobDefinition['status'];
  assignedVariables?: JobDefinitionVariable[];
  assignedVariableBundles?: JobDefinitionVariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number | null;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: CaseOrderingMode;
}

type ExistingJobBoundUpdateField =
  | 'status'
  | 'assignedVariables'
  | 'assignedVariableBundles'
  | 'assignedCoders'
  | 'assignedCoderConfigs'
  | 'missingsProfileId'
  | 'maxCodingCases'
  | 'doubleCodingAbsolute'
  | 'doubleCodingPercentage'
  | 'caseOrderingMode';

const DISTRIBUTION_RELEVANT_UPDATE_FIELDS = new Set<ExistingJobBoundUpdateField>([
  'assignedVariables',
  'assignedVariableBundles',
  'maxCodingCases',
  'caseOrderingMode'
]);

interface PreparedJobDefinitionUpdate {
  existingDefinition: JobDefinition;
  updatedDefinition: JobDefinition;
  nextState: JobDefinitionValidationState;
  nextCoderAssignments: ResolvedCoderAssignments;
  nextMissingsProfileId: number | undefined;
  distributionSeed: string;
  createdJobsCount: number;
  changedExistingJobBoundFields: ExistingJobBoundUpdateField[];
}

interface VariableConflictCheckRequest {
  jobDefinitionId?: number;
  assignedVariables: JobDefinitionVariable[];
  assignedVariableBundles: JobDefinitionVariableBundle[];
  maxCodingCases?: number | null;
  caseOrderingMode?: CaseOrderingMode;
  distributionSeed?: string;
  excludeJobDefinitionId?: number;
  requireAssignedBundles?: boolean;
}

type PlannedVariableUsageBatchRequest = {
  key: string | number;
  selectedVariables: JobDefinitionVariable[];
  selectedVariableBundles: JobDefinitionDistributionVariableBundle[];
  maxCodingCases?: number | null;
  caseOrderingMode?: CaseOrderingMode;
  jobDefinitionId?: number;
  excludeJobDefinitionId?: number;
  distributionSeed?: string;
};

type JobDefinitionDistributionVariableBundle = {
  id: number;
  name: string;
  caseOrderingMode?: CaseOrderingMode;
  variables: JobDefinitionVariable[];
};

type DefinitionDistributionRequest = {
  selectedVariables: JobDefinitionVariable[];
  selectedVariableBundles: JobDefinitionDistributionVariableBundle[];
  selectedCoders: {
    id: number;
    name: string;
    username: string;
    capacityPercent: number;
  }[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: CaseOrderingMode;
  maxCodingCases?: number | null;
  jobDefinitionId: number;
  distributionSeed: string;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
  missingsProfileId: number;
};

type DistributionResultDoubleCodingInfo = {
  totalCases: number;
  distinctCases?: number;
  codingTasksTotal?: number;
  doubleCodedCases: number;
  singleCodedCasesAssigned: number;
  doubleCodedCasesPerCoder?: Record<string, number>;
  doubleCodedCasesPerCoderId?: Record<string, number>;
};

type DistributionResultForSnapshot = {
  success: boolean;
  distribution: Record<string, Record<string, number>>;
  distributionByCoderId?: Record<string, Record<string, number>>;
  doubleCodingInfo: Record<string, DistributionResultDoubleCodingInfo>;
  aggregationInfo: Record<string, { uniqueCases: number; totalResponses: number }>;
  matchingFlags: string[];
  pairDistribution?: Record<string, number>;
  tasksPerCoder?: Record<string, number>;
  coderWeights?: Record<string, number>;
  preview?: JobDefinitionRefreshPreviewDto;
  jobs: {
    itemKey?: string;
    coderId: number;
    variable: { unitName: string; variableId: string };
    jobId: number;
    caseCount: number;
  }[];
};

const DEFAULT_CODER_CAPACITY_PERCENT = 100;
const MIN_CODER_CAPACITY_PERCENT = 10;
const MAX_CODER_CAPACITY_PERCENT = 300;
const JOB_DEFINITION_DISTRIBUTION_CSV_HEADERS = [
  'Job-Definition-ID',
  'Snapshot-Zeitpunkt',
  'Quelle',
  'Typ',
  'Variable/Buendel',
  'Coder-ID',
  'Coder',
  'Fallzahl',
  'Gesamt',
  'Doppelt kodiert',
  'Einfach zugewiesen',
  'Doppelt kodiert fuer Coder'
] as const;

type JobDefinitionDistributionCsvRow = Record<
typeof JOB_DEFINITION_DISTRIBUTION_CSV_HEADERS[number],
string | number
>;

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
    private codingValidationService: CodingValidationService,
    private missingsProfilesService: MissingsProfilesService
  ) { }

  private async checkVariableConflicts(
    workspaceId: number,
    request: VariableConflictCheckRequest
  ): Promise<string[]> {
    const hydratedAssignedBundles = await this.hydrateVariableBundles(
      request.assignedVariableBundles,
      request.requireAssignedBundles
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

    const reservedCasesByVariable = new Map<string, DistributionVariableUsageByStatus>();
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
    if (request.excludeJobDefinitionId !== undefined) {
      requestedUsageRequest.excludeJobDefinitionId = request.excludeJobDefinitionId;
    }
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
    const requestedDeriveErrorVariableKeys = this.getDeriveErrorVariableKeysFromUsageRequests([
      requestedUsageRequest
    ]);
    const incompleteVariables = await this.codingValidationService.getCodingIncompleteVariables(
      workspaceId,
      undefined,
      undefined,
      requestedDeriveErrorVariableKeys.size > 0,
      request.excludeJobDefinitionId
    );
    const availableCasesByVariable = new Map(
      incompleteVariables.map(variable => {
        const variableKey = this.makeVariableKey(variable.unitName, variable.variableId);
        return [
          variableKey,
          this.getAvailableCasesForConflict(
            variable,
            requestedDeriveErrorVariableKeys.has(variableKey)
          )
        ];
      })
    );
    const usageByRequestKey = await this.codingJobService.calculateDistributionVariableUsageByStatusBatch(
      workspaceId,
      [requestedUsageRequest, ...existingUsageRequests]
    );
    const requestedUsage =
      usageByRequestKey.get(requestedUsageKey) ||
      new Map<string, DistributionVariableUsageByStatus>();

    existingUsageRequests.forEach(usageRequest => {
      const usage =
        usageByRequestKey.get(usageRequest.key) ||
        new Map<string, DistributionVariableUsageByStatus>();
      usage.forEach((usageCount, variableKey) => {
        this.addVariableUsageByStatus(reservedCasesByVariable, variableKey, usageCount);
      });
    });

    const unavailableVariables: string[] = [];

    requestedUsage.forEach((requestedUsageCount, variableKey) => {
      const includeDeriveError = requestedDeriveErrorVariableKeys.has(variableKey);
      const availableCases = availableCasesByVariable.get(variableKey);
      const requestedCases = this.getVariableUsageCountForConflict(
        requestedUsageCount,
        includeDeriveError
      );
      const reservedCases = this.getVariableUsageCountForConflict(
        reservedCasesByVariable.get(variableKey),
        includeDeriveError
      );
      const remainingCases = (availableCases ?? 0) - reservedCases;

      if (availableCases === undefined || remainingCases <= 0 || requestedCases > remainingCases) {
        unavailableVariables.push(variableKey.replace('::', ':'));
      }
    });

    return unavailableVariables;
  }

  private getDeriveErrorVariableKeysFromUsageRequests(
    requests: Pick<
    PlannedVariableUsageBatchRequest,
    'selectedVariables' | 'selectedVariableBundles'
    >[]
  ): Set<string> {
    const keys = new Set<string>();

    requests.forEach(request => {
      (request.selectedVariables || []).forEach(variable => {
        if (variable.includeDeriveError === true) {
          keys.add(this.makeVariableKey(variable.unitName, variable.variableId));
        }
      });

      (request.selectedVariableBundles || []).forEach(bundle => {
        (bundle.variables || []).forEach(variable => {
          if (variable.includeDeriveError === true) {
            keys.add(this.makeVariableKey(variable.unitName, variable.variableId));
          }
        });
      });
    });

    return keys;
  }

  private getAvailableCasesForConflict(
    variable: {
      availableCases: number;
      availableCasesWithDeriveError?: number;
    },
    includeDeriveError: boolean
  ): number {
    if (
      includeDeriveError &&
      typeof variable.availableCasesWithDeriveError === 'number' &&
      Number.isFinite(variable.availableCasesWithDeriveError)
    ) {
      return variable.availableCasesWithDeriveError;
    }

    return variable.availableCases;
  }

  private addVariableUsageByStatus(
    usageByVariable: Map<string, DistributionVariableUsageByStatus>,
    variableKey: string,
    usageToAdd: DistributionVariableUsageByStatus
  ): void {
    const currentUsage = usageByVariable.get(variableKey) || {
      regular: 0,
      deriveError: 0,
      total: 0
    };

    currentUsage.regular += usageToAdd.regular;
    currentUsage.deriveError += usageToAdd.deriveError;
    currentUsage.total += usageToAdd.total;
    usageByVariable.set(variableKey, currentUsage);
  }

  private getVariableUsageCountForConflict(
    usage: DistributionVariableUsageByStatus | undefined,
    includeDeriveError: boolean
  ): number {
    if (!usage) {
      return 0;
    }

    return includeDeriveError ? usage.total : usage.regular;
  }

  private makeVariableKey(unitName: string, variableId: string): string {
    return `${unitName}::${variableId}`;
  }

  private buildDistributionVariableSelection(
    assignedVariables: JobDefinitionVariable[] = [],
    assignedVariableBundles: JobDefinitionBundleForUsage[] = []
  ): {
      selectedVariables: JobDefinitionVariable[];
      selectedVariableBundles: JobDefinitionDistributionVariableBundle[];
    } {
    const assignedVariableOptionsByKey = assignedVariables.reduce(
      (variablesByKey, variable) => {
        const key = this.makeVariableKey(variable.unitName, variable.variableId);
        const existing = variablesByKey.get(key);
        variablesByKey.set(key, {
          ...variable,
          ...(existing?.includeDeriveError === true || variable.includeDeriveError === true ?
            { includeDeriveError: true } :
            {})
        });
        return variablesByKey;
      },
      new Map<string, JobDefinitionVariable>()
    );
    const selectedVariableBundles = assignedVariableBundles.map(bundle => ({
      id: bundle.id,
      name: bundle.name,
      caseOrderingMode: bundle.caseOrderingMode,
      variables: (bundle.variables || []).map(variable => {
        const assignedVariable = assignedVariableOptionsByKey.get(
          this.makeVariableKey(variable.unitName, variable.variableId)
        );

        return {
          ...variable,
          ...(variable.includeDeriveError === true || assignedVariable?.includeDeriveError === true ?
            { includeDeriveError: true } :
            {})
        };
      })
    }));
    const bundleVariableKeys = new Set(
      selectedVariableBundles
        .flatMap(bundle => bundle.variables)
        .map(variable => this.makeVariableKey(variable.unitName, variable.variableId))
    );

    return {
      selectedVariables: Array.from(assignedVariableOptionsByKey.values()).filter(
        variable => !bundleVariableKeys.has(this.makeVariableKey(variable.unitName, variable.variableId))
      ),
      selectedVariableBundles
    };
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
    const variableSelection = this.buildDistributionVariableSelection(
      definition.assigned_variables || [],
      definition.assigned_variable_bundles || []
    );

    return {
      key,
      selectedVariables: variableSelection.selectedVariables,
      selectedVariableBundles: variableSelection.selectedVariableBundles,
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
      variables: this.mergeSavedBundleVariableOptions(
        variableBundlesById.get(bundle.id)?.variables || [],
        bundle.variables || []
      )
    }));
  }

  private mergeSavedBundleVariableOptions(
    fullVariables: JobDefinitionVariable[] = [],
    savedVariables: JobDefinitionVariable[] = []
  ): JobDefinitionVariable[] {
    const savedVariablesByKey = new Map(
      savedVariables.map(variable => [
        this.makeVariableKey(variable.unitName, variable.variableId),
        variable
      ])
    );

    return fullVariables.map(variable => {
      const savedVariable = savedVariablesByKey.get(
        this.makeVariableKey(variable.unitName, variable.variableId)
      );

      return {
        ...variable,
        ...(variable.includeDeriveError === true || savedVariable?.includeDeriveError === true ?
          { includeDeriveError: true } :
          {})
      };
    });
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
          variables: this.mergeSavedBundleVariableOptions(
            fullBundle.variables || [],
            savedBundle.variables || []
          ),
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

  private mapVariableUsageByStatusToRecord(
    usage: Map<string, DistributionVariableUsageByStatus>
  ): Record<string, DistributionVariableUsageByStatus> {
    return Object.fromEntries(usage.entries());
  }

  private mapVariableUsageByStatusRecordToTotals(
    usageByStatus: Record<string, DistributionVariableUsageByStatus>
  ): Record<string, number> {
    return Object.fromEntries(
      Object.entries(usageByStatus).map(([variableKey, usage]) => [
        variableKey,
        usage.total
      ])
    );
  }

  private buildSnapshotDoubleCodingInfo(
    doubleCodingInfo: Record<string, DistributionResultDoubleCodingInfo>
  ): Record<string, JobDefinitionDistributionSnapshotDoubleCodingInfo> {
    return Object.fromEntries(
      Object.entries(doubleCodingInfo).map(([itemKey, info]) => [
        itemKey,
        {
          totalCases: info.totalCases,
          distinctCases: info.distinctCases,
          codingTasksTotal: info.codingTasksTotal,
          doubleCodedCases: info.doubleCodedCases,
          singleCodedCasesAssigned: info.singleCodedCasesAssigned,
          doubleCodedCasesPerCoderId: info.doubleCodedCasesPerCoderId || {}
        }
      ])
    );
  }

  private buildDistributionSnapshot(
    source: JobDefinitionDistributionSnapshotSource,
    request: DefinitionDistributionRequest,
    result: DistributionResultForSnapshot
  ): JobDefinitionDistributionSnapshot {
    return {
      version: 1,
      source,
      createdAt: new Date().toISOString(),
      distributionSeed: request.distributionSeed,
      selectedVariables: request.selectedVariables,
      selectedVariableBundles: request.selectedVariableBundles,
      selectedCoders: request.selectedCoders.map(coder => ({
        coderId: coder.id,
        capacityPercent: coder.capacityPercent
      })),
      settings: {
        maxCodingCases: request.maxCodingCases,
        doubleCodingAbsolute: request.doubleCodingAbsolute,
        doubleCodingPercentage: request.doubleCodingPercentage,
        caseOrderingMode: request.caseOrderingMode
      },
      distributionByCoderId: result.distributionByCoderId || {},
      doubleCodingInfo: this.buildSnapshotDoubleCodingInfo(result.doubleCodingInfo || {}),
      aggregationInfo: result.aggregationInfo || {},
      matchingFlags: result.matchingFlags || [],
      pairDistribution: result.pairDistribution || {},
      tasksPerCoder: result.tasksPerCoder || {},
      coderWeights: result.coderWeights || {},
      jobs: (result.jobs || []).map(job => ({
        itemKey: job.itemKey,
        coderId: job.coderId,
        variable: job.variable,
        jobId: job.jobId,
        caseCount: job.caseCount
      })),
      ...(result.preview ? { refreshPreview: result.preview } : {})
    };
  }

  private async appendDistributionSnapshot(
    jobDefinitionId: number,
    source: JobDefinitionDistributionSnapshotSource,
    request: DefinitionDistributionRequest,
    result: DistributionResultForSnapshot,
    manager?: EntityManager
  ): Promise<void> {
    const repository = manager?.getRepository(JobDefinition) || this.jobDefinitionRepository;
    const jobDefinition = await repository.findOne({
      where: { id: jobDefinitionId }
    });

    if (!jobDefinition) {
      throw new NotFoundException(`Job definition with ID ${jobDefinitionId} not found`);
    }

    const snapshots = Array.isArray(jobDefinition.distribution_snapshots) ?
      jobDefinition.distribution_snapshots :
      [];
    jobDefinition.distribution_snapshots = [
      ...snapshots,
      this.buildDistributionSnapshot(source, request, result)
    ];

    await repository.save(jobDefinition);
  }

  async createJobDefinition(createDto: CreateJobDefinitionDto, workspaceId: number): Promise<JobDefinition> {
    const coderAssignments = this.resolveCoderAssignments(createDto);
    const distributionSeed = createDto.distributionSeed || this.createDistributionSeed(workspaceId);
    const missingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
      workspaceId,
      createDto.missingsProfileId
    );

    await this.codingJobService.assertDeriveErrorManualCodingEnabled(
      workspaceId,
      {
        selectedVariables: createDto.assignedVariables || [],
        selectedVariableBundles: createDto.assignedVariableBundles || []
      }
    );

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
      assigned_variable_bundles: this.toStoredAssignedVariableBundles(
        createDto.assignedVariableBundles
      ),
      assigned_coders: coderAssignments.assignedCoders,
      assigned_coder_configs: coderAssignments.assignedCoderConfigs,
      missings_profile_id: missingsProfileId,
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

  async getJobDefinition(id: number, workspaceId: number): Promise<JobDefinition> {
    const jobDefinition = await this.jobDefinitionRepository.findOne({
      where: {
        id,
        workspace_id: workspaceId
      }
    });

    if (!jobDefinition) {
      throw new NotFoundException(`Job definition with ID ${id} not found`);
    }

    await this.hydrateAssignedVariableBundles(jobDefinition);

    return jobDefinition;
  }

  async exportDistributionSnapshotAsCsv(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<string> {
    const jobDefinition = await this.getJobDefinition(jobDefinitionId, workspaceId);
    const snapshots = Array.isArray(jobDefinition.distribution_snapshots) ?
      jobDefinition.distribution_snapshots :
      [];
    const snapshot = snapshots[snapshots.length - 1];

    if (!snapshot) {
      throw new BadRequestException(
        'No stored distribution snapshot is available for this job definition'
      );
    }

    const coderIds = this.getSnapshotCoderIds(snapshot);
    const coderNamesById = await this.getCoderNamesById(coderIds);
    const rows = this.createDistributionCsvRows(
      jobDefinition.id,
      snapshot,
      coderIds,
      coderNamesById
    );

    return fastCsv.writeToString(rows, {
      headers: [...JOB_DEFINITION_DISTRIBUTION_CSV_HEADERS],
      alwaysWriteHeaders: true,
      delimiter: ';',
      quote: '"'
    });
  }

  private getSnapshotCoderIds(snapshot: JobDefinitionDistributionSnapshot): number[] {
    const coderIds = new Set<number>();

    (snapshot.selectedCoders || []).forEach(coder => {
      coderIds.add(coder.coderId);
    });

    Object.values(snapshot.distributionByCoderId || {}).forEach(coderCases => {
      Object.keys(coderCases || {}).forEach(coderId => {
        const parsedCoderId = Number(coderId);
        if (Number.isFinite(parsedCoderId)) {
          coderIds.add(parsedCoderId);
        }
      });
    });

    return Array.from(coderIds).sort((a, b) => a - b);
  }

  private async getCoderNamesById(coderIds: number[]): Promise<Map<number, string>> {
    if (coderIds.length === 0) {
      return new Map();
    }

    const users = await this.usersRepository.find({ where: { id: In(coderIds) } });
    return new Map(users.map(user => [user.id, user.username]));
  }

  private createDistributionCsvRows(
    jobDefinitionId: number,
    snapshot: JobDefinitionDistributionSnapshot,
    coderIds: number[],
    coderNamesById: Map<number, string>
  ): JobDefinitionDistributionCsvRow[] {
    return Object.entries(snapshot.distributionByCoderId || {})
      .sort(([itemKeyA], [itemKeyB]) => itemKeyA.localeCompare(itemKeyB))
      .flatMap(([itemKey, coderCases]) => {
        const doubleCodingInfo = snapshot.doubleCodingInfo?.[itemKey];
        const fallbackTotalCases = Object.values(coderCases || {}).reduce(
          (sum, caseCount) => sum + caseCount,
          0
        );
        const totalCases = this.getSnapshotDistinctCaseCount(
          doubleCodingInfo,
          snapshot.aggregationInfo?.[itemKey]?.uniqueCases,
          fallbackTotalCases
        );

        return coderIds.map(coderId => ({
          'Job-Definition-ID': jobDefinitionId,
          'Snapshot-Zeitpunkt': sanitizeCsvText(snapshot.createdAt),
          Quelle: sanitizeCsvText(this.getSnapshotSourceLabel(snapshot.source)),
          Typ: sanitizeCsvText(this.getSnapshotItemType(itemKey)),
          'Variable/Buendel': sanitizeCsvText(this.getSnapshotItemLabel(snapshot, itemKey)),
          'Coder-ID': coderId,
          Coder: sanitizeCsvText(coderNamesById.get(coderId) || `Coder ${coderId}`),
          Fallzahl: coderCases?.[String(coderId)] || 0,
          Gesamt: totalCases,
          'Doppelt kodiert': doubleCodingInfo?.doubleCodedCases || 0,
          'Einfach zugewiesen': doubleCodingInfo?.singleCodedCasesAssigned || 0,
          'Doppelt kodiert fuer Coder': doubleCodingInfo?.doubleCodedCasesPerCoderId?.[String(coderId)] || 0
        }));
      });
  }

  private getSnapshotDistinctCaseCount(
    doubleCodingInfo: JobDefinitionDistributionSnapshotDoubleCodingInfo | undefined,
    aggregationUniqueCases: number | undefined,
    fallbackTotalCases: number
  ): number {
    const legacySelectedCases = doubleCodingInfo ?
      doubleCodingInfo.doubleCodedCases + doubleCodingInfo.singleCodedCasesAssigned :
      undefined;
    const snapshotCaseCount = [
      doubleCodingInfo?.distinctCases,
      legacySelectedCases,
      aggregationUniqueCases,
      doubleCodingInfo?.totalCases,
      fallbackTotalCases
    ].find(caseCount => typeof caseCount === 'number' && Number.isFinite(caseCount));

    return snapshotCaseCount ?? fallbackTotalCases;
  }

  private getSnapshotSourceLabel(source: JobDefinitionDistributionSnapshotSource): string {
    return source === 'refresh' ? 'Neuverteilung' : 'Ersterstellung';
  }

  private getSnapshotItemType(itemKey: string): string {
    return itemKey.startsWith('bundle:') ? 'Buendel' : 'Variable';
  }

  private getSnapshotItemLabel(
    snapshot: JobDefinitionDistributionSnapshot,
    itemKey: string
  ): string {
    if (itemKey.startsWith('bundle:')) {
      const bundleId = Number(itemKey.slice('bundle:'.length));
      const bundle = snapshot.selectedVariableBundles.find(selectedBundle => selectedBundle.id === bundleId);
      return bundle?.name || itemKey;
    }

    const parts = itemKey.split('::');
    if (parts.length === 2) {
      return `${parts[0]} -> ${parts[1]}`;
    }

    return itemKey;
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
        const plannedUsageByStatusByDefinitionId =
          new Map<number, Record<string, DistributionVariableUsageByStatus>>();

        const usageRequestPromises: Promise<PlannedVariableUsageBatchRequest | undefined>[] =
          workspaceDefinitions.map(async definition => {
            if (definition.id === undefined) {
              return undefined;
            }

            const createdJobsCount = countsByDefinitionId.get(definition.id) || 0;
            if (createdJobsCount > 0) {
              plannedUsageByDefinitionId.set(definition.id, {});
              plannedUsageByStatusByDefinitionId.set(definition.id, {});
              return undefined;
            }

            const hydratedBundles = await this.hydrateVariableBundles(
              definition.assigned_variable_bundles || []
            );

            return this.buildPlannedVariableUsageBatchRequest(definition.id, {
              id: definition.id,
              assigned_variables: definition.assigned_variables || [],
              assigned_variable_bundles: hydratedBundles,
              max_coding_cases: definition.max_coding_cases,
              case_ordering_mode: definition.case_ordering_mode,
              distribution_seed: this.getDefinitionDistributionSeed(definition)
            });
          });
        const usageRequests = (await Promise.all(usageRequestPromises))
          .filter((request): request is PlannedVariableUsageBatchRequest => request !== undefined);

        if (usageRequests.length > 0) {
          const usageByDefinitionId = await this.codingJobService.calculateDistributionVariableUsageByStatusBatch(
            definitionWorkspaceId,
            usageRequests
          );

          usageRequests.forEach(request => {
            if (typeof request.key === 'number') {
              const usageByStatus = this.mapVariableUsageByStatusToRecord(
                usageByDefinitionId.get(request.key) || new Map()
              );
              plannedUsageByStatusByDefinitionId.set(request.key, usageByStatus);
              plannedUsageByDefinitionId.set(
                request.key,
                this.mapVariableUsageByStatusRecordToTotals(usageByStatus)
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
              plannedUsageByDefinitionId.get(definition.id) || {},
            plannedVariableUsageByStatus: definition.id === undefined ?
              {} :
              plannedUsageByStatusByDefinitionId.get(definition.id) || {},
            planned_variable_usage_by_status: definition.id === undefined ?
              {} :
              plannedUsageByStatusByDefinitionId.get(definition.id) || {}
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
          planned_variable_usage: {},
          plannedVariableUsageByStatus: {},
          planned_variable_usage_by_status: {}
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

  private toStoredAssignedVariableBundles(
    bundles?: JobDefinitionVariableBundle[]
  ): JobDefinitionVariableBundle[] {
    return (bundles || []).map(bundle => {
      const variablesWithOptions = (bundle.variables || [])
        .filter(variable => variable.includeDeriveError === true)
        .map(variable => this.normalizeVariableForSave(variable));

      return {
        id: bundle.id,
        name: bundle.name,
        caseOrderingMode: bundle.caseOrderingMode,
        ...(variablesWithOptions.length > 0 ? { variables: variablesWithOptions } : {})
      };
    });
  }

  private normalizeVariablesForComparison(
    variables?: JobDefinitionVariable[]
  ): JobDefinitionVariable[] {
    return (variables || []).map(variable => ({
      unitName: variable.unitName,
      variableId: variable.variableId,
      ...(variable.includeDeriveError === true ?
        { includeDeriveError: true } :
        {})
    })).sort((left, right) => `${left.unitName}::${left.variableId}`
      .localeCompare(`${right.unitName}::${right.variableId}`));
  }

  private normalizeBundlesForComparison(
    bundles?: JobDefinitionVariableBundle[]
  ): {
      id: number;
      caseOrderingMode?: CaseOrderingMode;
      variables: JobDefinitionVariable[];
    }[] {
    return (bundles || [])
      .map(bundle => ({
        id: Number(bundle.id),
        caseOrderingMode: bundle.caseOrderingMode,
        variables: this.normalizeVariablesForComparison(
          (bundle.variables || []).filter(variable => variable.includeDeriveError === true)
        )
      }))
      .sort((left, right) => left.id - right.id);
  }

  private getVariableSelectionKey(variable: JobDefinitionVariable): string {
    return `${variable.unitName}::${variable.variableId}`;
  }

  private normalizeVariableForSave(
    variable: JobDefinitionVariable
  ): JobDefinitionVariable {
    return {
      unitName: variable.unitName,
      variableId: variable.variableId,
      ...(variable.includeDeriveError === true ?
        { includeDeriveError: true } :
        {})
    };
  }

  private haveSameVariableSelection(
    currentVariables?: JobDefinitionVariable[],
    proposedVariables?: JobDefinitionVariable[]
  ): boolean {
    const currentKeys = (currentVariables || [])
      .map(variable => this.getVariableSelectionKey(variable))
      .sort((left, right) => left.localeCompare(right));
    const proposedKeys = (proposedVariables || [])
      .map(variable => this.getVariableSelectionKey(variable))
      .sort((left, right) => left.localeCompare(right));

    return this.valuesDiffer(currentKeys, proposedKeys) === false;
  }

  private getAssignedVariablesForSave(
    currentVariables?: JobDefinitionVariable[],
    proposedVariables?: JobDefinitionVariable[]
  ): JobDefinitionVariable[] {
    if (!this.haveSameVariableSelection(currentVariables, proposedVariables)) {
      return (proposedVariables || []).map(variable => this.normalizeVariableForSave(variable));
    }

    const proposedByKey = new Map(
      (proposedVariables || []).map(variable => [
        this.getVariableSelectionKey(variable),
        this.normalizeVariableForSave(variable)
      ])
    );

    return (currentVariables || []).map(currentVariable => {
      const key = this.getVariableSelectionKey(currentVariable);
      return proposedByKey.get(key) ||
        this.normalizeVariableForSave(currentVariable);
    });
  }

  private haveSameBundleSelection(
    currentBundles?: JobDefinitionVariableBundle[],
    proposedBundles?: JobDefinitionVariableBundle[]
  ): boolean {
    const currentIds = (currentBundles || [])
      .map(bundle => Number(bundle.id))
      .sort((left, right) => left - right);
    const proposedIds = (proposedBundles || [])
      .map(bundle => Number(bundle.id))
      .sort((left, right) => left - right);

    return this.valuesDiffer(currentIds, proposedIds) === false;
  }

  private getAssignedVariableBundlesForSave(
    currentBundles?: JobDefinitionVariableBundle[],
    proposedBundles?: JobDefinitionVariableBundle[]
  ): JobDefinitionVariableBundle[] {
    if (!this.haveSameBundleSelection(currentBundles, proposedBundles)) {
      return this.toStoredAssignedVariableBundles(proposedBundles);
    }

    const proposedById = new Map(
      (proposedBundles || []).map(bundle => [Number(bundle.id), bundle])
    );

    return (currentBundles || []).map(currentBundle => {
      const proposedBundle = proposedById.get(Number(currentBundle.id));
      return this.toStoredAssignedVariableBundles([
        proposedBundle ?
          {
            ...currentBundle,
            ...proposedBundle,
            name: proposedBundle.name || currentBundle.name,
            variables: proposedBundle.variables ?? currentBundle.variables
          } :
          currentBundle
      ])[0];
    });
  }

  private valuesDiffer(first: unknown, second: unknown): boolean {
    return JSON.stringify(first) !== JSON.stringify(second);
  }

  private doubleCodingValue(value: unknown): number {
    return Number(this.toOptionalNumber(value) || 0);
  }

  private async getCreatedJobsCount(jobDefinition: JobDefinition): Promise<number> {
    const countsByDefinitionId = await this.codingJobService.getCodingJobCountsByDefinitionIds(
      jobDefinition.workspace_id,
      [jobDefinition.id]
    );
    return countsByDefinitionId.get(jobDefinition.id) || 0;
  }

  private hasDistributionRelevantChanges(fields: ExistingJobBoundUpdateField[]): boolean {
    return fields.some(field => DISTRIBUTION_RELEVANT_UPDATE_FIELDS.has(field));
  }

  private collectExistingJobBoundChanges(
    jobDefinition: JobDefinition,
    updateDto: UpdateJobDefinitionDto,
    nextCoderAssignments: ResolvedCoderAssignments,
    currentMissingsProfileId: number | undefined,
    nextMissingsProfileId: number | undefined
  ): ExistingJobBoundUpdateField[] {
    const changedFields: ExistingJobBoundUpdateField[] = [];

    if (
      updateDto.status !== undefined &&
      updateDto.status !== jobDefinition.status
    ) {
      changedFields.push('status');
    }

    if (
      updateDto.assignedVariables !== undefined &&
      this.valuesDiffer(
        this.normalizeVariablesForComparison(jobDefinition.assigned_variables),
        this.normalizeVariablesForComparison(updateDto.assignedVariables)
      )
    ) {
      changedFields.push('assignedVariables');
    }

    if (
      updateDto.assignedVariableBundles !== undefined &&
      this.valuesDiffer(
        this.normalizeBundlesForComparison(jobDefinition.assigned_variable_bundles),
        this.normalizeBundlesForComparison(updateDto.assignedVariableBundles)
      )
    ) {
      changedFields.push('assignedVariableBundles');
    }

    if (
      (updateDto.assignedCoders !== undefined ||
        updateDto.assignedCoderConfigs !== undefined) &&
      this.valuesDiffer(
        this.getStoredCoderAssignments(jobDefinition).assignedCoders,
        nextCoderAssignments.assignedCoders
      )
    ) {
      changedFields.push('assignedCoders');
    }

    if (
      updateDto.assignedCoderConfigs !== undefined &&
      this.valuesDiffer(
        this.getStoredCoderAssignments(jobDefinition).assignedCoderConfigs,
        nextCoderAssignments.assignedCoderConfigs
      )
    ) {
      changedFields.push('assignedCoderConfigs');
    }

    if (
      updateDto.missingsProfileId !== undefined &&
      currentMissingsProfileId !== nextMissingsProfileId
    ) {
      changedFields.push('missingsProfileId');
    }

    if (
      updateDto.maxCodingCases !== undefined &&
      this.toOptionalNumber(updateDto.maxCodingCases) !==
        this.toOptionalNumber(jobDefinition.max_coding_cases)
    ) {
      changedFields.push('maxCodingCases');
    }

    if (
      updateDto.doubleCodingAbsolute !== undefined &&
      this.doubleCodingValue(updateDto.doubleCodingAbsolute) !==
        this.doubleCodingValue(jobDefinition.double_coding_absolute)
    ) {
      changedFields.push('doubleCodingAbsolute');
    }

    if (
      updateDto.doubleCodingPercentage !== undefined &&
      this.doubleCodingValue(updateDto.doubleCodingPercentage) !==
        this.doubleCodingValue(jobDefinition.double_coding_percentage)
    ) {
      changedFields.push('doubleCodingPercentage');
    }

    if (
      updateDto.caseOrderingMode !== undefined &&
      updateDto.caseOrderingMode !== jobDefinition.case_ordering_mode
    ) {
      changedFields.push('caseOrderingMode');
    }

    return changedFields;
  }

  private buildUpdatedDefinitionForSave(
    jobDefinition: JobDefinition,
    updateDto: UpdateJobDefinitionDto,
    nextState: JobDefinitionValidationState,
    nextCoderAssignments: ResolvedCoderAssignments,
    nextMissingsProfileId: number | undefined
  ): JobDefinition {
    const updatedDefinition = {
      ...jobDefinition,
      assigned_variable_bundles: this.toStoredAssignedVariableBundles(
        nextState.assignedVariableBundles
      )
    } as JobDefinition;

    if (updateDto.status !== undefined) {
      updatedDefinition.status = updateDto.status;
    }
    if (updateDto.assignedVariables !== undefined) {
      updatedDefinition.assigned_variables = nextState.assignedVariables;
    }
    if (updateDto.assignedVariableBundles !== undefined) {
      updatedDefinition.assigned_variable_bundles =
        this.toStoredAssignedVariableBundles(nextState.assignedVariableBundles);
    }
    if (
      updateDto.assignedCoders !== undefined ||
      updateDto.assignedCoderConfigs !== undefined
    ) {
      updatedDefinition.assigned_coders = nextCoderAssignments.assignedCoders;
      updatedDefinition.assigned_coder_configs =
        nextCoderAssignments.assignedCoderConfigs;
    }
    if (updateDto.durationSeconds !== undefined) {
      updatedDefinition.duration_seconds = updateDto.durationSeconds;
    }
    if (updateDto.maxCodingCases !== undefined) {
      updatedDefinition.max_coding_cases = updateDto.maxCodingCases;
    }
    if (updateDto.doubleCodingAbsolute !== undefined) {
      updatedDefinition.double_coding_absolute = updateDto.doubleCodingAbsolute;
    }
    if (updateDto.doubleCodingPercentage !== undefined) {
      updatedDefinition.double_coding_percentage = updateDto.doubleCodingPercentage;
    }
    if (updateDto.caseOrderingMode !== undefined) {
      updatedDefinition.case_ordering_mode = updateDto.caseOrderingMode;
    }
    if (updateDto.missingsProfileId !== undefined) {
      updatedDefinition.missings_profile_id = nextMissingsProfileId;
    }
    if (updateDto.showScore !== undefined) {
      updatedDefinition.show_score = updateDto.showScore;
    }
    if (updateDto.allowComments !== undefined) {
      updatedDefinition.allow_comments = updateDto.allowComments;
    }
    if (updateDto.suppressGeneralInstructions !== undefined) {
      updatedDefinition.suppress_general_instructions =
        updateDto.suppressGeneralInstructions;
    }

    return updatedDefinition;
  }

  private async prepareJobDefinitionUpdate(
    id: number,
    workspaceId: number,
    updateDto: UpdateJobDefinitionDto
  ): Promise<PreparedJobDefinitionUpdate> {
    const jobDefinition = await this.getJobDefinition(id, workspaceId);
    const existingCoderAssignments = this.getStoredCoderAssignments(jobDefinition);
    const nextCoderAssignments = this.resolveCoderAssignments(updateDto, existingCoderAssignments);
    const distributionSeed = this.getDefinitionDistributionSeed(jobDefinition);
    const currentMissingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
      jobDefinition.workspace_id,
      jobDefinition.missings_profile_id
    );
    const nextMissingsProfileId = updateDto.missingsProfileId !== undefined ?
      await this.missingsProfilesService.resolveMissingsProfileId(
        jobDefinition.workspace_id,
        updateDto.missingsProfileId
      ) :
      currentMissingsProfileId;
    const nextAssignedVariables = updateDto.assignedVariables !== undefined ?
      this.getAssignedVariablesForSave(
        jobDefinition.assigned_variables,
        updateDto.assignedVariables
      ) :
      jobDefinition.assigned_variables ?? [];
    const nextAssignedVariableBundles = updateDto.assignedVariableBundles !== undefined ?
      this.getAssignedVariableBundlesForSave(
        jobDefinition.assigned_variable_bundles,
        updateDto.assignedVariableBundles
      ) :
      this.toStoredAssignedVariableBundles(jobDefinition.assigned_variable_bundles);
    const nextState: JobDefinitionValidationState = {
      status: updateDto.status ?? jobDefinition.status,
      assignedVariables: nextAssignedVariables,
      assignedVariableBundles: nextAssignedVariableBundles,
      assignedCoders: nextCoderAssignments.assignedCoders,
      durationSeconds: updateDto.durationSeconds ?? jobDefinition.duration_seconds,
      maxCodingCases: updateDto.maxCodingCases !== undefined ?
        updateDto.maxCodingCases :
        jobDefinition.max_coding_cases,
      doubleCodingAbsolute: updateDto.doubleCodingAbsolute ?? jobDefinition.double_coding_absolute,
      doubleCodingPercentage: updateDto.doubleCodingPercentage ??
        this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: updateDto.caseOrderingMode ?? jobDefinition.case_ordering_mode
    };

    this.validateStatusTransition(jobDefinition.status, updateDto.status);
    this.validateDefinitionState(nextState);

    if (
      updateDto.assignedVariables !== undefined ||
      updateDto.assignedVariableBundles !== undefined ||
      updateDto.status === 'approved'
    ) {
      await this.codingJobService.assertDeriveErrorManualCodingEnabled(
        workspaceId,
        {
          selectedVariables: nextState.assignedVariables || [],
          selectedVariableBundles: nextState.assignedVariableBundles || []
        }
      );
    }

    const coderAssignmentsChanged = updateDto.assignedCoders !== undefined ||
      updateDto.assignedCoderConfigs !== undefined;
    const approvesDefinition = updateDto.status === 'approved' && jobDefinition.status !== 'approved';
    if (coderAssignmentsChanged || approvesDefinition) {
      await this.codingJobService.assertCodersCanCodeInWorkspace(
        nextCoderAssignments.assignedCoders,
        jobDefinition.workspace_id
      );
    }

    const changedExistingJobBoundFields = this.collectExistingJobBoundChanges(
      jobDefinition,
      updateDto,
      nextCoderAssignments,
      currentMissingsProfileId,
      nextMissingsProfileId
    );

    if (this.hasDistributionRelevantChanges(changedExistingJobBoundFields)) {
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

    return {
      existingDefinition: jobDefinition,
      updatedDefinition: this.buildUpdatedDefinitionForSave(
        jobDefinition,
        updateDto,
        nextState,
        nextCoderAssignments,
        nextMissingsProfileId
      ),
      nextState,
      nextCoderAssignments,
      nextMissingsProfileId,
      distributionSeed,
      createdJobsCount: await this.getCreatedJobsCount(jobDefinition),
      changedExistingJobBoundFields
    };
  }

  private assertUpdateRefreshIsRequired(
    jobDefinitionId: number,
    preparedUpdate: PreparedJobDefinitionUpdate
  ): void {
    if (preparedUpdate.createdJobsCount === 0) {
      throw new BadRequestException(
        `Cannot refresh coding jobs for job definition ${jobDefinitionId} because no coding jobs exist.`
      );
    }

    if (preparedUpdate.changedExistingJobBoundFields.length === 0) {
      throw new BadRequestException(
        'The proposed update does not require regenerating coding jobs.'
      );
    }

    if (preparedUpdate.changedExistingJobBoundFields.includes('status')) {
      throw new BadRequestException(
        'Status changes for job definitions with existing coding jobs are not part of the refresh flow.'
      );
    }
  }

  async updateJobDefinition(id: number, workspaceId: number, updateDto: UpdateJobDefinitionDto): Promise<JobDefinition> {
    const preparedUpdate = await this.prepareJobDefinitionUpdate(
      id,
      workspaceId,
      updateDto
    );
    if (
      preparedUpdate.createdJobsCount > 0 &&
      preparedUpdate.changedExistingJobBoundFields.length > 0
    ) {
      throw new BadRequestException(
        `Cannot update job definition ${id} because existing coding jobs must be refreshed for changes to: ${preparedUpdate.changedExistingJobBoundFields.join(', ')}`
      );
    }

    const syncExistingJobDisplayOptions = preparedUpdate.createdJobsCount > 0 &&
      (
        updateDto.showScore !== undefined ||
        updateDto.allowComments !== undefined ||
        updateDto.suppressGeneralInstructions !== undefined
      );

    if (syncExistingJobDisplayOptions) {
      return this.jobDefinitionRepository.manager.transaction(async manager => {
        const savedDefinition = await manager
          .getRepository(JobDefinition)
          .save(preparedUpdate.updatedDefinition);

        await this.codingJobService.updateCodingJobDisplayOptionsByDefinitionId(
          workspaceId,
          id,
          {
            showScore: updateDto.showScore,
            allowComments: updateDto.allowComments,
            suppressGeneralInstructions: updateDto.suppressGeneralInstructions
          },
          manager
        );

        return savedDefinition;
      });
    }

    return this.jobDefinitionRepository.save(
      preparedUpdate.updatedDefinition
    );
  }

  async approveJobDefinition(id: number, workspaceId: number, approveDto: ApproveJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id, workspaceId);
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
      await this.codingJobService.assertDeriveErrorManualCodingEnabled(
        workspaceId,
        this.buildPlannedVariableUsageBatchRequest(jobDefinition.id, {
          id: jobDefinition.id,
          assigned_variables: jobDefinition.assigned_variables || [],
          assigned_variable_bundles: jobDefinition.assigned_variable_bundles || [],
          max_coding_cases: jobDefinition.max_coding_cases,
          case_ordering_mode: jobDefinition.case_ordering_mode,
          distribution_seed: this.getDefinitionDistributionSeed(jobDefinition)
        })
      );
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

    jobDefinition.missings_profile_id = await this.missingsProfilesService.resolveMissingsProfileId(
      jobDefinition.workspace_id,
      jobDefinition.missings_profile_id
    );

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

  async deleteJobDefinition(id: number, workspaceId: number): Promise<void> {
    const jobDefinition = await this.getJobDefinition(id, workspaceId);
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
    workspaceId: number,
    providedJobDefinition?: JobDefinition
  ): Promise<DefinitionDistributionRequest> {
    const jobDefinition = providedJobDefinition ||
      await this.getJobDefinition(jobDefinitionId, workspaceId);

    if (jobDefinition.status !== 'approved') {
      throw new BadRequestException('Only approved job definitions can be used to create coding jobs');
    }

    const variableBundleIds = jobDefinition.assigned_variable_bundles?.map(bundle => bundle.id) || [];
    const fullVariableBundles = variableBundleIds.length > 0 ?
      await this.variableBundleRepository.find({
        where: { id: In(variableBundleIds) }
      }) :
      [];
    const fullVariableBundlesById = new Map(
      fullVariableBundles.map(bundle => [bundle.id, bundle])
    );

    const savedBundleModes = new Map(
      (jobDefinition.assigned_variable_bundles || [])
        .map(bundle => [bundle.id, bundle.caseOrderingMode])
    );
    const hydratedBundles = (jobDefinition.assigned_variable_bundles || [])
      .map((savedBundle): JobDefinitionDistributionVariableBundle | undefined => {
        const fullBundle = fullVariableBundlesById.get(savedBundle.id);
        if (!fullBundle) {
          return undefined;
        }
        return {
          id: fullBundle.id,
          name: fullBundle.name,
          variables: this.mergeSavedBundleVariableOptions(
            fullBundle.variables || [],
            savedBundle.variables || []
          ),
          caseOrderingMode: savedBundleModes.get(fullBundle.id)
        };
      })
      .filter((bundle): bundle is JobDefinitionDistributionVariableBundle => bundle !== undefined);
    const variableSelection = this.buildDistributionVariableSelection(
      jobDefinition.assigned_variables || [],
      hydratedBundles
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
    const missingsProfileId = await this.missingsProfilesService.resolveMissingsProfileId(
      workspaceId,
      jobDefinition.missings_profile_id
    );
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
      selectedVariables: variableSelection.selectedVariables,
      selectedVariableBundles: variableSelection.selectedVariableBundles,
      selectedCoders,
      doubleCodingAbsolute: jobDefinition.double_coding_absolute,
      doubleCodingPercentage: this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: jobDefinition.case_ordering_mode,
      maxCodingCases: jobDefinition.max_coding_cases,
      jobDefinitionId,
      distributionSeed: this.getDefinitionDistributionSeed(jobDefinition),
      showScore: jobDefinition.show_score,
      allowComments: jobDefinition.allow_comments,
      suppressGeneralInstructions: jobDefinition.suppress_general_instructions,
      missingsProfileId
    };
  }

  async createCodingJobFromDefinition(jobDefinitionId: number, workspaceId: number) {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    return this.codingJobService.createDistributedCodingJobs(
      workspaceId,
      request,
      async (manager, result) => {
        await this.appendDistributionSnapshot(
          jobDefinitionId,
          'initial_creation',
          request,
          result,
          manager
        );
      }
    );
  }

  async previewCodingJobFromDefinition(jobDefinitionId: number, workspaceId: number) {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    const preview = await this.codingJobService.calculateDistribution(workspaceId, request);
    return {
      ...preview,
      selectedVariables: request.selectedVariables,
      selectedVariableBundles: request.selectedVariableBundles,
      selectedCoders: request.selectedCoders
    };
  }

  async previewJobDefinitionRefresh(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<JobDefinitionRefreshPreviewDto> {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    return this.codingJobService.previewJobDefinitionRefresh(workspaceId, request);
  }

  async previewJobDefinitionUpdateRefresh(
    jobDefinitionId: number,
    workspaceId: number,
    updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinitionRefreshPreviewDto> {
    const preparedUpdate = await this.prepareJobDefinitionUpdate(
      jobDefinitionId,
      workspaceId,
      updateDto
    );

    this.assertUpdateRefreshIsRequired(jobDefinitionId, preparedUpdate);

    const request = await this.buildDistributionRequestFromDefinition(
      jobDefinitionId,
      workspaceId,
      preparedUpdate.updatedDefinition
    );

    return this.codingJobService.previewJobDefinitionRefresh(
      workspaceId,
      request
    );
  }

  async refreshCodingJobFromDefinition(
    jobDefinitionId: number,
    workspaceId: number
  ): Promise<JobDefinitionRefreshApplyResultDto> {
    const request = await this.buildDistributionRequestFromDefinition(jobDefinitionId, workspaceId);
    const result = await this.codingJobService.refreshDistributedCodingJobs(
      workspaceId,
      request,
      async (manager, transactionResult) => {
        await this.appendDistributionSnapshot(
          jobDefinitionId,
          'refresh',
          request,
          transactionResult,
          manager
        );
      }
    );
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

  async refreshCodingJobFromUpdatedDefinition(
    jobDefinitionId: number,
    workspaceId: number,
    updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinitionRefreshApplyResultDto> {
    const preparedUpdate = await this.prepareJobDefinitionUpdate(
      jobDefinitionId,
      workspaceId,
      updateDto
    );

    this.assertUpdateRefreshIsRequired(jobDefinitionId, preparedUpdate);

    const request = await this.buildDistributionRequestFromDefinition(
      jobDefinitionId,
      workspaceId,
      preparedUpdate.updatedDefinition
    );
    const result = await this.codingJobService.refreshDistributedCodingJobs(
      workspaceId,
      request,
      async (manager, transactionResult) => {
        await manager.getRepository(JobDefinition).save(
          preparedUpdate.updatedDefinition
        );
        await this.appendDistributionSnapshot(
          jobDefinitionId,
          'refresh',
          request,
          transactionResult,
          manager
        );
      }
    );

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
