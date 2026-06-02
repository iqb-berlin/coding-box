import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../database/services/users';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import {
  WORKSPACE_TOKEN_AUDIENCE,
  WORKSPACE_TOKEN_ISSUER,
  WORKSPACE_TOKEN_USE
} from '../workspace-token.constants';

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

  async createToken(
    identity: string,
    workspaceId: number,
    duration: number,
    requesterUserId?: number
  ): Promise<string> {
    const user = await this.usersService.findUserByIdentity(identity);
    if (!user) {
      throw new NotFoundException(`User with identity ${identity} not found`);
    }
    if (requesterUserId !== undefined && user.id !== requesterUserId) {
      const [requesterIsAdmin, requesterAccessLevel] = await Promise.all([
        this.usersService.getUserIsAdmin(requesterUserId),
        this.usersService.getUserAccessLevel(requesterUserId, workspaceId)
      ]);
      if (!requesterIsAdmin && (requesterAccessLevel || 0) < 3) {
        throw new ForbiddenException('Users need workspace admin access to create tokens for another identity');
      }
    }
    return this.signWorkspaceToken(user, workspaceId, duration);
  }

  async createTokenForUserId(
    userId: number,
    workspaceId: number,
    duration: number
  ): Promise<string> {
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    return this.signWorkspaceToken(user, workspaceId, duration);
  }

  private signWorkspaceToken(user: UserFullDto, workspaceId: number, duration: number): string {
    const payload = {
      token_use: WORKSPACE_TOKEN_USE,
      userId: user.id,
      username: user.username,
      sub: String(user.id),
      workspace: workspaceId
    };
    const token = this.jwtService.sign(payload, {
      expiresIn: `${duration}d`,
      issuer: WORKSPACE_TOKEN_ISSUER,
      audience: WORKSPACE_TOKEN_AUDIENCE,
      algorithm: 'HS256'
    });
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
