import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { CodingJobCoder } from '../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../entities/coding-job-variable-bundle.entity';
import { CreateCodingJobDto } from '../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../entities/variable-bundle.entity';

/**
 * Service for managing coding jobs
 */
@Injectable()
export class CodingJobService {
  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>
  ) {}

  /**
   * Get coding jobs for a workspace with pagination
   * @param workspaceId The ID of the workspace
   * @param page The page number (1-based)
   * @param limit The number of items per page
   * @returns Paginated coding jobs with metadata, assigned coders, variables, and variable bundles
   */
  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: (CodingJob & {
      assignedCoders?: number[];
      assignedVariables?: string[];
      assignedVariableBundles?: string[]
    })[]; total: number; page: number; limit: number }> {
    const validPage = page > 0 ? page : 1;
    const validLimit = limit > 0 ? limit : 10;

    const skip = (validPage - 1) * validLimit;

    const total = await this.codingJobRepository.count({
      where: { workspace_id: workspaceId }
    });

    const jobs = await this.codingJobRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' },
      skip,
      take: validLimit
    });

    const jobIds = jobs.map(job => job.id);

    const [allCoders, allVariables, variableBundleEntities] = await Promise.all([
      this.codingJobCoderRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableRepository.find({
        where: { coding_job_id: In(jobIds) }
      }),
      this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: In(jobIds) },
        relations: ['variable_bundle']
      })
    ]);

    const codersByJobId = new Map<number, number[]>();
    allCoders.forEach(coder => {
      if (!codersByJobId.has(coder.coding_job_id)) {
        codersByJobId.set(coder.coding_job_id, []);
      }
      codersByJobId.get(coder.coding_job_id)!.push(coder.user_id);
    });

    const variablesByJobId = new Map<number, string[]>();
    allVariables.forEach(variable => {
      if (!variablesByJobId.has(variable.coding_job_id)) {
        variablesByJobId.set(variable.coding_job_id, []);
      }
      variablesByJobId.get(variable.coding_job_id)!.push(variable.variable_id);
    });

    const variableBundlesByJobId = new Map<number, string[]>();
    variableBundleEntities.forEach(bundleAssignment => {
      if (!variableBundlesByJobId.has(bundleAssignment.coding_job_id)) {
        variableBundlesByJobId.set(bundleAssignment.coding_job_id, []);
      }
      if (bundleAssignment.variable_bundle?.name) {
        variableBundlesByJobId.get(bundleAssignment.coding_job_id)!.push(bundleAssignment.variable_bundle.name);
      }
    });

    const data = jobs.map(job => ({
      ...job,
      assignedCoders: codersByJobId.get(job.id) || [],
      assignedVariables: variablesByJobId.get(job.id) || [],
      assignedVariableBundles: variableBundlesByJobId.get(job.id) || []
    }));
    console.log(data);
    return {
      data,
      total,
      page: validPage,
      limit: validLimit
    };
  }

  /**
   * Get a coding job by ID
   * @param id The ID of the coding job
   * @param workspaceId Optional workspace ID to filter by
   * @returns The coding job with its relations
   * @throws NotFoundException if the coding job is not found
   */
  async getCodingJob(id: number, workspaceId?: number): Promise<{
    codingJob: CodingJob;
    assignedCoders: number[];
    variables: { unitName: string; variableId: string }[];
    variableBundles: VariableBundle[];
  }> {
    const whereClause: { id: number; workspace_id?: number } = { id };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const codingJob = await this.codingJobRepository.findOne({ where: whereClause });
    if (!codingJob) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(`Coding job with ID ${id} not found in workspace ${workspaceId}`);
      } else {
        throw new NotFoundException(`Coding job with ID ${id} not found`);
      }
    }

    // Get assigned coders
    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    // Get variables
    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    const variables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    // Get variable bundles
    const codingJobVariableBundles = await this.codingJobVariableBundleRepository.find({
      where: { coding_job_id: id }
    });
    const variableBundleIds = codingJobVariableBundles.map(bundle => bundle.variable_bundle_id);
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(variableBundleIds) }
    });

    return {
      codingJob,
      assignedCoders,
      variables,
      variableBundles
    };
  }

  /**
   * Create a new coding job
   * @param workspaceId The ID of the workspace
   * @param createCodingJobDto The coding job data
   * @returns The created coding job
   */
  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> {
    // Create the coding job
    const codingJob = this.codingJobRepository.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending'
    });

    // Save the coding job
    const savedCodingJob = await this.codingJobRepository.save(codingJob);

    // Assign coders if provided
    if (createCodingJobDto.assignedCoders && createCodingJobDto.assignedCoders.length > 0) {
      await this.assignCoders(savedCodingJob.id, createCodingJobDto.assignedCoders);
    }

    // Assign variables if provided
    if (createCodingJobDto.variables && createCodingJobDto.variables.length > 0) {
      await this.assignVariables(savedCodingJob.id, createCodingJobDto.variables);
    }

    // Assign variable bundles if provided
    if (createCodingJobDto.variableBundleIds && createCodingJobDto.variableBundleIds.length > 0) {
      await this.assignVariableBundles(savedCodingJob.id, createCodingJobDto.variableBundleIds);
    } else if (createCodingJobDto.variableBundles && createCodingJobDto.variableBundles.length > 0) {
      // Handle variable bundles without IDs by using their variables directly
      if (createCodingJobDto.variableBundles[0].id) {
        // Extract IDs from variableBundles if they have IDs
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(savedCodingJob.id, bundleIds);
        }
      } else {
        // Otherwise, extract variables and assign them directly
        const variables = createCodingJobDto.variableBundles.flatMap(bundle => bundle.variables || []);
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables);
        }
      }
    }

    return savedCodingJob;
  }

  /**
   * Update a coding job
   * @param id The ID of the coding job
   * @param workspaceId The ID of the workspace
   * @param updateCodingJobDto The coding job data to update
   * @returns The updated coding job
   * @throws NotFoundException if the coding job is not found
   */
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
      codingJob.codingJob.status = updateCodingJobDto.status;
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

  /**
   * Delete a coding job
   * @param id The ID of the coding job
   * @param workspaceId The ID of the workspace
   * @returns Object with success flag
   * @throws NotFoundException if the coding job is not found
   */
  async deleteCodingJob(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const codingJob = await this.getCodingJob(id, workspaceId);

    // Delete the coding job (cascade will delete related entities)
    await this.codingJobRepository.remove(codingJob.codingJob);

    return { success: true };
  }

  /**
   * Assign coders to a coding job
   * @param codingJobId The ID of the coding job
   * @param userIds The IDs of the users to assign
   * @returns The created coding job coder relations
   */
  async assignCoders(codingJobId: number, userIds: number[]): Promise<CodingJobCoder[]> {
    // Remove existing coders first
    await this.codingJobCoderRepository.delete({ coding_job_id: codingJobId });

    // Create new coder assignments
    const coders = userIds.map(userId => this.codingJobCoderRepository.create({
      coding_job_id: codingJobId,
      user_id: userId
    }));

    return this.codingJobCoderRepository.save(coders);
  }

  /**
   * Assign variables to a coding job
   * @param codingJobId The ID of the coding job
   * @param variables The variables to assign
   * @returns The created coding job variable relations
   */
  private async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[]
  ): Promise<CodingJobVariable[]> {
    const codingJobVariables = variables.map(variable => this.codingJobVariableRepository.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    }));

    return this.codingJobVariableRepository.save(codingJobVariables);
  }

  /**
   * Assign variable bundles to a coding job
   * @param codingJobId The ID of the coding job
   * @param variableBundleIds The IDs of the variable bundles to assign
   * @returns The created coding job variable bundle relations
   */
  private async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[]
  ): Promise<CodingJobVariableBundle[]> {
    const variableBundles = variableBundleIds.map(variableBundleId => this.codingJobVariableBundleRepository.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    }));

    return this.codingJobVariableBundleRepository.save(variableBundles);
  }
}
