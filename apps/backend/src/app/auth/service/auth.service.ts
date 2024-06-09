import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../database/services/users.service';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
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

  async keycloakLogin(user: CreateUserDto) {
    const {
      username, lastName, firstName, email, identity, issuer, isAdmin
    } = user;
    const userId = await this.usersService.createKeycloakUser({
      identity: identity,
      username: username,
      email: email,
      lastName: lastName,
      firstName: firstName,
      issuer: issuer,
      isAdmin: isAdmin
    });
    this.logger.log(`Keycloak User with id '${userId}' is logging in.`);
    const payload = { username: username, sub: userId, sub2: 0 };
    return this.jwtService.sign(payload);
  }

  async createToken(identity:string, workspaceId:number): Promise<string> {
    const user = await this.usersService.findUserByIdentity(identity);
    const payload = {
      username: user.username, sub: identity, sub2: 0, workspace: workspaceId
    };
    const token = this.jwtService.sign(payload);
    return JSON.stringify(token);
  }

  async login(user: CreateUserDto) {
    const {
      identity, username, email, lastName, firstName, issuer
    } = user;
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
    const payload = { username: username, sub: userId, sub2: 0 };
    return this.jwtService.sign(payload);
  }

  async isAdminUser(userId: number): Promise<boolean> {
    return !!userId && this.usersService.getUserIsAdmin(userId);
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    return this.usersService.canAccessWorkSpace(userId, workspaceId);
  }
}
