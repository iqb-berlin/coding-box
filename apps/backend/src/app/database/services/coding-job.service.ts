import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CodingJob } from '../entities/coding-job.entity';
import { Variable } from '../entities/variable.entity';
import { VariableBundle } from '../entities/variable-bundle.entity';
import WorkspaceUser from '../entities/workspace_user.entity';

@Injectable()
export class CodingJobService {
  private readonly logger = new Logger(CodingJobService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(Variable)
    private variableBundleRepository: Repository<Variable>,
    @InjectRepository(VariableBundle)
    private variableBundleGroupRepository: Repository<VariableBundle>,
    @InjectRepository(WorkspaceUser)
    private workspaceUserRepository: Repository<WorkspaceUser>
  ) {}

  /**
   * Creates a new coding job
   * @param workspaceId The ID of the workspace
   * @param name The name of the coding job
   * @param description The description of the coding job
   * @param variableBundleIds The IDs of the variable bundles to include
   * @param variableBundleGroupIds The IDs of the variable bundle groups to include
   */
  async createCodingJob(
    workspaceId: number,
    name: string,
    description?: string,
    variableBundleIds: number[] = [],
    variableBundleGroupIds: number[] = []
  ): Promise<CodingJob> {
    this.logger.log(`Creating coding job "${name}" for workspace ${workspaceId}`);

    // Create the coding job
    const codingJob = this.codingJobRepository.create({
      workspace_id: workspaceId,
      name,
      description,
      status: 'pending'
    });

    // Save the coding job to get an ID
    const savedCodingJob = await this.codingJobRepository.save(codingJob);

    // If variable bundles are specified, associate them with the coding job
    if (variableBundleIds.length > 0) {
      const variableBundles = await this.variableBundleRepository.find({
        where: {
          id: In(variableBundleIds),
          workspaceId
        }
      });
      savedCodingJob.variables = variableBundles;
    }

    // If variable bundle groups are specified, associate them with the coding job
    if (variableBundleGroupIds.length > 0) {
      const variableBundleGroups = await this.variableBundleGroupRepository.find({
        where: {
          id: In(variableBundleGroupIds),
          workspaceId
        }
      });
      savedCodingJob.variableBundles = variableBundleGroups;
    }

    // Save the coding job with the associations
    return this.codingJobRepository.save(savedCodingJob);
  }

  /**
   * Gets a coding job by ID
   * @param workspaceId The ID of the workspace
   * @param id The ID of the coding job
   */
  async getCodingJob(workspaceId: number, id: number): Promise<CodingJob | undefined> {
    this.logger.log(`Getting coding job ${id} for workspace ${workspaceId}`);

    return this.codingJobRepository.findOne({
      where: {
        id,
        workspace_id: workspaceId
      },
      relations: ['variables', 'variableBundles', 'assignedCoders']
    });
  }

  /**
   * Gets all coding jobs for a workspace
   * @param workspaceId The ID of the workspace
   * @param options Pagination options
   */
  async getCodingJobs(
    workspaceId: number,
    options?: { page: number; limit: number }
  ): Promise<[CodingJob[], number]> {
    this.logger.log(`Getting coding jobs for workspace ${workspaceId}`);

    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const [jobs, total] = await this.codingJobRepository.findAndCount({
          where: { workspace_id: workspaceId },
          skip: (validPage - 1) * validLimit,
          take: validLimit,
          order: { id: 'ASC' },
          relations: ['variables', 'variableBundles', 'assignedCoders']
        });

        this.logger.log(`Found ${jobs.length} coding job(s) (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ID: ${workspaceId}`);
        return [jobs, total];
      }

      const jobs = await this.codingJobRepository.find({
        where: { workspace_id: workspaceId },
        order: { id: 'ASC' },
        relations: ['variables', 'variableBundles', 'assignedCoders']
      });

