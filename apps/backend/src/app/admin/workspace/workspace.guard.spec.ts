import {
  Test, TestingModule
} from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WorkspaceGuard } from './workspace.guard';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';

describe('WorkspaceGuard (Backend)', () => {
  let guard: WorkspaceGuard;
  let authService: jest.Mocked<AuthService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceGuard,
        {
          provide: AuthService,
          useValue: {
            canAccessWorkSpace: jest.fn()
          }
        },
        {
          provide: UsersService,
          useValue: {
            findUserByIdentity: jest.fn()
          }
        }
      ]
    }).compile();

    guard = module.get<WorkspaceGuard>(WorkspaceGuard);
    authService = module.get(AuthService);
    usersService = module.get(UsersService);
  });

  const createContext = (
    user: Record<string, unknown> | undefined,
    workspaceId: string | undefined = '123'
  ): ExecutionContext => {
    const request = {
      user,
      params: workspaceId === undefined ? {} : { workspace_id: workspaceId }
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request
      })
    } as unknown as ExecutionContext;
  };

  it('allows an OIDC user with workspace access and normalizes the request user id', async () => {
    const requestUser = { id: 'oidc-1', isAdmin: false };
    const context = createContext(requestUser);
    usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
    authService.canAccessWorkSpace.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(usersService.findUserByIdentity).toHaveBeenCalledWith('oidc-1');
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
    expect(context.switchToHttp().getRequest().user).toEqual({
      id: 1,
      userId: 1,
      identity: 'oidc-1',
      isAdmin: false
    });
  });

  it('denies an OIDC user without workspace access', async () => {
    usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
    authService.canAccessWorkSpace.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({ id: 'oidc-1' }))).rejects.toThrow(UnauthorizedException);
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
  });

  it('denies an OIDC user that is unknown locally', async () => {
    usersService.findUserByIdentity.mockResolvedValue(null);

    await expect(guard.canActivate(createContext({ id: 'oidc-1' }))).rejects.toThrow(UnauthorizedException);
    expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
  });

  it('allows a workspace token for its own workspace', async () => {
    authService.canAccessWorkSpace.mockResolvedValue(true);

    const result = await guard.canActivate(createContext({
      id: 12,
      workspace: 123,
      tokenUse: 'workspace',
      isWorkspaceToken: true
    }));

    expect(result).toBe(true);
    expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(12, 123);
  });

  it('denies a workspace token for another workspace', async () => {
    await expect(guard.canActivate(createContext({
      id: 12,
      workspace: 456,
      tokenUse: 'workspace',
      isWorkspaceToken: true
    }))).rejects.toThrow(UnauthorizedException);

    expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
  });

  it('denies malformed requests', async () => {
    await expect(guard.canActivate(createContext(undefined))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(createContext({ id: 'oidc-1' }, undefined))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(createContext({ id: 'oidc-1' }, 'workspace-abc'))).rejects.toThrow(UnauthorizedException);
  });
});
