import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../database/services/users';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {
  }

  async storeOidcProviderUser(user: CreateUserDto) {
    const {
      username, lastName, firstName, email, identity, issuer, isAdmin
    } = user;
    const userId = await this.usersService.createOidcProviderUser({
      identity: identity,
      username: username,
      email: email,
      lastName: lastName,
      firstName: firstName,
      issuer: issuer,
      isAdmin: isAdmin
    });
    this.logger.log(`OIDC Provider User with id '${userId}' stored in database.`);
    return userId;
  }

  async loginOidcProviderUser(user: CreateUserDto) {
    const {
      username, lastName, firstName, email, identity, issuer, isAdmin
    } = user;
    const userId = await this.usersService.createOidcProviderUser({
      identity: identity,
      username: username,
      email: email,
      lastName: lastName,
      firstName: firstName,
      issuer: issuer,
      isAdmin: isAdmin
    });
    this.logger.log(`OIDC Provider User with id '${userId}' is logging in.`);
    const payload = {
      userId: userId, username: username, sub: user
    };
    return this.jwtService.sign(payload);
  }

  async createToken(identity:string, workspaceId:number, duration: number): Promise<string> {
    const user = await this.usersService.findUserByIdentity(identity);
    const payload = {
      userId: user.id, username: user.username, sub: user, workspace: workspaceId
    };
    const token = this.jwtService.sign(payload, { expiresIn: `${duration}d` });
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
    const payload = {
      userId: userId, username: username, sub: userId
    };
    return this.jwtService.sign(payload);
  }

  async isAdminUser(userId: number): Promise<boolean> {
    return !!userId && this.usersService.getUserIsAdmin(userId);
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    return this.usersService.canAccessWorkSpace(userId, workspaceId);
  }
}
