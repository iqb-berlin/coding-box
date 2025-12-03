import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  CanActivateFn,
  UrlTree,
  Router
} from '@angular/router';
import { inject } from '@angular/core';
import {
  catchError,
  firstValueFrom,
  of,
  filter,
  timeout
} from 'rxjs';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { AuthService } from '../services/auth.service';
import { UserService } from '../../services/user.service';
import { AppService } from '../../services/app.service';

/**
 * Guard factory that creates a route guard checking for minimum access level
 * @param minLevel Minimum access level required (1=Coder, 2=Coding Manager, 3=Study Manager, 4=Admin)
 * @returns CanActivateFn that checks if user has sufficient access level
 */
export function canActivateAccessLevel(minLevel: number): CanActivateFn {
  const isAccessAllowed = async (
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
    authData: AuthGuardData
  ): Promise<boolean | UrlTree> => {
    const { authenticated } = authData;
    if (!authenticated) {
      return false;
    }

    const authService = inject(AuthService);
    const userService = inject(UserService);
    const appService = inject(AppService);
    const router = inject(Router);

    // Check if user is system admin (bypass access level check)
    const userRoles = authService.getRoles();
    const adminRoles = ['admin', 'system-admin', 'sys-admin', 'administrator'];
    const hasAdminRole = userRoles.some((role: string) => adminRoles.includes(role.toLowerCase()));

    if (hasAdminRole) {
      return true;
    }

    // Get workspace ID from route params
    const workspaceId = route.paramMap.get('ws') || route.paramMap.get('workspace_id');
    if (!workspaceId) {
      return false;
    }

    try {
      // Get current user ID from authData - filter out the default value with userId: 0
      const userAuthData = await firstValueFrom(
        appService.authData$.pipe(
          filter(data => data.userId > 0),
          timeout(5000)
        )
      );
      const currentUserId = userAuthData.userId;

      // Fetch workspace users with access levels
      const workspaceUsers = await firstValueFrom(
        userService.getUsers(Number(workspaceId)).pipe(
          catchError(() => of([]))
        )
      );

      // Find current user in workspace users list by ID
      const currentUser = workspaceUsers.find(wu => wu.id === currentUserId);

      if (!currentUser) {
        return false;
      }

      const userAccessLevel = currentUser.accessLevel || 0;

      // Check if user has sufficient access level
      if (userAccessLevel >= minLevel) {
        return true;
      }

      // Redirect to appropriate section based on user's access level
      if (userAccessLevel === 2) {
        // Coding Manager: redirect to coding section
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding`]);
      }
      if (userAccessLevel === 1) {
        // Coder: redirect to their jobs
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding/my-jobs`]);
      }

      // No sufficient access: redirect to home
      return router.createUrlTree(['/']);
    } catch (error) {
      return false;
    }
  };

  return createAuthGuard<CanActivateFn>(isAccessAllowed);
}
