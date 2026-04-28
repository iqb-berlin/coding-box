import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService } from '../../shared/services/user/user.service';
import { AppService } from '../services/app.service';
import { CodingJobBackendService } from '../../coding/services/coding-job-backend.service';
import {
  createAccessDeniedUrlTree,
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree
} from './auth-redirect';
import { createRequiredAuthDataGuardResult, waitForRequiredAuthData } from './auth-data-ready';
import {
  WorkspaceAccessLike,
  getEffectiveCanCode,
  hasMinimumWorkspaceAccess
} from '../../shared/utils/workspace-access';
import { hasAdminBypass } from './admin-access';

interface WorkspaceAccessGuardContext {
  currentUser: WorkspaceAccessLike;
  router: Router;
  state: RouterStateSnapshot;
  userAccessLevel: number;
  workspaceId: string;
  codingJobBackendService: CodingJobBackendService;
}

function getWorkspaceId(route: ActivatedRouteSnapshot): string | null {
  let currentRoute: ActivatedRouteSnapshot | null = route;

  while (currentRoute) {
    const workspaceId = currentRoute.paramMap.get('ws') || currentRoute.paramMap.get('workspace_id');
    if (workspaceId) {
      return workspaceId;
    }
    currentRoute = currentRoute.parent;
  }

  return null;
}

function createWorkspaceAccessGuard(
  isAllowed: (context: WorkspaceAccessGuardContext) => boolean | Promise<boolean>,
  createDeniedRedirect: (context: WorkspaceAccessGuardContext) => UrlTree | Promise<UrlTree>
): CanActivateFn {
  return async (
    route: ActivatedRouteSnapshot
  ): Promise<boolean | UrlTree> => {
    const appService = inject(AppService);
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isLoggedIn()) {
      return createReAuthenticationUrlTree(router, state.url);
    }

    const userService = inject(UserService);
    const codingJobBackendService = inject(CodingJobBackendService);
    const userRoles = authService.getRoles() || [];

    if (hasAdminBypass(userRoles)) {
      return true;
    }

    try {
      const authDataStatus = await waitForRequiredAuthData(appService);
      const authDataGuardResult = createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
      if (authDataGuardResult !== true) {
        return authDataGuardResult;
      }

      if (hasAdminBypass([], appService.authData.isAdmin)) {
        return true;
      }

      const workspaceId = getWorkspaceId(route);
      if (!workspaceId) {
        return createAccessDeniedUrlTree(router, state.url);
      }

      const currentUserId = appService.authData.userId;
      const workspaceUsers = await firstValueFrom(userService.getUsers(Number(workspaceId)));
      const currentUser = workspaceUsers.find(wu => wu.id === currentUserId);

      if (!currentUser) {
        return createAccessDeniedUrlTree(router, state.url);
      }

      const context: WorkspaceAccessGuardContext = {
        currentUser,
        router,
        state,
        userAccessLevel: currentUser.accessLevel || 0,
        workspaceId,
        codingJobBackendService
      };

      if (await isAllowed(context)) {
        return true;
      }

      return await createDeniedRedirect(context);
    } catch {
      return createAuthDataFailedUrlTree(router, state.url);
    }
  };
}

async function hasAssignedCodingJobs(context: WorkspaceAccessGuardContext): Promise<boolean> {
  const workspaceId = Number(context.workspaceId);
  if (!Number.isInteger(workspaceId) || workspaceId < 1) {
    return false;
  }

  try {
    const response = await firstValueFrom(context.codingJobBackendService.getCodingJobs(
      workspaceId,
      undefined,
      1,
      { assignedTo: 'me' }
    ));
    return (response.total ?? response.data.length) > 0;
  } catch {
    return false;
  }
}

export function canActivateAccessLevel(minLevel: number): CanActivateFn {
  return createWorkspaceAccessGuard(
    async context => {
      if (hasMinimumWorkspaceAccess(context.currentUser, minLevel)) {
        return true;
      }

      return minLevel === 1 &&
        (context.currentUser.accessLevel ?? 0) === 1 &&
        await hasAssignedCodingJobs(context);
    },
    async context => {
      const {
        currentUser, router, state, userAccessLevel, workspaceId
      } = context;
      if (userAccessLevel === 2) {
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding`]);
      }
      if (getEffectiveCanCode(currentUser) || await hasAssignedCodingJobs(context)) {
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding/my-jobs`]);
      }

      return createAccessDeniedUrlTree(router, state.url);
    }
  );
}

export function canActivateCodingManagement(): CanActivateFn {
  return createWorkspaceAccessGuard(
    context => hasMinimumWorkspaceAccess(context.currentUser, 3),
    async context => {
      const {
        currentUser, router, state, userAccessLevel, workspaceId
      } = context;

      if (userAccessLevel === 2) {
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding/statistics`]);
      }

      if (getEffectiveCanCode(currentUser) || await hasAssignedCodingJobs(context)) {
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding/my-jobs`]);
      }

      return createAccessDeniedUrlTree(router, state.url);
    }
  );
}

export function canActivateCodingJobs(): CanActivateFn {
  return createWorkspaceAccessGuard(
    async context => getEffectiveCanCode(context.currentUser) || await hasAssignedCodingJobs(context),
    ({
      router, state, userAccessLevel, workspaceId
    }) => {
      if (userAccessLevel >= 2) {
        return router.createUrlTree([`/workspace-admin/${workspaceId}/coding`]);
      }

      return createAccessDeniedUrlTree(router, state.url);
    }
  );
}
