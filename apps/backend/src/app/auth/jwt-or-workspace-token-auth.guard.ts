import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { WORKSPACE_TOKEN_STRATEGY } from './workspace-token.constants';
import { assertWorkspaceApiTokenScopes } from './workspace-token';

@Injectable()
export class JwtOrWorkspaceTokenAuthGuard extends AuthGuard(['jwt', WORKSPACE_TOKEN_STRATEGY]) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const canActivate = await super.canActivate(context);
    if (!canActivate) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    assertWorkspaceApiTokenScopes(context, this.reflector, request.user);
    return true;
  }
}
