import {
  ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree
} from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { createAuthGuard, AuthGuardData } from 'keycloak-angular';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { AppService } from '../services/app.service';
import { AuthService } from '../services/auth.service';
import { WorkspaceBackendService } from '../../workspace/services/workspace-backend.service';
import {
  createAuthDataFailedUrlTree,
  createReAuthenticationUrlTree
} from './auth-redirect';
import {
  RequiredAuthDataStatus,
  createRequiredAuthDataGuardResult,
  waitForRequiredAuthData
} from './auth-data-ready';
import { hasAdminBypass } from './admin-access';
import { hasManagementWorkspaceAccess } from '../../shared/utils/workspace-access';

export async function userHasAnyManagementWorkspaceAccess(
  authData: AuthDataDto,
  workspaceBackendService: Pick<WorkspaceBackendService, 'getWorkspaceUsers'>
): Promise<boolean> {
  if (!authData.workspaces || authData.workspaces.length === 0 || authData.userId <= 0) {
    return false;
  }

  const workspaceIds = authData.workspaces
    .map(workspace => workspace.id)
    .filter(workspaceId => Number.isInteger(workspaceId) && workspaceId > 0);

  if (workspaceIds.length === 0) {
    return false;
  }

  try {
    const responses = await firstValueFrom(forkJoin(
      workspaceIds.map(workspaceId => workspaceBackendService.getWorkspaceUsers(workspaceId))
    ));

    return responses.some(response => response.data.some(user => (
      user.userId === authData.userId && hasManagementWorkspaceAccess(user)
    )));
  } catch {
    return false;
  }
}

export function createPersonalCodingJobsGuardResult(
  router: Router,
  stateUrl: string,
  authDataStatus: RequiredAuthDataStatus,
  authData: AuthDataDto,
  userRoles: string[] = [],
  hasAnyManagementWorkspaceAccess = false
): true | UrlTree {
  const authDataGuardResult = createRequiredAuthDataGuardResult(router, stateUrl, authDataStatus);
  if (authDataGuardResult !== true) {
    return authDataGuardResult;
  }

  if (hasAdminBypass(userRoles, authData.isAdmin) || hasAnyManagementWorkspaceAccess) {
    return router.createUrlTree(['/home']);
  }

  return true;
}

const isAccessAllowed = async (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
  authGuardData: AuthGuardData
): Promise<boolean | UrlTree> => {
  const appService = inject(AppService);
  const authService = inject(AuthService);
  const workspaceBackendService = inject(WorkspaceBackendService);
  const router = inject(Router);

  if (!authGuardData.authenticated) {
    return createReAuthenticationUrlTree(router, state.url);
  }

  try {
    const authDataStatus = await waitForRequiredAuthData(appService);
    const authDataGuardResult = createRequiredAuthDataGuardResult(router, state.url, authDataStatus);
    if (authDataGuardResult !== true) {
      return authDataGuardResult;
    }

    const userRoles = authService.getRoles() || [];
    if (hasAdminBypass(userRoles, appService.authData.isAdmin)) {
      return createPersonalCodingJobsGuardResult(
        router,
        state.url,
        authDataStatus,
        appService.authData,
        userRoles
      );
    }

    const hasAnyManagementAccess = await userHasAnyManagementWorkspaceAccess(
      appService.authData,
      workspaceBackendService
    );

    return createPersonalCodingJobsGuardResult(
      router,
      state.url,
      authDataStatus,
      appService.authData,
      userRoles,
      hasAnyManagementAccess
    );
  } catch {
    return createAuthDataFailedUrlTree(router, state.url);
  }
};

export const canActivatePersonalCodingJobs = createAuthGuard<CanActivateFn>(isAccessAllowed);
