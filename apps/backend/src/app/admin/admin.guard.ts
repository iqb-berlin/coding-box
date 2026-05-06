import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { AuthService } from '../auth/service/auth.service';
import { UsersService } from '../database/services/users';

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

    // Prefer the role claim from the validated JWT.
    // This avoids blocking admin actions when the DB flag is stale.
    if (req.user?.isAdmin === true) {
      return true;
    }

    const userIdentity = req.user?.id;
    if (!userIdentity) {
      throw new UnauthorizedException('User not found');
    }

    const user = await this.usersService.findUserByIdentity(userIdentity);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isAdmin = await this.authService.isAdminUser(user.id);
    if (!isAdmin) {
      throw new UnauthorizedException('Admin privileges required');
    }

    return true;
  }
}
