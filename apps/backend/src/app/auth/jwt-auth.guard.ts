import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { assertWorkspaceApiTokenScopes } from './workspace-token';
import { getAuthProviderFailure } from './auth-provider-errors';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override handleRequest<TUser = unknown>(error: unknown, user: TUser, info: unknown, context: ExecutionContext): TUser {
    if (!error && !user) {
      const failure = getAuthProviderFailure(info);
      if (failure) throw failure;
    }
    return super.handleRequest(error, user, info, context);
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
