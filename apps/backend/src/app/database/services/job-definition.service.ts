import {
  Injectable, NotFoundException, BadRequestException, forwardRef, Inject
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JobDefinition, JobDefinitionVariable, JobDefinitionVariableBundle } from '../entities/job-definition.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { CodingJobService } from './coding-job.service';
import { CreateJobDefinitionDto } from '../../admin/coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../../admin/coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../../admin/coding-job/dto/approve-job-definition.dto';
import { WorkspaceCodingService } from './workspace-coding.service';

@Injectable()
export class JobDefinitionService {
  constructor(
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    private codingJobService: CodingJobService,
    @Inject(forwardRef(() => WorkspaceCodingService))
    private workspaceCodingService: WorkspaceCodingService
  ) {}

  private async checkVariableConflicts(
    workspaceId: number,
    assignedVariables: JobDefinitionVariable[],
    assignedVariableBundles: JobDefinitionVariableBundle[],
    excludeDefinitionId?: number
  ): Promise<string[]> {
    const queryBuilder = this.jobDefinitionRepository.createQueryBuilder('definition')
      .where('definition.workspace_id = :workspaceId', { workspaceId });

    if (excludeDefinitionId) {
      queryBuilder.andWhere('definition.id != :excludeDefinitionId', { excludeDefinitionId });
    }

    const existingDefinitions = await queryBuilder.getMany();

    const newVariables = new Set<string>();

    if (assignedVariables) {
      assignedVariables.forEach(variable => {
        newVariables.add(`${variable.unitName}:${variable.variableId}`);
      });
    }

    if (assignedVariableBundles) {
      const bundleIds = assignedVariableBundles.map(bundle => bundle.id);
      if (bundleIds.length > 0) {
        const variableBundles = await this.variableBundleRepository.find({
          where: { id: In(bundleIds) }
        });

        variableBundles.forEach(bundle => {
          if (bundle.variables) {
            bundle.variables.forEach(variable => {
              newVariables.add(`${variable.unitName}:${variable.variableId}`);
            });
          }
        });
      }
    }

    const conflictingVariables: string[] = [];

    for (const existingDefinition of existingDefinitions) {
      const existingVariables = new Set<string>();

      if (existingDefinition.assigned_variables) {
        existingDefinition.assigned_variables.forEach(variable => {
          existingVariables.add(`${variable.unitName}:${variable.variableId}`);
        });
      }

      if (existingDefinition.assigned_variable_bundles) {
        const bundleIds = existingDefinition.assigned_variable_bundles.map(bundle => bundle.id);
        if (bundleIds.length > 0) {
          const variableBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });

          variableBundles.forEach(bundle => {
            if (bundle.variables) {
              bundle.variables.forEach(variable => {
                existingVariables.add(`${variable.unitName}:${variable.variableId}`);
              });
            }
          });
        }
      }

