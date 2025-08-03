import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Variable } from '../entities/variable.entity';

@Injectable()
export class VariableBundleService {
  private readonly logger = new Logger(VariableBundleService.name);

  constructor(
    @InjectRepository(Variable)
    private variableRepository: Repository<Variable>
  ) {}

  /**
   * Creates a new variable
   * @param workspaceId The ID of the workspace
   * @param unitName The name of the unit
   * @param variableId The ID of the variable
   */
  async createVariableBundle(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<Variable> {
    this.logger.log(`Creating variable for workspace ${workspaceId}, unit ${unitName}, variable ${variableId}`);

    // Check if the variable already exists
    const existingVariable = await this.variableRepository.findOne({
      where: {
        workspaceId,
        unitName,
        variableId
      }
    });

    if (existingVariable) {
      this.logger.log(`Variable already exists for workspace ${workspaceId}, unit ${unitName}, variable ${variableId}`);
      return existingVariable;
    }

    // Create the variable
    const variable = this.variableRepository.create({
      workspaceId,
      unitName,
      variableId
    });

    // Save the variable
    return this.variableRepository.save(variable);
  }

  /**
   * Gets a variable by ID
   * @param workspaceId The ID of the workspace
   * @param id The ID of the variable
   */
  async getVariableBundle(workspaceId: number, id: number): Promise<Variable | undefined> {
    this.logger.log(`Getting variable ${id} for workspace ${workspaceId}`);

    return this.variableRepository.findOne({
      where: {
        id,
        workspaceId
      },
      relations: ['bundles', 'codingJobs']
    });
  }

  /**
   * Gets all variables for a workspace
   * @param workspaceId The ID of the workspace
   * @param options Pagination options
   */
  async getVariableBundles(
    workspaceId: number,
    options?: { page: number; limit: number }
  ): Promise<[Variable[], number]> {
    this.logger.log(`Getting variables for workspace ${workspaceId}`);

    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const [variables, total] = await this.variableRepository.findAndCount({
          where: { workspaceId },
          skip: (validPage - 1) * validLimit,
          take: validLimit,
          order: { id: 'ASC' },
          relations: ['bundles', 'codingJobs']
        });

        this.logger.log(`Found ${variables.length} variable(s) (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ID: ${workspaceId}`);
        return [variables, total];
      }

      const variables = await this.variableRepository.find({
        where: { workspaceId },
        order: { id: 'ASC' },
        relations: ['bundles', 'codingJobs']
      });

      this.logger.log(`Found ${variables.length} variable(s) for workspace ID: ${workspaceId}`);
      return [variables, variables.length];
    } catch (error) {
      this.logger.error(`Failed to retrieve variables for workspace ID: ${workspaceId}`, error.stack);
      throw new Error('Could not retrieve variables');
    }
  }

  /**
   * Gets a variable by unit name and variable ID
   * @param workspaceId The ID of the workspace
   * @param unitName The name of the unit
   * @param variableId The ID of the variable
   */
  async getVariableBundleByUnitAndVariable(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<Variable | undefined> {
    this.logger.log(`Getting variable for workspace ${workspaceId}, unit ${unitName}, variable ${variableId}`);

    return this.variableRepository.findOne({
      where: {
        workspaceId,
        unitName,
        variableId
      },
      relations: ['bundles', 'codingJobs']
    });
  }

  /**
   * Gets variables by IDs
   * @param workspaceId The ID of the workspace
   * @param ids The IDs of the variables
   */
  async getVariableBundlesByIds(
    workspaceId: number,
    ids: number[]
  ): Promise<Variable[]> {
    this.logger.log(`Getting variables with IDs ${ids.join(', ')} for workspace ${workspaceId}`);

    return this.variableRepository.find({
      where: {
        id: In(ids),
        workspaceId
      },
      relations: ['bundles', 'codingJobs']
    });
  }

  /**
   * Deletes a variable
   * @param workspaceId The ID of the workspace
   * @param id The ID of the variable
   */
  async deleteVariableBundle(workspaceId: number, id: number): Promise<boolean> {
    this.logger.log(`Deleting variable ${id} for workspace ${workspaceId}`);

    const result = await this.variableRepository.delete({
      id,
      workspaceId
    });

    return result.affected > 0;
  }

  /**
   * Deletes a variable by unit name and variable ID
   * @param workspaceId The ID of the workspace
   * @param unitName The name of the unit
   * @param variableId The ID of the variable
   */
  async deleteVariableBundleByUnitAndVariable(
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<boolean> {
    this.logger.log(`Deleting variable for workspace ${workspaceId}, unit ${unitName}, variable ${variableId}`);

    const result = await this.variableRepository.delete({
      workspaceId,
      unitName,
      variableId
    });

    return result.affected > 0;
  }
}
