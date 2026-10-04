import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { assertCodingResourceCreation, assertCodingResourceMutation } from '../shared/coding-ownership.policy';

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
    data: { name: string; description?: string; variables: Array<{ unitName: string; variableId: string }> },
    actorUserId?: number
  ): Promise<VariableBundle> {
    return this.variableBundleRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(VariableBundle);

      const variableBundle = repository.create({
        name: data.name,
        description: data.description,
        variables: data.variables,
        creatorUserId: await assertCodingResourceCreation(repository.manager, workspaceId, actorUserId),
        workspace_id: workspaceId,
        codingJobVariableBundles: []
      });

      return repository.save(variableBundle);
    });
  }

  async updateVariableBundle(
    id: number,
    workspaceId: number,
    data: Partial<Pick<VariableBundle, 'name' | 'description' | 'variables'>>,
    actorUserId?: number
  ): Promise<VariableBundle> {
    return this.variableBundleRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(VariableBundle);

      await assertCodingResourceMutation(manager, workspaceId, 'bundle', id, actorUserId);
      const variableBundle = await repository.findOneOrFail({ where: { id, workspace_id: workspaceId } });
      if (data.name !== undefined) variableBundle.name = data.name;
      if (data.description !== undefined) variableBundle.description = data.description;
      if (data.variables !== undefined) variableBundle.variables = data.variables;
      return repository.save(variableBundle);
    });
  }

  async deleteVariableBundle(id: number, workspaceId: number, actorUserId?: number): Promise<{ success: boolean }> {
    return this.variableBundleRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(VariableBundle);

      await assertCodingResourceMutation(repository.manager, workspaceId, 'bundle', id, actorUserId);
      const variableBundle = await repository.findOneOrFail({ where: { id, workspace_id: workspaceId } });
      await repository.remove(variableBundle);
      return { success: true };
    });
  }

  async addVariableToBundle(
    id: number,
    workspaceId: number,
    variable: { unitName: string; variableId: string },
    actorUserId?: number
  ): Promise<VariableBundle> {
    return this.variableBundleRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(VariableBundle);

      await assertCodingResourceMutation(repository.manager, workspaceId, 'bundle', id, actorUserId);
      const variableBundle = await repository.findOneOrFail({ where: { id, workspace_id: workspaceId } });
      const variableExists = variableBundle.variables.some(
        v => v.unitName === variable.unitName && v.variableId === variable.variableId
      );

      if (!variableExists) {
        variableBundle.variables.push(variable);
        return repository.save(variableBundle);
      }

      return variableBundle;
    });
  }

  async removeVariableFromBundle(
    id: number,
    workspaceId: number,
    unitName: string,
    variableId: string,
    actorUserId?: number
  ): Promise<VariableBundle> {
    return this.variableBundleRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(VariableBundle);

      await assertCodingResourceMutation(repository.manager, workspaceId, 'bundle', id, actorUserId);
      const variableBundle = await repository.findOneOrFail({ where: { id, workspace_id: workspaceId } });
      variableBundle.variables = variableBundle.variables.filter(
        v => !(v.unitName === unitName && v.variableId === variableId)
      );

      return repository.save(variableBundle);
    });
  }
}
