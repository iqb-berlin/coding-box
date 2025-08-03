import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { VariableBundle } from '../entities/variable-bundle.entity';
import { Variable } from '../entities/variable.entity';

@Injectable()
export class VariableBundleGroupService {
  private readonly logger = new Logger(VariableBundleGroupService.name);

  constructor(
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(Variable)
    private variableRepository: Repository<Variable>
  ) {}

  /**
   * Creates a new variable bundle
   * @param workspaceId The ID of the workspace
   * @param name The name of the variable bundle
   * @param description The description of the variable bundle
   * @param variableIds The IDs of the variables to include
   */
  async createVariableBundleGroup(
    workspaceId: number,
    name: string,
    description?: string,
    variableIds: number[] = []
  ): Promise<VariableBundle> {
    this.logger.log(`Creating variable bundle "${name}" for workspace ${workspaceId}`);

    // Create the variable bundle
    const variableBundle = this.variableBundleRepository.create({
      workspaceId,
      name,
      description
    });

    // Save the variable bundle to get an ID
    const savedBundle = await this.variableBundleRepository.save(variableBundle);

    // If variables are specified, associate them with the variable bundle
    if (variableIds.length > 0) {
      const variables = await this.variableRepository.find({
        where: {
          id: In(variableIds),
          workspaceId
        }
      });
      savedBundle.variables = variables;
      await this.variableBundleRepository.save(savedBundle);
    }

    return savedBundle;
  }

  /**
   * Gets a variable bundle by ID
   * @param workspaceId The ID of the workspace
   * @param id The ID of the variable bundle
   */
  async getVariableBundleGroup(workspaceId: number, id: number): Promise<VariableBundle | undefined> {
    this.logger.log(`Getting variable bundle ${id} for workspace ${workspaceId}`);

    return this.variableBundleRepository.findOne({
      where: {
        id,
        workspaceId
      },
      relations: ['variables', 'codingJobs']
    });
  }

  /**
   * Gets all variable bundles for a workspace
   * @param workspaceId The ID of the workspace
   * @param options Pagination options
   */
  async getVariableBundleGroups(
    workspaceId: number,
    options?: { page: number; limit: number }
  ): Promise<[VariableBundle[], number]> {
    this.logger.log(`Getting variable bundles for workspace ${workspaceId}`);

    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const [bundles, total] = await this.variableBundleRepository.findAndCount({
          where: { workspaceId },
          skip: (validPage - 1) * validLimit,
          take: validLimit,
          order: { id: 'ASC' },
          relations: ['variables', 'codingJobs']
        });

        this.logger.log(`Found ${bundles.length} variable bundle(s) (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ID: ${workspaceId}`);
        return [bundles, total];
      }

      const bundles = await this.variableBundleRepository.find({
        where: { workspaceId },
        order: { id: 'ASC' },
        relations: ['variables', 'codingJobs']
      });

      this.logger.log(`Found ${bundles.length} variable bundle(s) for workspace ID: ${workspaceId}`);
      return [bundles, bundles.length];
    } catch (error) {
      this.logger.error(`Failed to retrieve variable bundles for workspace ID: ${workspaceId}`, error.stack);
      throw new Error('Could not retrieve variable bundles');
    }
  }

  /**
   * Updates a variable bundle
   * @param workspaceId The ID of the workspace
   * @param id The ID of the variable bundle
   * @param name The name of the variable bundle
   * @param description The description of the variable bundle
   * @param variableIds The IDs of the variables to include
   */
  async updateVariableBundleGroup(
    workspaceId: number,
    id: number,
    name?: string,
    description?: string,
    variableIds?: number[]
  ): Promise<VariableBundle | undefined> {
    this.logger.log(`Updating variable bundle ${id} for workspace ${workspaceId}`);

    // Get the variable bundle
    const variableBundle = await this.variableBundleRepository.findOne({
      where: {
        id,
        workspaceId
      },
      relations: ['variables', 'codingJobs']
    });

    if (!variableBundle) {
      this.logger.warn(`Variable bundle ${id} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Update the variable bundle properties
    if (name !== undefined) {
      variableBundle.name = name;
    }
    if (description !== undefined) {
      variableBundle.description = description;
    }

    // If variables are specified, update the association
    if (variableIds !== undefined) {
      const variables = await this.variableRepository.find({
        where: {
          id: In(variableIds),
          workspaceId
        }
      });
      variableBundle.variables = variables;
    }

    // Save the updated variable bundle
    return this.variableBundleRepository.save(variableBundle);
  }

  /**
   * Deletes a variable bundle
   * @param workspaceId The ID of the workspace
   * @param id The ID of the variable bundle
   */
  async deleteVariableBundleGroup(workspaceId: number, id: number): Promise<boolean> {
    this.logger.log(`Deleting variable bundle ${id} for workspace ${workspaceId}`);

    const result = await this.variableBundleRepository.delete({
      id,
      workspaceId
    });

    return result.affected > 0;
  }

  /**
   * Adds a variable to a variable bundle
   * @param workspaceId The ID of the workspace
   * @param bundleId The ID of the variable bundle
   * @param variableId The ID of the variable
   */
  async addVariableBundleToGroup(
    workspaceId: number,
    bundleId: number,
    variableId: number
  ): Promise<VariableBundle | undefined> {
    this.logger.log(`Adding variable ${variableId} to bundle ${bundleId} for workspace ${workspaceId}`);

    // Get the variable bundle
    const variableBundle = await this.variableBundleRepository.findOne({
      where: {
        id: bundleId,
        workspaceId
      },
      relations: ['variables']
    });

    if (!variableBundle) {
      this.logger.warn(`Variable bundle ${bundleId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Get the variable
    const variable = await this.variableRepository.findOne({
      where: {
        id: variableId,
        workspaceId
      }
    });

    if (!variable) {
      this.logger.warn(`Variable ${variableId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Check if the variable is already in the bundle
    const isAlreadyInBundle = variableBundle.variables.some(v => v.id === variableId);
    if (isAlreadyInBundle) {
      this.logger.log(`Variable ${variableId} is already in bundle ${bundleId}`);
      return variableBundle;
    }

    // Add the variable to the bundle
    variableBundle.variables.push(variable);

    // Save the updated variable bundle
    return this.variableBundleRepository.save(variableBundle);
  }

  /**
   * Removes a variable from a variable bundle
   * @param workspaceId The ID of the workspace
   * @param bundleId The ID of the variable bundle
   * @param variableId The ID of the variable
   */
  async removeVariableBundleFromGroup(
    workspaceId: number,
    bundleId: number,
    variableId: number
  ): Promise<VariableBundle | undefined> {
    this.logger.log(`Removing variable ${variableId} from bundle ${bundleId} for workspace ${workspaceId}`);

    // Get the variable bundle
    const variableBundle = await this.variableBundleRepository.findOne({
      where: {
        id: bundleId,
        workspaceId
      },
      relations: ['variables']
    });

    if (!variableBundle) {
      this.logger.warn(`Variable bundle ${bundleId} not found for workspace ${workspaceId}`);
      return undefined;
    }

    // Remove the variable from the bundle
    variableBundle.variables = variableBundle.variables.filter(v => v.id !== variableId);

    // Save the updated variable bundle
    return this.variableBundleRepository.save(variableBundle);
  }
}
