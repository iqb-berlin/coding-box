import {
  Injectable, Logger, BadRequestException, ForbiddenException
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import User from '../entities/user.entity';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import WorkspaceUser from '../entities/workspace_user.entity';
import { WorkspaceUserInListDto } from '../../../../../../api-dto/user/workspace-user-in-list-dto';
import { UserInListDto } from '../../../../../../api-dto/user/user-in-list-dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WorkspaceUser)
    private workspaceUserRepository: Repository<WorkspaceUser>
  ) {
  }

  async findAllFull(workspaceId?: number): Promise<UserFullDto[]> {
    const validUsers = new Set<number>();
    if (workspaceId) {
      const workspaceUsers = await this.workspaceUserRepository.find({
        where: { workspaceId },
        select: ['userId']
      });
      workspaceUsers.forEach(wsUser => validUsers.add(wsUser.userId));
    }
    const users: User[] = await this.usersRepository.find({ order: { username: 'ASC' } });
    return users
      .filter(user => !workspaceId || validUsers.has(user.id))
      .map(user => ({
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin
      }));
  }

  async findAllUsers(workspaceId?: number): Promise<WorkspaceUserInListDto[]> {
    this.logger.log(`Returning users${workspaceId ? ` for workspaceId: ${workspaceId}` : '.'}`);
    const validUsers = workspaceId ?
      await this.workspaceUserRepository.find({ where: { workspaceId } }) :
      [];
    const validUserMap = new Map(
      validUsers.map(wsUser => [wsUser.userId, wsUser.accessLevel])
    );
    const users = await this.usersRepository.find();
    return users
      .filter(user => !workspaceId || validUserMap.has(user.id))
      .map(user => ({
        id: user.id,
        name: user.username, // Assuming "name" is the same as "username"
        username: user.username,
        accessLevel: validUserMap.get(user.id) || 0, // Default accessLevel is 0 if not found
        isAdmin: user.isAdmin
      }));
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
    this.logger.log(`Retrieving workspace IDs for user with ID: ${userId}`);
    const workspaces = await this.workspaceUserRepository
      .find({ where: { userId: userId } });
    const workspaceIds = workspaces
      .map(workspace => workspace.workspaceId);
    return workspaceIds || [];
  }

  async findUserByIdentity(id: string): Promise<UserFullDto | null> {
    this.logger.log(`Searching for user with identity: ${id}`);
    const user = await this.usersRepository.findOne({ where: { identity: id } });

    if (!user) {
      this.logger.warn(`User with identity ${id} not found.`);
      return null;
    }
    this.logger.log(`Returning user with id: ${user.id}`);

    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin
    } as UserFullDto;
  }

  async editUser(userId: number, change: UserFullDto): Promise<UserFullDto> {
    this.logger.log(`Editing user with id: ${userId}`);
    const existingUser = await this.usersRepository.findOne({ where: { id: userId } });
    if (!existingUser) {
      this.logger.warn(`User with id: ${userId} not found.`);
      throw new Error(`User with id: ${userId} not found.`);
    }
    const updatedUser = await this.usersRepository.save({ id: userId, ...change });
    return updatedUser;
  }

  async setUserWorkspaces(userId: number, workspaceIds: number[]): Promise<boolean> {
    this.logger.log(`Setting workspaces for user with ID: ${userId}`);
    const entries = workspaceIds.map(workspaceId => ({ userId, workspaceId, accessLevel: 3 }));
    try {
      const hasRights = await this.workspaceUserRepository.findOne({ where: { userId } });
      if (hasRights) {
        this.logger.log(`Existing workspaces found for user ${userId}, deleting...`);
        await this.workspaceUserRepository.delete({ userId });
      }
      const savedEntries = await this.workspaceUserRepository.save(entries);

      this.logger.log(`Workspaces successfully set for user with ID: ${userId}`);
      // Return true if at least one entry was saved
      return savedEntries.length > 0;
    } catch (error) {
      this.logger.error(
        `Error setting workspaces for user with ID: ${userId}. Details: ${error.message}`,
        error.stack
      );
      throw new Error('Failed to set user workspaces');
    }
  }

  async create(user: CreateUserDto): Promise<number> {
    try {
      this.logger.log('Creating a new user');

      const newUser = this.usersRepository.create(user);
      const savedUser = await this.usersRepository.save(newUser);

      this.logger.log(`User created successfully with ID: ${savedUser.id}`);
      return savedUser.id;
    } catch (error) {
      this.logger.error('Error creating a new user', error.stack);
      throw new Error('Failed to create user');
    }
  }

  async createUser(user: CreateUserDto): Promise<number> {
    const existingUser: User | null = await this.usersRepository.findOne({
      where: { username: user.username },
      select: ['id', 'username'] // Fetch only the needed fields for validation
    });

    this.logger.log(`Attempting to create user with username: ${user.username}`);

    if (existingUser) {
      this.logger.warn(`User with username '${user.username}' already exists with ID: ${existingUser.id}`);
      return existingUser.id;
    }

    const newUser = this.usersRepository.create(user);

    await this.usersRepository.save(newUser);

    this.logger.log(`Successfully created user with ID: ${newUser.id}`);
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

  async removeIds(ids: number[], currentUserId: number): Promise<void> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException('No user IDs were provided for deletion.');
    }

    if (ids.includes(currentUserId)) {
      throw new ForbiddenException('A user cannot delete themselves.');
    }

    const totalUsers = await this.usersRepository.count();
    if (ids.length >= totalUsers) {
      throw new ForbiddenException('All users cannot be deleted at once.');
    }

    await this.usersRepository.delete(ids);
  }

  async createKeycloakUser(keycloakUser: CreateUserDto): Promise<number> {
    const { username, identity, issuer } = keycloakUser;
    const existingUser = await this.usersRepository.findOne({
      where: [
        { username },
        { identity, issuer }
      ],
      select: {
        id: true, username: true, identity: true, issuer: true
      }
    });

    if (existingUser) {
      const updatedFields: Partial<User> = {};
      if (identity && existingUser.identity !== identity) updatedFields.identity = identity;
      if (issuer && existingUser.issuer !== issuer) updatedFields.issuer = issuer;

      if (Object.keys(updatedFields).length > 0) {
        await this.usersRepository.update({ id: existingUser.id }, updatedFields);
        this.logger.log(`Updating existing user: ${JSON.stringify({ ...existingUser, ...updatedFields })}`);
      }

      return existingUser.id;
    }
    this.logger.log(`Creating new Keycloak user: ${JSON.stringify(keycloakUser)}`);
    const newUser = this.usersRepository.create(keycloakUser);
    await this.usersRepository.save(newUser);

    return newUser.id;
  }
}
