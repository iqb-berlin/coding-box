import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArgumentOutOfRangeError } from 'rxjs';
import Workspace from '../entities/workspace.entity';
import { WorkspaceInListDto } from '../../../../../frontend/api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../frontend/api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../frontend/api-dto/workspaces/create-workspace-dto';
import { AdminWorkspaceNotFoundException } from '../../exceptions/admin-workspace-not-found.exception';
import WorkspaceAdmin from '../entities/workspace-admin.entity';
import { UsersService } from './users.service';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace>,
    @InjectRepository(WorkspaceAdmin)
    private workspaceAdminRepository: Repository<WorkspaceAdmin>,
    private usersService: UsersService

  ) {}

  async findAll(userId?: number): Promise<WorkspaceInListDto[]> {
    this.logger.log('Returning all workspace groups.');
    let usersWorkspaceGroupIds: number[] = [];
    if (userId) {
      const usersWorkspaceGroups = await this.workspaceAdminRepository.find({
        where: { userId: userId }
      });
      if (usersWorkspaceGroups && usersWorkspaceGroups.length > 0) {
        usersWorkspaceGroupIds = usersWorkspaceGroups.map(wsg => wsg.workspaceGroupId);
      } else {
        return [];
      }
    }

    const returnWorkspaces: WorkspaceInListDto[] = [];
    return returnWorkspaces;
  }

  async findOne(id: number): Promise<WorkspaceFullDto> {
    this.logger.log(`Returning workspace with id: ${id}`);
    const workspaceGroup = await this.workspaceRepository.findOne({
      where: { id: id },
      select: { id: true, name: true, settings: true }
    });
    if (workspaceGroup) {
      return <WorkspaceFullDto>{
        id: workspaceGroup.id,
        name: workspaceGroup.name,
        settings: workspaceGroup.settings
      };
    }
    throw new AdminWorkspaceNotFoundException(id, 'GET');
  }

  async create(workspaceGroup: CreateWorkspaceDto): Promise<number> {
    this.logger.log(`Creating workspace with name: ${workspaceGroup.name}`);
    const newWorkspaceGroup = this.workspaceRepository.create(workspaceGroup);
    await this.workspaceRepository.save(newWorkspaceGroup);
    return newWorkspaceGroup.id;
  }

  async patch(workspaceGroupData: WorkspaceFullDto): Promise<void> {
    this.logger.log(`Updating workspace with id: ${workspaceGroupData.id}`);
    if (workspaceGroupData.id) {
      const workspaceGroupToUpdate = await this.workspaceRepository.findOne({
        where: { id: workspaceGroupData.id }
      });
      if (workspaceGroupData.name) workspaceGroupToUpdate.name = workspaceGroupData.name;
      if (workspaceGroupData.settings) workspaceGroupToUpdate.settings = workspaceGroupData.settings;
      await this.workspaceRepository.save(workspaceGroupToUpdate);
    } else {
      throw new ArgumentOutOfRangeError();
    }
  }

  async remove(id: number[]): Promise<void> {
    this.logger.log(`Deleting workspaces with ids: ${id.join(', ')}`);
    await this.workspaceRepository.delete(id);
  }

}
