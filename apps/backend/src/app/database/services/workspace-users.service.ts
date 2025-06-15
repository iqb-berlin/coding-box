import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import WorkspaceUser from '../entities/workspace_user.entity';
import User from '../entities/user.entity';

@Injectable()
export class WorkspaceUsersService {
  private readonly logger = new Logger(WorkspaceUsersService.name);

  constructor(
    @InjectRepository(WorkspaceUser)
    private workspaceUsersRepository: Repository<WorkspaceUser>,
    @InjectRepository(User)
    private usersRepository: Repository<User>
  ) {}

  async findAllUserWorkspaces(identity: string): Promise<number[]> {
    this.logger.log('Returning all workspaces for user', identity);
    const user = await this.usersRepository.findOne({ where: { identity: identity } });
    const workspaces = await this.workspaceUsersRepository.find({
      where: { userId: user.id }
    });
    if (workspaces.length > 0) {
      return workspaces.map(workspace => workspace.workspaceId);
    }
    return [];
  }

  async setWorkspaceUsers(workspaceId: number, userIds: number[]): Promise<boolean> {
    this.logger.log(`Setting users for workspace with id: ${workspaceId}`);
    const entries = userIds.map(user => ({ userId: user, workspaceId: workspaceId }));
    const hasRights = this.workspaceUsersRepository.find({ where: { workspaceId: workspaceId } });
    if (hasRights) {
      await this.workspaceUsersRepository.delete({ workspaceId: workspaceId });
    }
    const saved = await this.workspaceUsersRepository.save(entries);
    return !!saved;
  }

  async findUsers(workspaceId: number, options?: { page: number; limit: number }): Promise<[WorkspaceUser[], number]> {
    this.logger.log(`Retrieving users for workspace ID: ${workspaceId}`);

    try {
      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        const [users, total] = await this.workspaceUsersRepository.findAndCount({
          where: { workspaceId },
          skip: (validPage - 1) * validLimit,
          take: validLimit,
          order: { userId: 'ASC' }
        });

        this.logger.log(`Found ${users.length} user(s) (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ID: ${workspaceId}`);
        return [users, total];
      }

      const users = await this.workspaceUsersRepository.find({
        where: { workspaceId },
        order: { userId: 'ASC' }
      });

      this.logger.log(`Found ${users.length} user(s) for workspace ID: ${workspaceId}`);
      return [users, users.length];
    } catch (error) {
      this.logger.error(`Failed to retrieve users for workspace ID: ${workspaceId}`, error.stack);
      throw new Error('Could not retrieve workspace users');
    }
  }
}
