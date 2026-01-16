import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VariableBundle } from '../../entities/variable-bundle.entity';

@Injectable()
export class VariableBundleService {
  constructor(
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>
  ) {}

  async getVariableBundles(
    workspaceId: number,
    page: number = 1,
    limit: number = 10
  ): Promise<{ data: VariableBundle[]; total: number; page: number; limit: number }> {
    const validPage = page > 0 ? page : 1;
    const validLimit = limit > 0 ? limit : 10;

    const skip = (validPage - 1) * validLimit;

    const total = await this.variableBundleRepository.count({
      where: { workspace_id: workspaceId }
    });

    const data = await this.variableBundleRepository.find({
      where: { workspace_id: workspaceId },
      order: { created_at: 'DESC' },
      skip,
      take: validLimit
    });

    return {
      data,
      total,
      page: validPage,
      limit: validLimit
    };
  }

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

  async createVariableBundle(
    workspaceId: number,
    data: { name: string; description?: string; variables: Array<{ unitName: string; variableId: string }> }
  ): Promise<VariableBundle> {
    const variableBundle = this.variableBundleRepository.create({
      ...data,
      workspace_id: workspaceId,
      codingJobVariableBundles: []
    });

    return this.variableBundleRepository.save(variableBundle);
  }

  async updateVariableBundle(
    id: number,
    workspaceId: number,
    data: Partial<Omit<VariableBundle, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>>
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);
    Object.assign(variableBundle, data);
    return this.variableBundleRepository.save(variableBundle);
  }

  async deleteVariableBundle(id: number, workspaceId: number): Promise<{ success: boolean }> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);
    await this.variableBundleRepository.remove(variableBundle);
    return { success: true };
  }

  async addVariableToBundle(
    id: number,
    workspaceId: number,
    variable: { unitName: string; variableId: string }
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);
    const variableExists = variableBundle.variables.some(
      v => v.unitName === variable.unitName && v.variableId === variable.variableId
    );

    if (!variableExists) {
      variableBundle.variables.push(variable);
      return this.variableBundleRepository.save(variableBundle);
    }

    return variableBundle;
  }

  async removeVariableFromBundle(
    id: number,
    workspaceId: number,
    unitName: string,
    variableId: string
  ): Promise<VariableBundle> {
    const variableBundle = await this.getVariableBundle(id, workspaceId);
    variableBundle.variables = variableBundle.variables.filter(
      v => !(v.unitName === unitName && v.variableId === variableId)
    );

    return this.variableBundleRepository.save(variableBundle);
  }
}
