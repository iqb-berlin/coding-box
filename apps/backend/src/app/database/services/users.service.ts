import { Injectable, Logger, MethodNotAllowedException } from '@nestjs/common';
import { MoreThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import User from '../entities/user.entity';
import { UserFullDto } from '../../../../../frontend/api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../frontend/api-dto/user/create-user-dto';
import WorkspaceUser from '../entities/workspace_user.entity';
import { HttpService } from '@nestjs/axios';
import { Observable } from 'rxjs';

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
          name: user.username,
          isAdmin: user.isAdmin,
          lastName: user.lastName,
          firstName: user.firstName,
          email: user.email
        });
      }
    });
    return returnUsers;
  }

  async findUserWorkspaces(userId: number): Promise<any> {
    const workspaces: any = await this.workspaceUserRepository.find({ where: { userId: userId }})

    console.log(workspaces);

    return workspaces.map(workspace => workspace.workspaceId);
  }

  async findOne(id: number): Promise<UserFullDto> {
    this.logger.log(`Returning user with id: ${id}`);
    const user = await this.usersRepository.findOne({
      where: { id: id }
    });
    if (user) {
      return <UserFullDto>{
        id: user.id,
        name: user.username,
        isAdmin: user.isAdmin,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      };
    }
    return user;
  }

  async hasUsers(): Promise<boolean> {
    this.logger.log('Checking hasUsers');
    const user = await this.usersRepository.findOne({
      where: { id: MoreThan(0) },
      select: { id: true }
    });
    this.logger.log(user);
    return !!user;
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
        id: true,
        firstName: true,
        lastName: true,
        email: true
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

  async getLongName(userId: number): Promise<string> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { lastName: true, firstName: true, username: true }
    });
    if (user) {
      if (user.lastName) return user.firstName ? `${user.lastName}, ${user.firstName}` : user.lastName;
      return user.firstName || '';
    }
    return '';
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

  setPassword(newPassword: string,token:string): Observable<any> {
    this.logger.log(`Setting password for user with id:`);
    return this.httpService.put('');
  }
}
