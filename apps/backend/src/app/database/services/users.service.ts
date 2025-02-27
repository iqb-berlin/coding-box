import { Injectable, Logger, MethodNotAllowedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import User from '../entities/user.entity';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import WorkspaceUser from '../entities/workspace_user.entity';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { UserWorkspaceAccessDto } from '../../../../../../api-dto/workspaces/user-workspace-access-dto';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private httpService: HttpService,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WorkspaceUser)
    private workspaceUserRepository: Repository<WorkspaceUser>
  ) {
  }

  async findAllFull(workspaceId?: number): Promise<UserFullDto[]> {
    const validUsers: number[] = [];
    const users: User[] = await this.usersRepository.find({ order: { username: 'ASC' } });
    const returnUsers: UserFullDto[] = [];
    users.forEach(user => {
      if (!workspaceId || (validUsers.indexOf(user.id) > -1)) {
        returnUsers.push(<UserFullDto>{
          id: user.id,
          username: user.username,
          isAdmin: user.isAdmin
        });
      }
    });
    return returnUsers;
  }

  async findAllUsers(workspaceId?: number): Promise<WorkspaceUserInListDto[]> {
    this.logger.log(`Returning users${workspaceId ? ` for workspaceId: ${workspaceId}` : '.'}`);
    const validUsers: UserWorkspaceAccessDto[] = [];
    if (workspaceId) {
      const workspaceUsers: WorkspaceUser[] = await this.workspaceUserRepository
        .find({ where: { workspaceId: workspaceId } });

      workspaceUsers.forEach(wsU => validUsers.push(
        { id: wsU.userId, accessLevel: wsU.accessLevel }
      ));
    }
    const users: User[] = await this.usersRepository
      .find({ });
    const returnUsers: WorkspaceUserInListDto[] = [];
    users.forEach(user => {
      if (!workspaceId ||
        (validUsers.find(validUser => validUser.id === user.id))) {
        returnUsers.push(<WorkspaceUserInListDto>{
          id: user.id,
          name: user.username,
          username: user.username,
          accessLevel: validUsers
            .find(validUser => validUser.id === user.id)?.accessLevel || 0,
          isAdmin: user.isAdmin
        });
      }
    });
    return returnUsers;
  }

  async patchAllUsers(workspaceId: number, users: UserInListDto[]): Promise<boolean> {
    this.logger.log('Patch users access rights');
    const updatePromises = users
      .map(user => this.workspaceUserRepository
        .update({ workspaceId: workspaceId, userId: user.id }, { accessLevel: user.accessLevel })
      );
    await Promise.all(updatePromises);
    return true;
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    const wsUser = await this.workspaceUserRepository.findOne({
      where: { userId: userId, workspaceId: workspaceId }
    });
    if (wsUser) return true;
    const user = await this.usersRepository.findOne({
      where: { id: userId, isAdmin: true }
    });
    return !!user;
  }

  async findUserWorkspaceIds(userId: number): Promise<number[]> {
    this.logger.log(`Returning workspaces for user with id: ${userId}`);
    const workspaces = await this.workspaceUserRepository.find({ where: { userId: userId } });
    const workspaceIds = workspaces.map(workspace => workspace.workspaceId);
    if (workspaceIds) {
      return workspaceIds;
    }
    return [];
  }

  async findUserByIdentity(id: string): Promise<UserFullDto> {
    this.logger.log(`Returning user with id: ${id}`);
    const user = await this.usersRepository.findOne({
      where: { identity: id }
    });
    if (user) {
      return <UserFullDto>{
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin
      };
    }
    return user;
  }

  async editUser(userId:number, change:UserFullDto): Promise<UserFullDto[]> {
    this.logger.log(`Editing user with id: ${userId}`);
    await this.usersRepository.save({ id: userId, ...change });
    return [];
  }

  async setUserWorkspaces(userId: number, workspaceIds: number[]): Promise<boolean> {
    this.logger.log(`Setting workspaces for user with id: ${userId}`);
    const entries = workspaceIds.map(workspace => ({ userId: userId, workspaceId: workspace }));
    const hasRights = this.workspaceUserRepository.find({ where: { userId: userId } });
    if (hasRights) {
      await this.workspaceUserRepository.delete({ userId: userId });
    }
    const saved = await this.workspaceUserRepository.save(entries);
    return !!saved;
  }

  async create(user: CreateUserDto): Promise<number> {
    const newUser = this.usersRepository.create(user);
    await this.usersRepository.save(newUser);
    return newUser.id;
  }

  async createUser(user: CreateUserDto): Promise<number> {
    const existingUser: User = await this.usersRepository.findOne({
      where: { username: user.username },
      select: {
        username: true,
        id: true
      }
    });
    this.logger.log(`Creating user with username: ${JSON.stringify(user)}`);
    if (existingUser) {
      this.logger.log(`User with username ${user.username} already exists`);
      return existingUser.id;
    }
    const newUser = this.usersRepository.create(user);
    await this.usersRepository.save(newUser);
    return newUser.id;
  }

  async getUserIsAdmin(userId: number): Promise<boolean> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { isAdmin: true }
    });
    if (user) return user.isAdmin;
    return false;
  }

  async remove(id: number | number[]): Promise<void> {
    this.logger.log(`Deleting user with id: ${id}`);
    await this.usersRepository.delete(id);
  }

  removeIds(ids: number[]) {
    // TODO: Sich selbst bzw. alle löschen verhindern?
    if (ids && ids.length) {
      ids.forEach(id => this.remove(id));
    }
    // TODO: Eigene Exception mit Custom-Parametern
    throw new MethodNotAllowedException();
  }

  async createKeycloakUser(keycloakUser: CreateUserDto): Promise<number> {
    const existingUser: User = await this.usersRepository.findOne({
      where: { username: keycloakUser.username },
      select: {
        username: true,
        id: true
      }
    });
    const existingKeycloakUser: User = await this.usersRepository.findOne({
      where: { identity: keycloakUser.identity, issuer: keycloakUser.issuer },
      select: {
        username: true,
        id: true
      }
    });
    if (existingUser) {
      if (keycloakUser.issuer) existingUser.issuer = keycloakUser?.issuer;
      if (keycloakUser.identity) existingUser.identity = keycloakUser?.identity;
      await this.usersRepository.update(
        { id: existingUser.id },
        {
          identity: keycloakUser.identity,
          issuer: keycloakUser.issuer
        }
      );
      this.logger.log(`Updating keycloak user with username: ${JSON.stringify(keycloakUser)}`);
      return existingKeycloakUser.id;
    }
    if (existingKeycloakUser) {
      if (keycloakUser.issuer) existingKeycloakUser.issuer = keycloakUser?.issuer;
      if (keycloakUser.identity) existingKeycloakUser.identity = keycloakUser?.identity;
      await this.usersRepository.update(
        { id: existingKeycloakUser.id },
        {
          identity: keycloakUser.identity,
          issuer: keycloakUser.issuer
        }
      );
      this.logger.log(`Updating keycloak user with username: ${JSON.stringify(keycloakUser)}`);
      return existingKeycloakUser.id;
    }

    this.logger.log(`Creating keycloak user with username: ${JSON.stringify(keycloakUser)}`);
    const newUser = this.usersRepository.create(keycloakUser);
    await this.usersRepository.save(newUser);
    return newUser.id;
  }
}
