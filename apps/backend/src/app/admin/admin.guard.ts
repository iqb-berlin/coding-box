import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException
} from '@nestjs/common';
import { AuthService } from '../auth/service/auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private authService: AuthService
  ) {}

  async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user.id;

    const isAdmin = await this.authService.isAdminUser(userId);
    if (!isAdmin) {
      throw new UnauthorizedException('Admin privileges required');
    }

    return true;
  }
}
