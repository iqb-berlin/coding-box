import { Injectable, Logger } from '@nestjs/common';
import { MoreThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import User from '../entities/user.entity';
import { UserFullDto } from '../../../../../frontend/api-dto/user/user-full-dto';
import { CreateUserDto } from '../../../../../frontend/api-dto/user/create-user-dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>
  ) {
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
    const existingKeycloakUser: User = await this.usersRepository.findOne({
      where: { identity: user.identity, issuer: user.issuer },
      select: {
        username: true,
        id: true,
        firstName: true,
        lastName: true,
        email: true
      }
    });
    if (existingUser) {
      if (user.username) existingUser.username = user?.username || '';
      if (user.lastName) existingUser.lastName = user?.lastName || '';
      if (user.firstName) existingUser.firstName = user?.firstName || '';
      if (user.email) existingUser.email = user?.email || '';
      if (user.issuer) existingUser.issuer = user?.issuer;
      if (user.identity) existingUser.identity = user?.identity;
      await this.usersRepository.update(
        { id: existingUser.id },
        {
          identity: user.identity,
          issuer: user.issuer
        }
      );
      this.logger.log(`Updating keycloak user with username: ${JSON.stringify(user)}`);
      return existingKeycloakUser.id;
    }
    if (existingUser) {
      if (user.username) existingUser.username = user?.username || '';
      if (user.lastName) existingUser.lastName = user?.lastName || '';
      if (user.firstName) existingUser.firstName = user?.firstName || '';
      if (user.email) existingUser.email = user?.email || '';
      if (user.issuer) existingUser.issuer = user?.issuer;
      if (user.identity) existingUser.identity = user?.identity;
      await this.usersRepository.update(
        { id: existingUser.id },
        {
          identity: user.identity,
          issuer: user.issuer
        }
      );
      this.logger.log(`Updating user with username: ${JSON.stringify(user)}`);
      return existingUser.id;
    }

    this.logger.log(`Creating user with username: ${JSON.stringify(user)}`);
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

  async patch(userData: UserFullDto): Promise<void> {
    this.logger.log(`Updating user with id: ${userData.id}`);
    const userToUpdate = await this.usersRepository.findOne({
      where: { id: userData.id },
      select: {
        username: true,
        isAdmin: true,
        id: true,
        firstName: true,
        lastName: true,
        email: true
      }
    });
    if (userToUpdate) {
      if (typeof userData.isAdmin === 'boolean') userToUpdate.isAdmin = userData.isAdmin;
      if (userData.name) userToUpdate.username = userData.name;
      if (userData.lastName) userToUpdate.lastName = userData.lastName;
      if (userData.firstName) userToUpdate.firstName = userData.firstName;
      if (userData.email) userToUpdate.email = userData.email;
      await this.usersRepository.save(userToUpdate);
    }
  }
}
