import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { WORKSPACE_TOKEN_USE } from '../../auth/workspace-token.constants';

interface RequestUser {
  id?: number | string;
  userId?: number | string;
  identity?: string;
  sub?: string;
  workspace?: number | string;
  tokenUse?: string;
  isWorkspaceToken?: boolean;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private usersService: UsersService
  ) {}

  async canActivate(
    context: ExecutionContext
  ) {
    const req = context.switchToHttp().getRequest();
    const requestUser = req.user as RequestUser | undefined;
    const params = req.params;
    const workspaceId = Number(params?.workspace_id);

    if (!Number.isInteger(workspaceId) || workspaceId <= 0 || !requestUser) {
      throw new UnauthorizedException();
    }

    if (requestUser.isWorkspaceToken || requestUser.tokenUse === WORKSPACE_TOKEN_USE) {
      const tokenWorkspace = Number(requestUser.workspace);
      const userId = getDatabaseUserId(requestUser);
      if (tokenWorkspace !== workspaceId || !Number.isInteger(userId) || userId <= 0) {
        throw new UnauthorizedException();
      }

      const canAccess = await this.authService.canAccessWorkSpace(userId, workspaceId);
      if (!canAccess) {
        throw new UnauthorizedException();
      }
      return true;
    }

    let userId = getDatabaseUserId(requestUser);
    const userIdentity = getUserIdentity(requestUser);

    if (!userId) {
      if (!userIdentity) {
        throw new UnauthorizedException('User not found');
      }

      const user = await this.usersService.findUserByIdentity(userIdentity);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      userId = user.id;
    }

    req.user = {
      ...requestUser,
      id: userId,
      userId,
      ...(userIdentity ? { identity: userIdentity } : {})
    };

    const canAccess = await this.authService.canAccessWorkSpace(userId, workspaceId);
    if (!canAccess) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function getDatabaseUserId(requestUser: RequestUser): number | undefined {
  return parsePositiveInteger(requestUser.userId) ?? parsePositiveInteger(requestUser.id);
}

function getUserIdentity(requestUser: RequestUser): string | undefined {
  const identity = requestUser.identity ?? requestUser.sub;
  if (identity?.trim()) {
    return identity.trim();
  }

  if (typeof requestUser.id === 'string' && !parsePositiveInteger(requestUser.id) && requestUser.id.trim()) {
    return requestUser.id.trim();
  }

  return undefined;
}

function parsePositiveInteger(value: number | string | undefined): number | undefined {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : undefined;
}
