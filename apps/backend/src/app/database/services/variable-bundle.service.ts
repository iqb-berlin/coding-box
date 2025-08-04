import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VariableBundle } from '../entities/variable-bundle.entity';

/**
 * Service for managing variable bundles
 */
@Injectable()
export class VariableBundleService {
  constructor(
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>
  ) {}

  /**
   * Get all variable bundles for a workspace
   * @param workspaceId The ID of the workspace
   * @returns Array of variable bundles
   */
  async getVariableBundles(workspaceId: number): Promise<VariableBundle[]> {
    return this.variableBundleRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' }
    });
  }

  /**
   * Get a variable bundle by ID
   * @param id The ID of the variable bundle
   * @param workspaceId Optional workspace ID to filter by
   * @returns The variable bundle
   * @throws NotFoundException if the variable bundle is not found
   */
  async getVariableBundle(id: number, workspaceId?: number): Promise<VariableBundle> {
    const whereClause: { id: number; workspace_id?: number } = { id };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const variableBundle = await this.variableBundleRepository.findOne({ where: whereClause });
    if (!variableBundle) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(`Variable bundle with ID ${id} not found in workspace ${workspaceId}`);
      } else {
        throw new NotFoundException(`Variable bundle with ID ${id} not found`);
      }
    }
    return variableBundle;
  }

  /**
   * Create a new variable bundle
   * @param workspaceId The ID of the workspace
   * @param data The variable bundle data
   * @returns The created variable bundle
   */
  async createVariableBundle(
    workspaceId: number,
    data: Omit<VariableBundle, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
  ): Promise<VariableBundle> {
    const variableBundle = this.variableBundleRepository.create({
      ...data,
      workspace_id: workspaceId
    });

    return this.variableBundleRepository.save(variableBundle);
  }

  /**
   * Update a variable bundle
   * @param id The ID of the variable bundle
   * @param workspaceId The ID of the workspace
   * @param data The variable bundle data to update
   * @returns The updated variable bundle
   * @throws NotFoundException if the variable bundle is not found
   */
  async updateVariableBundle(
    id: number,
    workspaceId: number,
    data: Partial<Omit<VariableBundle, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>>
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);

    // Apply updates
    Object.assign(variableBundle, data);

    // Save the variable bundle
    return this.variableBundleRepository.save(variableBundle);
  }

  /**
   * Delete a variable bundle
   * @param id The ID of the variable bundle
   * @param workspaceId The ID of the workspace
   * @returns Object with success flag
   * @throws NotFoundException if the variable bundle is not found
   */
  async deleteVariableBundle(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);

    await this.variableBundleRepository.remove(variableBundle);

    return { success: true };
  }

  /**
   * Add a variable to a variable bundle
   * @param id The ID of the variable bundle
   * @param workspaceId The ID of the workspace
   * @param variable The variable to add
   * @returns The updated variable bundle
   * @throws NotFoundException if the variable bundle is not found
   */
  async addVariableToBundle(
    id: number,
    workspaceId: number,
    variable: { unitName: string; variableId: string }
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);

    // Check if the variable already exists in the bundle
    const variableExists = variableBundle.variables.some(
      v => v.unitName === variable.unitName && v.variableId === variable.variableId
    );

    if (!variableExists) {
      variableBundle.variables.push(variable);
      return this.variableBundleRepository.save(variableBundle);
    }

    return variableBundle;
  }

  /**
   * Remove a variable from a variable bundle
   * @param id The ID of the variable bundle
   * @param workspaceId The ID of the workspace
   * @param unitName The unit name of the variable
   * @param variableId The variable ID
   * @returns The updated variable bundle
   * @throws NotFoundException if the variable bundle is not found
   */
  async removeVariableFromBundle(
    id: number,
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);

    // Filter out the variable to remove
    variableBundle.variables = variableBundle.variables.filter(
      v => !(v.unitName === unitName && v.variableId === variableId)
    );

    return this.variableBundleRepository.save(variableBundle);
  }
}