      this.logger.log(`Found ${jobs.length} coding job(s) for workspace ID: ${workspaceId}`);
      return [jobs, jobs.length];
    } catch (error) {
      this.logger.error(`Failed to retrieve coding jobs for workspace ID: ${workspaceId}`, error.stack);
      throw new Error('Could not retrieve coding jobs');
    }
  }

  /**
   * Updates a coding job
   * @param workspaceId The ID of the workspace
   * @param id The ID of the coding job
   * @param name The name of the coding job
   * @param description The description of the coding job
   * @param status The status of the coding job
   * @param variableBundleIds The IDs of the variable bundles to include
   * @param variableBundleGroupIds The IDs of the variable bundle groups to include
   */
  async updateCodingJob(
    workspaceId: number,
    id: number,
    name?: string,
    description?: string,
    status?: string,
    variableBundleIds?: number[],
    variableBundleGroupIds?: number[]
  ): Promise<CodingJob | undefined> {
    this.logger.log(`Updating coding job ${id} for workspace ${workspaceId}`);

    // Get the coding job
    const codingJob = await this.codingJobRepository.findOne({
      where: {
        id,
        workspace_id: workspaceId
      },
      relations: ['variables', 'variableBundles', 'assignedCoders']
    });

    if (!codingJob) {
      this.logger.warn(`Coding job ${id} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Update the coding job properties
    if (name !== undefined) {
      codingJob.name = name;
    }
    if (description !== undefined) {
      codingJob.description = description;
    }
    if (status !== undefined) {
      codingJob.status = status;
    }

    // If variable bundles are specified, update the association
    if (variableBundleIds !== undefined) {
      const variableBundles = await this.variableBundleRepository.find({
        where: {
          id: In(variableBundleIds),
          workspaceId
        }
      });
      codingJob.variables = variableBundles;
    }

    // If variable bundle groups are specified, update the association
    if (variableBundleGroupIds !== undefined) {
      const variableBundleGroups = await this.variableBundleGroupRepository.find({
        where: {
          id: In(variableBundleGroupIds),
          workspaceId
        }
      });
      codingJob.variableBundles = variableBundleGroups;
    }

    // Save the updated coding job
    return this.codingJobRepository.save(codingJob);
  }

  /**
   * Deletes a coding job
   * @param workspaceId The ID of the workspace
   * @param id The ID of the coding job
   */
  async deleteCodingJob(workspaceId: number, id: number): Promise<boolean> {
    this.logger.log(`Deleting coding job ${id} for workspace ${workspaceId}`);

    const result = await this.codingJobRepository.delete({
      id,
      workspace_id: workspaceId
    });

    return result.affected > 0;
  }

  /**
   * Assigns a coder to a coding job
   * @param workspaceId The ID of the workspace
   * @param codingJobId The ID of the coding job
   * @param coderId The ID of the coder
   */
  async assignCoder(workspaceId: number, codingJobId: number, coderId: number): Promise<CodingJob | undefined> {
    this.logger.log(`Assigning coder ${coderId} to coding job ${codingJobId} for workspace ${workspaceId}`);

    // Get the coding job
    const codingJob = await this.codingJobRepository.findOne({
      where: {
        id: codingJobId,
        workspace_id: workspaceId
      },
      relations: ['assignedCoders']
    });

    if (!codingJob) {
      this.logger.warn(`Coding job ${codingJobId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Get the coder
    const coder = await this.workspaceUserRepository.findOne({
      where: {
        userId: coderId,
        workspaceId,
        accessLevel: 1 // Ensure the user is a coder
      }
    });

    if (!coder) {
      this.logger.warn(`Coder ${coderId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Check if the coder is already assigned to the coding job
    const isAlreadyAssigned = codingJob.assignedCoders.some(c => c.userId === coderId);
    if (isAlreadyAssigned) {
      this.logger.log(`Coder ${coderId} is already assigned to coding job ${codingJobId}`);
      return codingJob;
    }

    // Assign the coder to the coding job
    codingJob.assignedCoders.push(coder);

    // Save the updated coding job
    return this.codingJobRepository.save(codingJob);
  }

  /**
   * Unassigns a coder from a coding job
   * @param workspaceId The ID of the workspace
   * @param codingJobId The ID of the coding job
   * @param coderId The ID of the coder
   */
  async unassignCoder(workspaceId: number, codingJobId: number, coderId: number): Promise<CodingJob | undefined> {
    this.logger.log(`Unassigning coder ${coderId} from coding job ${codingJobId} for workspace ${workspaceId}`);

    // Get the coding job
    const codingJob = await this.codingJobRepository.findOne({
      where: {
        id: codingJobId,
        workspace_id: workspaceId
      },
      relations: ['assignedCoders']
    });

    if (!codingJob) {
      this.logger.warn(`Coding job ${codingJobId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Remove the coder from the coding job
    codingJob.assignedCoders = codingJob.assignedCoders.filter(c => c.userId !== coderId);

    // Save the updated coding job
    return this.codingJobRepository.save(codingJob);
  }

  /**
   * Gets all coding jobs assigned to a coder
   * @param workspaceId The ID of the workspace
   * @param coderId The ID of the coder
   */
  async getCodingJobsByCoder(workspaceId: number, coderId: number): Promise<CodingJob[]> {
    this.logger.log(`Getting coding jobs for coder ${coderId} in workspace ${workspaceId}`);

    const codingJobs = await this.codingJobRepository
      .createQueryBuilder('codingJob')
      .innerJoin('codingJob.assignedCoders', 'coder')
      .where('codingJob.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coder.userId = :coderId', { coderId })
      .getMany();

    this.logger.log(`Found ${codingJobs.length} coding job(s) for coder ${coderId} in workspace ${workspaceId}`);
    return codingJobs;
  }
}
