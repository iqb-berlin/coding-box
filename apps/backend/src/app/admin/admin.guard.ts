import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { AuthService } from '../auth/service/auth.service';
import { UsersService } from '../database/services/users';

interface RequestUser {
  id?: number | string;
  userId?: number | string;
  identity?: string;
  sub?: string;
  isAdmin?: boolean;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private usersService: UsersService
  ) {}

  async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const requestUser = req.user as RequestUser | undefined;

    // Prefer the role claim from the validated JWT.
    // This avoids blocking admin actions when the DB flag is stale.
    if (requestUser?.isAdmin === true) {
      return true;
    }

    let userId = getDatabaseUserId(requestUser);

    if (!userId) {
      const userIdentity = getUserIdentity(requestUser);
      if (!userIdentity) {
        throw new UnauthorizedException('User not found');
      }

      const user = await this.usersService.findUserByIdentity(userIdentity);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      userId = user.id;
    }

    const isAdmin = await this.authService.isAdminUser(userId);
    if (!isAdmin) {
      throw new UnauthorizedException('Admin privileges required');
    }

    return true;
  }
}

function getDatabaseUserId(requestUser: RequestUser | undefined): number | undefined {
  return requestUser ?
    parsePositiveInteger(requestUser.userId) ?? parsePositiveInteger(requestUser.id) :
    undefined;
}

function getUserIdentity(requestUser: RequestUser | undefined): string | undefined {
  if (!requestUser) {
    return undefined;
  }

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
