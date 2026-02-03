import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';

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
    const userIdentity = req.user.id; // This is the OIDC Provider UUID
    const params = req.params;

    const user = await this.usersService.findUserByIdentity(userIdentity);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const canAccess = await this.authService.canAccessWorkSpace(user.id, params.workspace_id);
    if (!canAccess) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
