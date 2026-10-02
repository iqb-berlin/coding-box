import { Router, UrlTree } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { UserService } from '../../shared/services/user/user.service';
import {
  canActivatePersonalCodingJobs,
  createPersonalCodingJobsGuardResult,
  userHasAnyManagementWorkspaceAccess
} from './personal-coding-jobs.guard';

describe('Personal Coding Jobs Guard', () => {
  let router: jest.Mocked<Router>;
  const authData: AuthDataDto = {
    userId: 7,
    userName: 'Test User',
    email: '',
    firstName: '',
    lastName: '',
    isAdmin: false,
    workspaces: []
  };

  beforeEach(() => {
    router = {
      createUrlTree: jest.fn().mockReturnValue({ redirect: true } as unknown as UrlTree)
    } as unknown as jest.Mocked<Router>;
  });

  it('is defined and importable', () => {
    expect(canActivatePersonalCodingJobs).toBeDefined();
    expect(typeof canActivatePersonalCodingJobs).toBe('function');
  });

  it('allows non-admin users on the personal coding jobs route', () => {
    const result = createPersonalCodingJobsGuardResult(router, '/coding', 'ready', authData, ['user']);

    expect(result).toBe(true);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects workspace managers away from the top-level personal coding jobs route', () => {
    const result = createPersonalCodingJobsGuardResult(router, '/coding', 'ready', authData, ['user'], true);

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home']);
  });

  it('redirects database admins away from the personal coding jobs route', () => {
    const result = createPersonalCodingJobsGuardResult(
      router,
      '/coding',
      'ready',
      { ...authData, isAdmin: true },
      ['user']
    );

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home']);
  });

  it('redirects OIDC admins away from the personal coding jobs route', () => {
    const result = createPersonalCodingJobsGuardResult(router, '/coding', 'ready', authData, ['admin']);

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home']);
  });

  it('preserves auth-data failure redirects', () => {
    const result = createPersonalCodingJobsGuardResult(router, '/coding', 'auth-data-failed', authData, ['user']);

    expect(result).toEqual({ redirect: true });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/home'], {
      queryParams: {
        auth: 'auth-data-failed',
        returnUrl: '/coding'
      }
    });
  });

  it('detects management access across the users workspaces', async () => {
    const userService = {
      getUsers: jest.fn((workspaceId: number) => of(workspaceId === 2 ?
        [{ id: 7, accessLevel: 2, canCode: true }] :
        [{ id: 7, accessLevel: 1, canCode: true }]))
    } as unknown as Pick<UserService, 'getUsers'>;

    await expect(userHasAnyManagementWorkspaceAccess(
      {
        ...authData,
        workspaces: [{ id: 1 }, { id: 2 }]
      },
      userService
    )).resolves.toBe(true);

    expect(userService.getUsers).toHaveBeenCalledWith(1);
    expect(userService.getUsers).toHaveBeenCalledWith(2);
  });

  it('does not treat pure coders as workspace managers', async () => {
    const userService = {
      getUsers: jest.fn(() => of([{ id: 7, accessLevel: 1, canCode: true }]))
    } as unknown as Pick<UserService, 'getUsers'>;

    await expect(userHasAnyManagementWorkspaceAccess(
      {
        ...authData,
        workspaces: [{ id: 1 }]
      },
      userService
    )).resolves.toBe(false);
  });

  it('does not silently allow coding when workspace access cannot be loaded', async () => {
    const userService = {
      getUsers: jest.fn(() => throwError(() => new Error('access failed')))
    } as unknown as Pick<UserService, 'getUsers'>;

    await expect(userHasAnyManagementWorkspaceAccess(
      {
        ...authData,
        workspaces: [{ id: 1 }]
      },
      userService
    )).rejects.toThrow('access failed');
  });
});
