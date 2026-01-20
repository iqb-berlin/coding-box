import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Connection, In, Repository } from 'typeorm';
import Workspace from '../../entities/workspace.entity';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { CreateWorkspaceDto } from '../../../../../../../api-dto/workspaces/create-workspace-dto';
import { AdminWorkspaceNotFoundException } from '../../../exceptions/admin-workspace-not-found.exception';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';

@Injectable()
export class WorkspaceCoreService {
  private readonly logger = new Logger(WorkspaceCoreService.name);

  constructor(
    @InjectRepository(Workspace)
    private workspaceRepository: Repository<Workspace>,
    private connection: Connection
  ) {}

  async findAll(options?: { page: number; limit: number }): Promise<[WorkspaceInListDto[], number]> {
    this.logger.log('Fetching all workspaces from the repository.');

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 10000;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
      const [workspaces, total] = await this.workspaceRepository.findAndCount({
        select: ['id', 'name'],
        skip: (validPage - 1) * validLimit,
        take: validLimit
      });

      this.logger.log(`Found ${workspaces.length} workspaces (page ${validPage}, limit ${validLimit}, total ${total}).`);
      return [workspaces.map(({ id, name }) => ({ id, name })), total];
    }

    const workspaces = await this.workspaceRepository.find({
      select: ['id', 'name']
    });
    this.logger.log(`Found ${workspaces.length} workspaces.`);
    return [workspaces.map(({ id, name }) => ({ id, name })), workspaces.length];
  }

  async findOne(id: number): Promise<WorkspaceFullDto> {
    this.logger.log(`Returning workspace with id: ${id}`);
    const workspace = await this.workspaceRepository.findOne({
      where: { id: id },
      select: { id: true, name: true, settings: true }
    });
    if (workspace) {
      return <WorkspaceFullDto>{
        id: workspace.id,
        name: workspace.name,
        settings: workspace.settings
      };
    }
    throw new AdminWorkspaceNotFoundException(id, 'GET');
  }

  async create(workspace: CreateWorkspaceDto): Promise<number> {
    this.logger.log(`Creating workspace with name: ${workspace.name}`);
    const newWorkspace = this.workspaceRepository.create({ ...workspace });
    try {
      const savedWorkspace = await this.workspaceRepository.save(newWorkspace);
      this.logger.log(`Workspace created successfully with ID: ${savedWorkspace.id}`);
      return savedWorkspace.id;
    } catch (error) {
      this.logger.error(
        `Failed to create workspace with name: ${workspace.name}`,
        error.stack
      );
      throw new Error('Workspace creation failed');
    }
  }

  async patch(workspaceData: WorkspaceFullDto): Promise<void> {
    this.logger.log(`Updating workspace with id: ${workspaceData.id}`);
    if (workspaceData.id) {
      const workspaceGroupToUpdate = await this.workspaceRepository.findOne({
        where: { id: workspaceData.id }
      });
      if (workspaceData.name) workspaceGroupToUpdate.name = workspaceData.name;
      if (workspaceData.settings) workspaceGroupToUpdate.settings = workspaceData.settings;
      await this.workspaceRepository.save(workspaceGroupToUpdate);
    }
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids || ids.length === 0) {
      this.logger.warn('No IDs provided for workspace deletion.');
      return;
    }
    this.logger.log(`Attempting to delete workspaces with IDs: ${ids.join(', ')}`);

    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(FileUpload, { workspace_id: In(ids) });
      this.logger.log(`Deleted file uploads for workspaces with IDs: ${ids.join(', ')}`);

      await queryRunner.manager.delete(Persons, { workspace_id: In(ids) });
      this.logger.log(`Deleted persons for workspaces with IDs: ${ids.join(', ')}`);

      const result = await queryRunner.manager.delete(Workspace, { id: In(ids) });
      this.logger.log(`Deleted workspaces with IDs: ${ids.join(', ')}`);

      await queryRunner.commitTransaction();

      if (result.affected && result.affected > 0) {
        this.logger.log(`Successfully deleted ${result.affected} workspace(s) with IDs: ${ids.join(', ')}`);
      } else {
        this.logger.warn(`No workspaces found with the specified IDs: ${ids.join(', ')}`);
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to delete workspaces with IDs: ${ids.join(', ')}. Error: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
