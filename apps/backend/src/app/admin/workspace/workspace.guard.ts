import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/service/auth.service';
import { assertWorkspaceApiTokenScopes } from '../../auth/workspace-token';
import { parseWorkspaceId } from './workspace-id.util';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private reflector: Reflector
  ) {}

  async canActivate(
    context: ExecutionContext
  ) {
    const req = context.switchToHttp().getRequest();
    const userId = req.user.id;
    const params = req.params;
    const workspaceId = parseWorkspaceId(params.workspace_id ?? params.workspaceId);

    if (!workspaceId) {
      throw new UnauthorizedException();
    }

    const rawTokenWorkspaceId = req.user.workspace;
    const tokenWorkspaceId = parseWorkspaceId(rawTokenWorkspaceId);
    if (
      rawTokenWorkspaceId !== undefined &&
      rawTokenWorkspaceId !== null &&
      rawTokenWorkspaceId !== '' &&
      !tokenWorkspaceId
    ) {
      throw new UnauthorizedException();
    }
    if (tokenWorkspaceId && tokenWorkspaceId !== workspaceId) {
      throw new UnauthorizedException();
    }
    assertWorkspaceApiTokenScopes(context, this.reflector, req.user);

    const canAccess = await this.authService.canAccessWorkSpace(userId, workspaceId);
    if (!canAccess) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
