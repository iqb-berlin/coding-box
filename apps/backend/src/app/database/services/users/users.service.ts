import {
  Injectable, Logger, BadRequestException, ForbiddenException
} from '@nestjs/common';
import { In, MoreThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import User from '../../entities/user.entity';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../../../api-dto/user/create-user-dto';
import WorkspaceUser from '../../entities/workspace_user.entity';
import { WorkspaceUserInListDto } from '../../../../../../../api-dto/user/workspace-user-in-list-dto';
import { UserInListDto } from '../../../../../../../api-dto/user/user-in-list-dto';

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

  async getAllUsers(workspaceId?: number): Promise<UserFullDto[]> {
    const validUsers = new Set<number>();
    if (workspaceId) {
      const workspaceUsers = await this.workspaceUserRepository.find({
        where: { workspaceId, accessLevel: MoreThan(0) },
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

  async getUsersWithWorkspaceAccess(workspaceId?: number): Promise<WorkspaceUserInListDto[]> {
    this.logger.log(`Returning users${workspaceId ? ` for workspaceId: ${workspaceId}` : '.'}`);
    const validUsers = workspaceId ?
      await this.workspaceUserRepository.find({ where: { workspaceId, accessLevel: MoreThan(0) } }) :
      [];
    const validUserMap = new Map(
      validUsers.map(wsUser => [wsUser.userId, {
        accessLevel: wsUser.accessLevel,
        canCode: wsUser.canCode
      }])
    );
    const users = await this.usersRepository.find();
    return users
      .filter(user => !workspaceId || validUserMap.has(user.id))
      .map(user => {
        const workspaceAccess = validUserMap.get(user.id);
        return {
          id: user.id,
          name: user.username, // Assuming "name" is the same as "username"
          username: user.username,
          accessLevel: workspaceAccess?.accessLevel || 0, // Default accessLevel is 0 if not found
          canCode: workspaceAccess?.canCode ?? (workspaceAccess?.accessLevel === 1),
          isAdmin: user.isAdmin
        };
      });
  }

  async updateUsersAccess(workspaceId: number, users: UserInListDto[]): Promise<boolean> {
    this.logger.log('Patch users access rights');
    const normalizedWorkspaceId = Number(workspaceId);
    if (!Number.isInteger(normalizedWorkspaceId) || normalizedWorkspaceId < 1) {
      throw new BadRequestException('Workspace ID must be a positive integer.');
    }

    if (!Array.isArray(users)) {
      throw new BadRequestException('Users access payload must be an array.');
    }

    const seenUserIds = new Set<number>();
    const userIdsToDelete: number[] = [];
    const usersToUpsert: WorkspaceUser[] = [];

    users.forEach(user => {
      const userId = Number(user.id);
      const accessLevel = Number(user.accessLevel ?? 0);

      if (!Number.isInteger(userId) || userId < 1) {
        throw new BadRequestException('User IDs must be positive integers.');
      }
      if (seenUserIds.has(userId)) {
        throw new BadRequestException(`Duplicate user ID in access payload: ${userId}.`);
      }
      if (!Number.isInteger(accessLevel) || accessLevel < 0 || accessLevel > 3) {
        throw new BadRequestException('Access level must be an integer between 0 and 3.');
      }

      seenUserIds.add(userId);

      if (accessLevel <= 0) {
        userIdsToDelete.push(userId);
        return;
      }

      usersToUpsert.push({
        workspaceId: normalizedWorkspaceId,
        userId,
        accessLevel,
        canCode: user.canCode ?? (accessLevel === 1)
      });
    });

    if (userIdsToDelete.length > 0) {
      await this.workspaceUserRepository.delete({
        workspaceId: normalizedWorkspaceId,
        userId: In(userIdsToDelete)
      });
    }

    if (usersToUpsert.length > 0) {
      await this.workspaceUserRepository.upsert(usersToUpsert, ['workspaceId', 'userId']);
    }

    return true;
  }

  async assertUsersCanCodeInWorkspace(userIds: number[], workspaceId: number): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds));
    if (uniqueUserIds.length === 0) {
      return;
    }

    const invalidUserId = uniqueUserIds.find(userId => !Number.isInteger(userId) || userId < 1);
    if (invalidUserId !== undefined) {
      throw new BadRequestException('Selected coders must have positive integer IDs.');
    }

    const coderRows = await this.workspaceUserRepository.find({
      where: {
        workspaceId,
        userId: In(uniqueUserIds),
        accessLevel: MoreThan(0),
        canCode: true
      },
      select: ['userId']
    });
    const coderUserIds = new Set(coderRows.map(row => row.userId));
    const missingUserIds = uniqueUserIds.filter(userId => !coderUserIds.has(userId));

    if (missingUserIds.length > 0) {
      throw new BadRequestException(
        `User(s) ${missingUserIds.join(', ')} are not enabled as coders in workspace ${workspaceId}.`
      );
    }
  }

  async canUserCodeInWorkspace(userId: number, workspaceId: number): Promise<boolean> {
    if (!Number.isInteger(userId) || userId < 1) {
      return false;
    }

    const workspaceUser = await this.workspaceUserRepository.findOne({
      where: {
        workspaceId,
        userId,
        accessLevel: MoreThan(0),
        canCode: true
      },
      select: ['userId']
    });

    return !!workspaceUser;
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    const wsUser = await this.workspaceUserRepository.findOne({
      where: { userId: userId, workspaceId: workspaceId, accessLevel: MoreThan(0) }
    });
    if (wsUser) return true;
    const user = await this.usersRepository.findOne({
      where: { id: userId, isAdmin: true }
    });
    return !!user;
  }

  async getUserAccessLevel(userId: number, workspaceId: number): Promise<number | null> {
    this.logger.log(`Retrieving access level for user ${userId} in workspace ${workspaceId}`);
    const wsUser = await this.workspaceUserRepository.findOne({
      where: { userId: userId, workspaceId: workspaceId }
    });
    return wsUser ? wsUser.accessLevel : null;
  }

  async getUserWorkspaces(userId: number): Promise<number[]> {
    this.logger.log(`Retrieving workspace IDs for user with ID: ${userId}`);
    const workspaces = await this.workspaceUserRepository
      .find({ where: { userId: userId, accessLevel: MoreThan(0) } });
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

  async findUserById(userId: number): Promise<UserFullDto | null> {
    this.logger.log(`Searching for user with id: ${userId}`);
    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (!user) {
      this.logger.warn(`User with id ${userId} not found.`);
      return null;
    }
    this.logger.log(`Returning user with id: ${user.id}`);

    return {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin
    } as UserFullDto;
  }

  async updateUser(userId: number, userData: UserFullDto): Promise<UserFullDto> {
    this.logger.log(`Updating user with id: ${userId}`);
    const existingUser = await this.usersRepository.findOne({ where: { id: userId } });
    if (!existingUser) {
      this.logger.warn(`User with id: ${userId} not found.`);
      throw new Error(`User with id: ${userId} not found.`);
    }
    const updatedUser = await this.usersRepository.save({ id: userId, ...userData });
    return updatedUser;
  }

  async assignUserWorkspaces(userId: number, workspaceIds: number[]): Promise<boolean> {
    this.logger.log(`Setting workspaces for user with ID: ${userId}`);
    const entries = workspaceIds.map(workspaceId => ({
      userId,
      workspaceId,
      accessLevel: 3,
      canCode: false
    }));
    try {
      const hasRights = await this.workspaceUserRepository.findOne({ where: { userId } });
      if (hasRights) {
        this.logger.log(`Existing workspaces found for user ${userId}, deleting...`);
        await this.workspaceUserRepository.delete({ userId });
      }
      const savedEntries = await this.workspaceUserRepository.save(entries);

      this.logger.log(`Workspaces successfully set for user with ID: ${userId}`);
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
    const {
      username, identity, issuer, isAdmin
    } = keycloakUser;
    const existingUser = await this.usersRepository.findOne({
      where: [
        { username },
        { identity, issuer }
      ],
      select: {
        id: true, username: true, identity: true, issuer: true, isAdmin: true
      }
    });

    if (existingUser) {
      const updatedFields: Partial<User> = {};
      const nextIsAdmin = existingUser.isAdmin || isAdmin;
      if (identity && existingUser.identity !== identity) updatedFields.identity = identity;
      if (issuer && existingUser.issuer !== issuer) updatedFields.issuer = issuer;
      if (existingUser.isAdmin !== nextIsAdmin) updatedFields.isAdmin = nextIsAdmin;

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
