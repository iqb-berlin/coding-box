import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../database/services/users';

/**
 * Decorator to require a minimum access level for an endpoint
 * @param level Minimum access level required (0=Guest, 1=Coder, 2=Coding Manager, 3=Study Manager, 4=Admin)
 */
export const RequireAccessLevel = (level: number) => SetMetadata('accessLevel', level);

/**
 * Guard to check if user has sufficient access level for a workspace
 */
@Injectable()
export class AccessLevelGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private usersService: UsersService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredLevel = this.reflector.get<number>('accessLevel', context.getHandler());

    // If no access level is specified, allow access
    if (requiredLevel === undefined || requiredLevel === null) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('User ID not found in request');
    }

    // Get workspace ID from route params
    const workspaceId = parseInt(request.params.workspace_id, 10);

    if (!workspaceId || Number.isNaN(workspaceId) || workspaceId <= 0) {
      throw new UnauthorizedException('Workspace ID not found in request');
    }

    // Check if user is system admin
    const isAdmin = await this.usersService.getUserIsAdmin(userId);
    if (isAdmin) {
      return true; // System admins have access to everything
    }

    // Get workspace user access level
    const userAccessLevel = await this.usersService.getUserAccessLevel(userId, workspaceId);

    if (userAccessLevel === null) {
      throw new UnauthorizedException(`User does not have access to workspace ${workspaceId}`);
    }

    // Check if user has sufficient access level
    if (userAccessLevel < requiredLevel) {
      throw new UnauthorizedException(
        `Access level ${requiredLevel} required. Current user has level ${userAccessLevel}`
      );
    }

    return true;
  }
}
