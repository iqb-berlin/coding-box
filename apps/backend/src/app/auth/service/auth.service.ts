import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../database/services/users';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import {
  createWorkspaceTokenPolicy,
  DEFAULT_REPLAY_READ_WORKSPACE_TOKEN_MAX_DURATION_DAYS,
  getWorkspaceTokenMaxDurationDays,
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPES,
  WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS_ENV,
  WorkspaceTokenPolicy,
  WorkspaceTokenScope
} from '../workspace-token';
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
    private jwtService: JwtService,
    private configService: ConfigService
  ) {
  }

  getWorkspaceTokenPolicy(): WorkspaceTokenPolicy {
    return createWorkspaceTokenPolicy(this.getReplayReadMaxDurationDays());
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
    scopes: WorkspaceTokenScope[],
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
    return this.signWorkspaceToken(user, workspaceId, duration, scopes);
  }

  async createTokenForUserId(
    userId: number,
    workspaceId: number,
    duration: number,
    scopes: WorkspaceTokenScope[]
  ): Promise<string> {
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    return this.signWorkspaceToken(user, workspaceId, duration, scopes);
  }

  private signWorkspaceToken(
    user: UserFullDto,
    workspaceId: number,
    duration: number,
    scopes: WorkspaceTokenScope[]
  ): string {
    this.validateWorkspaceTokenScopes(scopes);
    this.validateWorkspaceTokenDuration(duration, scopes);
    const payload = {
      token_use: WORKSPACE_TOKEN_USE,
      userId: user.id,
      username: user.username,
      sub: String(user.id),
      workspace: workspaceId,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: Array.from(new Set(scopes))
    };
    const token = this.jwtService.sign(payload, {
      expiresIn: `${duration}d`,
      issuer: WORKSPACE_TOKEN_ISSUER,
      audience: WORKSPACE_TOKEN_AUDIENCE,
      algorithm: 'HS256'
    });
    return JSON.stringify(token);
  }

  private validateWorkspaceTokenDuration(duration: number, scopes: WorkspaceTokenScope[]): void {
    const maxDurationDays = getWorkspaceTokenMaxDurationDays(scopes, this.getWorkspaceTokenPolicy());
    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > maxDurationDays
    ) {
      throw new BadRequestException(
        `Token duration must be a whole number between 1 and ${maxDurationDays} days for the requested scopes`
      );
    }
  }

  private validateWorkspaceTokenScopes(scopes: WorkspaceTokenScope[]): void {
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new BadRequestException('At least one token scope is required');
    }

    const allowedScopes = new Set<string>(WORKSPACE_TOKEN_SCOPES);
    const invalidScope = scopes.find(scope => !allowedScopes.has(scope));
    if (invalidScope) {
      throw new BadRequestException(`Unsupported token scope: ${invalidScope}`);
    }
  }

  private getReplayReadMaxDurationDays(): number {
    const configuredValue = Number(this.configService.get<string>(
      WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS_ENV
    ));

    return Number.isInteger(configuredValue) && configuredValue >= 1 ?
      configuredValue :
      DEFAULT_REPLAY_READ_WORKSPACE_TOKEN_MAX_DURATION_DAYS;
  }

  async isAdminUser(userId: number): Promise<boolean> {
    return !!userId && this.usersService.getUserIsAdmin(userId);
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    return this.usersService.canAccessWorkSpace(userId, workspaceId);
  }
}
