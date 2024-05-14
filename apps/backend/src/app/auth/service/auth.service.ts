import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../database/services/users.service';
import { CreateUserDto } from '../../../../../frontend/api-dto/user/create-user-dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {
  }

  async initLogin(username: string) {
    if (await this.usersService.hasUsers()) throw new ForbiddenException();
    const newUserId = await this.usersService.create({
      isAdmin: true,
      username: username
    });
    this.logger.log(`First User with id '${newUserId}' is logging in.`);
    const payload = { username: username, sub: newUserId, sub2: 0 };
    return this.jwtService.sign(payload);
  }

  async login(user: CreateUserDto) {
    const {identity,username,email,lastName,firstName,issuer,isAdmin } = user;
    const userId = await this.usersService.createUser({
      identity: identity,
      username: username,
      email: email,
      lastName: lastName,
      firstName: firstName,
      issuer: issuer,
      isAdmin: false
    });
    this.logger.log(`User with id '${userId}' is logging in.`);
    const payload = { username: 'a', sub: 1, sub2: 0 };
    return this.jwtService.sign(payload);
  }

  async isAdminUser(userId: number): Promise<boolean> {
    return !!userId && this.usersService.getUserIsAdmin(userId);
  }
}
