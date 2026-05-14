import {
  Injectable, NotFoundException, BadRequestException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  JobDefinition, JobDefinitionVariable, JobDefinitionVariableBundle, CaseOrderingMode
} from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import User from '../../entities/user.entity';
import { CodingJobService } from '../coding/coding-job.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { CreateJobDefinitionDto } from '../../../admin/coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../../../admin/coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../../../admin/coding-job/dto/approve-job-definition.dto';

type JobDefinitionBundleForUsage = JobDefinitionVariableBundle & {
  variables?: JobDefinitionVariable[];
};

type HydratedJobDefinitionVariableBundle = JobDefinitionVariableBundle & {
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
  variables?: JobDefinitionVariable[];
};

interface JobDefinitionForUsage {
  id?: number;
  assigned_variables?: JobDefinitionVariable[];
  assigned_variable_bundles?: JobDefinitionBundleForUsage[];
  max_coding_cases?: number;
}

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
    assignedVariables: JobDefinitionVariable[],
    assignedVariableBundles: JobDefinitionVariableBundle[],
    maxCodingCases?: number,
    excludeJobDefinitionId?: number,
    requireAssignedBundles = false
  ): Promise<string[]> {
    const hydratedAssignedBundles = await this.hydrateVariableBundles(
      assignedVariableBundles,
      requireAssignedBundles
    );
    const incompleteVariables = await this.codingValidationService.getCodingIncompleteVariables(workspaceId);
    const availableCasesByVariable = new Map(
      incompleteVariables.map(variable => [
        this.makeVariableKey(variable.unitName, variable.variableId),
        variable.availableCases
      ])
    );

    const requestedUsage = this.calculateDefinitionVariableUsage(
      {
        assigned_variables: assignedVariables || [],
        assigned_variable_bundles: hydratedAssignedBundles,
        max_coding_cases: maxCodingCases
      },
      availableCasesByVariable
    );

    const existingDefinitions = await this.jobDefinitionRepository.find({
      where: { workspace_id: workspaceId }
    });

    const reservedCases = new Map<string, number>();

    for (const definition of existingDefinitions) {
      if (definition.id === excludeJobDefinitionId) {
        continue;
      }

      const hydratedBundles = await this.hydrateVariableBundles(definition.assigned_variable_bundles || []);
      const usage = this.calculateDefinitionVariableUsage(
        {
          id: definition.id,
          assigned_variables: definition.assigned_variables || [],
          assigned_variable_bundles: hydratedBundles,
          max_coding_cases: definition.max_coding_cases
        },
        availableCasesByVariable
      );

      usage.forEach((usageCount, variableKey) => {
        reservedCases.set(variableKey, (reservedCases.get(variableKey) || 0) + usageCount);
      });
    }

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

  private calculateDefinitionVariableUsage(
    definition: JobDefinitionForUsage,
    availableCasesByVariable: Map<string, number>
  ): Map<string, number> {
    const usageByVariable = new Map<string, number>();
    const assignedBundles = definition.assigned_variable_bundles || [];
    const assignedVariables = definition.assigned_variables || [];
    const itemsCount = assignedBundles.length + assignedVariables.length;
    const maxCodingCases = definition.max_coding_cases;
    let currentItemIndex = 0;

    const addUsage = (variable: JobDefinitionVariable, usage: number) => {
      const key = this.makeVariableKey(variable.unitName, variable.variableId);
      usageByVariable.set(key, (usageByVariable.get(key) || 0) + usage);
    };

    const getAvailableCases = (variable: JobDefinitionVariable): number => availableCasesByVariable.get(
      this.makeVariableKey(variable.unitName, variable.variableId)
    ) || 0;

    const getQuotaForCurrentItem = (): number | undefined => {
      if (typeof maxCodingCases !== 'number' || maxCodingCases <= 0 || itemsCount === 0) {
        return undefined;
      }

      const baseQuota = Math.floor(maxCodingCases / itemsCount);
      const remainder = maxCodingCases % itemsCount;
      return baseQuota + (currentItemIndex < remainder ? 1 : 0);
    };

    assignedBundles.forEach(bundle => {
      const bundleVariables = bundle.variables || [];
      const quota = getQuotaForCurrentItem();
      const bundleUsage = quota ?? bundleVariables.reduce((sum, variable) => sum + getAvailableCases(variable), 0);

      if (bundleVariables.length > 0) {
        const usagePerVariable = Math.ceil(bundleUsage / bundleVariables.length);
        bundleVariables.forEach(variable => addUsage(variable, usagePerVariable));
      }

      currentItemIndex += 1;
    });

    assignedVariables.forEach(variable => {
      const quota = getQuotaForCurrentItem();
      const variableUsage = quota ?? getAvailableCases(variable);

      addUsage(variable, variableUsage);

      currentItemIndex += 1;
    });

    return usageByVariable;
  }

  async createJobDefinition(createDto: CreateJobDefinitionDto, workspaceId: number): Promise<JobDefinition> {
    this.validateDefinitionState({
      status: createDto.status ?? 'draft',
      assignedVariables: createDto.assignedVariables,
      assignedVariableBundles: createDto.assignedVariableBundles,
      assignedCoders: createDto.assignedCoders,
      durationSeconds: createDto.durationSeconds,
      maxCodingCases: createDto.maxCodingCases,
      doubleCodingAbsolute: createDto.doubleCodingAbsolute,
      doubleCodingPercentage: createDto.doubleCodingPercentage,
      caseOrderingMode: createDto.caseOrderingMode
    });

    const conflicts = await this.checkVariableConflicts(
      workspaceId,
      createDto.assignedVariables || [],
      createDto.assignedVariableBundles || [],
      createDto.maxCodingCases,
      undefined,
      true
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
      assigned_coders: createDto.assignedCoders,
      duration_seconds: createDto.durationSeconds,
      max_coding_cases: createDto.maxCodingCases,
      double_coding_absolute: createDto.doubleCodingAbsolute,
      double_coding_percentage: createDto.doubleCodingPercentage,
      case_ordering_mode: createDto.caseOrderingMode
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

  async getJobDefinitions(workspaceId?: number): Promise<JobDefinition[]> {
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

    return definitions;
  }

  async updateJobDefinition(id: number, updateDto: UpdateJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);
    const nextState: JobDefinitionValidationState = {
      status: updateDto.status ?? jobDefinition.status,
      assignedVariables: updateDto.assignedVariables ?? jobDefinition.assigned_variables ?? [],
      assignedVariableBundles: updateDto.assignedVariableBundles ?? jobDefinition.assigned_variable_bundles ?? [],
      assignedCoders: updateDto.assignedCoders ?? jobDefinition.assigned_coders ?? [],
      durationSeconds: updateDto.durationSeconds ?? jobDefinition.duration_seconds,
      maxCodingCases: updateDto.maxCodingCases ?? jobDefinition.max_coding_cases,
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
      updateDto.maxCodingCases !== undefined
    ) {
      const variablesToCheck = updateDto.assignedVariables !== undefined ?
        updateDto.assignedVariables :
        jobDefinition.assigned_variables || [];
      const bundlesToCheck = updateDto.assignedVariableBundles !== undefined ?
        updateDto.assignedVariableBundles :
        jobDefinition.assigned_variable_bundles || [];
      const maxCodingCasesToCheck = updateDto.maxCodingCases !== undefined ?
        updateDto.maxCodingCases :
        jobDefinition.max_coding_cases;

      const conflicts = await this.checkVariableConflicts(
        jobDefinition.workspace_id,
        variablesToCheck,
        bundlesToCheck,
        maxCodingCasesToCheck,
        id,
        updateDto.assignedVariableBundles !== undefined
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
        max_coding_cases: nextState.maxCodingCases
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
      jobDefinition.assigned_coders = updateDto.assignedCoders;
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

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  async approveJobDefinition(id: number, approveDto: ApproveJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);

    this.validateStatusTransition(jobDefinition.status, approveDto.status);
    this.validateDefinitionState({
      status: approveDto.status,
      assignedVariables: jobDefinition.assigned_variables || [],
      assignedVariableBundles: jobDefinition.assigned_variable_bundles || [],
      assignedCoders: jobDefinition.assigned_coders || [],
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
      jobDefinition.assigned_variables || [],
      jobDefinition.assigned_variable_bundles || [],
      jobDefinition.max_coding_cases,
      jobDefinition.id
    );

    if (unavailableVariables.length > 0) {
      throw new BadRequestException(
        `Cannot approve job definition: The following variables have no remaining cases: ${unavailableVariables.join(', ')}`
      );
    }
  }

  async deleteJobDefinition(id: number): Promise<void> {
    const jobDefinition = await this.getJobDefinition(id);
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

  async createCodingJobFromDefinition(jobDefinitionId: number, workspaceId: number) {
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

    const bundleVariables = fullVariableBundles.flatMap(bundle => bundle.variables || []);
    const bundleVariableKeys = new Set(bundleVariables.map(v => `${v.unitName}-${v.variableId}`));

    const filteredVariables = (jobDefinition.assigned_variables || []).filter(v => !bundleVariableKeys.has(`${v.unitName}-${v.variableId}`)
    );

    const savedBundleModes = new Map(
      (jobDefinition.assigned_variable_bundles || [])
        .map(bundle => [bundle.id, bundle.caseOrderingMode])
    );
    const selectedVariableBundles = fullVariableBundles.map(bundle => ({
      id: bundle.id,
      name: bundle.name,
      variables: bundle.variables || [],
      caseOrderingMode: savedBundleModes.get(bundle.id)
    }));
    const assignedCoderIds = jobDefinition.assigned_coders || [];
    const assignedUsers = assignedCoderIds.length > 0 ?
      await this.usersRepository.find({ where: { id: In(assignedCoderIds) } }) :
      [];
    const assignedUsersById = new Map(assignedUsers.map(user => [user.id, user]));
    const selectedCoders = assignedCoderIds.map(coderId => {
      const username = assignedUsersById.get(coderId)?.username || `Coder ${coderId}`;
      return {
        id: coderId,
        name: username,
        username
      };
    });

    return this.codingJobService.createDistributedCodingJobs(workspaceId, {
      selectedVariables: filteredVariables,
      selectedVariableBundles,
      selectedCoders,
      doubleCodingAbsolute: jobDefinition.double_coding_absolute,
      doubleCodingPercentage: this.toOptionalNumber(jobDefinition.double_coding_percentage),
      caseOrderingMode: jobDefinition.case_ordering_mode,
      maxCodingCases: jobDefinition.max_coding_cases,
      jobDefinitionId
    });
  }
}
