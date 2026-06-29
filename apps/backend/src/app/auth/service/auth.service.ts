import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../database/services/users';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import {
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPES,
  WorkspaceTokenScope
} from '../workspace-token';

export const MAX_WORKSPACE_TOKEN_DURATION_DAYS = 1;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {
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
    this.validateWorkspaceTokenDuration(duration);
    this.validateWorkspaceTokenScopes(scopes);
    const payload = {
      userId: user.id,
      username: user.username,
      sub: user,
      workspace: workspaceId,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: Array.from(new Set(scopes))
    };
    const token = this.jwtService.sign(payload, { expiresIn: `${duration}d` });
    return JSON.stringify(token);
  }

  private validateWorkspaceTokenDuration(duration: number): void {
    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > MAX_WORKSPACE_TOKEN_DURATION_DAYS
    ) {
      throw new BadRequestException(
        `Token duration must be a whole number between 1 and ${MAX_WORKSPACE_TOKEN_DURATION_DAYS} days`
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

  async isAdminUser(userId: number): Promise<boolean> {
    return !!userId && this.usersService.getUserIsAdmin(userId);
  }

  async canAccessWorkSpace(userId: number, workspaceId: number): Promise<boolean> {
    return this.usersService.canAccessWorkSpace(userId, workspaceId);
  }
}