      newVariables.forEach(variableKey => {
        if (existingVariables.has(variableKey) && !conflictingVariables.includes(variableKey)) {
          conflictingVariables.push(variableKey);
        }
      });
    }

    return conflictingVariables;
  }

  async createJobDefinition(createDto: CreateJobDefinitionDto, workspaceId: number): Promise<JobDefinition> {
    const conflicts = await this.checkVariableConflicts(
      workspaceId,
      createDto.assignedVariables || [],
      createDto.assignedVariableBundles || []
    );

    if (conflicts.length > 0) {
      throw new BadRequestException(
        `The following variables are already assigned to other job definitions in this workspace: ${conflicts.join(', ')}`
      );
    }

    const jobDefinition = this.jobDefinitionRepository.create({
      workspace_id: workspaceId,
      status: createDto.status ?? 'draft',
      assigned_variables: createDto.assignedVariables,
      assigned_variable_bundles: createDto.assignedVariableBundles?.map(bundle => ({
        id: bundle.id,
        name: bundle.name
      })),
      assigned_coders: createDto.assignedCoders,
      duration_seconds: createDto.durationSeconds,
      max_coding_cases: createDto.maxCodingCases,
      double_coding_absolute: createDto.doubleCodingAbsolute,
      double_coding_percentage: createDto.doubleCodingPercentage
    });

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  async getJobDefinition(id: number): Promise<JobDefinition> {
    const jobDefinition = await this.jobDefinitionRepository.findOne({
      where: { id }
    });

    if (!jobDefinition) {
      throw new NotFoundException(`Job definition with ID ${id} not found`);
    }

    if (jobDefinition.assigned_variable_bundles && jobDefinition.assigned_variable_bundles.length > 0) {
      const bundleIds = jobDefinition.assigned_variable_bundles.map(b => b.id);
      const fullBundles = await this.variableBundleRepository.find({
        where: { id: In(bundleIds) }
      });
      jobDefinition.assigned_variable_bundles = fullBundles.map(bundle => ({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        createdAt: bundle.created_at,
        updatedAt: bundle.updated_at,
        variables: bundle.variables
      }));
      if (fullBundles.length < bundleIds.length) {
        await this.jobDefinitionRepository.save(jobDefinition);
      }
    }

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
      if (definition.assigned_variable_bundles && definition.assigned_variable_bundles.length > 0) {
        const bundleIds = definition.assigned_variable_bundles.map(b => b.id);
        const fullBundles = await this.variableBundleRepository.find({
          where: { id: In(bundleIds) }
        });
        definition.assigned_variable_bundles = fullBundles.map(bundle => ({
          id: bundle.id,
          name: bundle.name,
          description: bundle.description,
          createdAt: bundle.created_at,
          updatedAt: bundle.updated_at,
          variables: bundle.variables
        }));
      }
    }

    return definitions;
  }

  async updateJobDefinition(id: number, updateDto: UpdateJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);

    if (updateDto.assignedVariables !== undefined || updateDto.assignedVariableBundles !== undefined) {
      const variablesToCheck = updateDto.assignedVariables !== undefined ?
        updateDto.assignedVariables :
        jobDefinition.assigned_variables || [];
      const bundlesToCheck = updateDto.assignedVariableBundles !== undefined ?
        updateDto.assignedVariableBundles :
        jobDefinition.assigned_variable_bundles || [];

      const conflicts = await this.checkVariableConflicts(
        jobDefinition.workspace_id,
        variablesToCheck,
        bundlesToCheck,
        id
      );

      if (conflicts.length > 0) {
        throw new BadRequestException(
          `The following variables are already assigned to other job definitions in this workspace: ${conflicts.join(', ')}`
        );
      }
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
        name: bundle.name
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

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  async approveJobDefinition(id: number, approveDto: ApproveJobDefinitionDto): Promise<JobDefinition> {
    const jobDefinition = await this.getJobDefinition(id);

    if (approveDto.status === 'pending_review' && jobDefinition.status === 'draft') {
      jobDefinition.status = 'pending_review';
    } else if (approveDto.status === 'approved' && ['draft', 'pending_review'].includes(jobDefinition.status)) {
      jobDefinition.status = 'approved';
    } else {
      throw new Error(`Invalid status transition from ${jobDefinition.status} to ${approveDto.status}`);
    }

    const savedDefinition = await this.jobDefinitionRepository.save(jobDefinition);
    return savedDefinition;
  }

  async deleteJobDefinition(id: number): Promise<void> {
    const jobDefinition = await this.getJobDefinition(id);
    await this.jobDefinitionRepository.remove(jobDefinition);
  }

  async getApprovedJobDefinitions(workspaceId?: number): Promise<JobDefinition[]> {
    if (workspaceId) {
      return this.jobDefinitionRepository.find({
        where: {
          status: 'approved' as const,
          workspace_id: workspaceId
        },
        order: { created_at: 'DESC' }
      });
    }
    return this.jobDefinitionRepository.find({
      where: {
        status: 'approved' as const
      },
      order: { created_at: 'DESC' }
    });
  }

  async createCodingJobFromDefinition(jobDefinitionId: number, workspaceId: number) {
    const jobDefinition = await this.getJobDefinition(jobDefinitionId);

    if (jobDefinition.status !== 'approved') {
      throw new Error('Only approved job definitions can be used to create coding jobs');
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

    const codingJobData = {
      name: `Coding Job from Definition ${jobDefinitionId}`,
      status: 'pending',
      variables: filteredVariables,
      variableBundles: fullVariableBundles,
      assignedCoders: jobDefinition.assigned_coders || [],
      durationSeconds: jobDefinition.duration_seconds,
      doubleCodingAbsolute: jobDefinition.double_coding_absolute,
      doubleCodingPercentage: jobDefinition.double_coding_percentage
    };

    return this.codingJobService.createCodingJob(workspaceId, {
      ...codingJobData,
      jobDefinitionId: jobDefinitionId
    });
  }
}
