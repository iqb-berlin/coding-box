import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { WORKSPACE_TOKEN_USE } from '../../auth/workspace-token.constants';

interface RequestUser {
  id?: number | string;
  userId?: number | string;
  identity?: string;
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

    if (!Number.isInteger(workspaceId) || workspaceId <= 0 || !requestUser?.id) {
      throw new UnauthorizedException();
    }

    if (requestUser.isWorkspaceToken || requestUser.tokenUse === WORKSPACE_TOKEN_USE) {
      const tokenWorkspace = Number(requestUser.workspace);
      const userId = Number(requestUser.id ?? requestUser.userId);
      if (tokenWorkspace !== workspaceId || !Number.isInteger(userId) || userId <= 0) {
        throw new UnauthorizedException();
      }

      const canAccess = await this.authService.canAccessWorkSpace(userId, workspaceId);
      if (!canAccess) {
        throw new UnauthorizedException();
      }
      return true;
    }

    const userIdentity = String(requestUser.id); // This is the OIDC Provider UUID
    const user = await this.usersService.findUserByIdentity(userIdentity);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    req.user = {
      ...requestUser,
      id: user.id,
      userId: user.id,
      identity: userIdentity
    };

    const canAccess = await this.authService.canAccessWorkSpace(user.id, workspaceId);
    if (!canAccess) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
