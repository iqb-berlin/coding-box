import {
  Test, TestingModule
} from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
        Reflector,
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

  it('allows a validated JWT user with database id and identity without another identity lookup', async () => {
    const requestUser = {
      id: 42,
      userId: 42,
      identity: 'oidc-42',
      sub: 'oidc-42',
      isAdmin: false
    };
    const context = createContext(requestUser);
    authService.canAccessWorkSpace.mockResolvedValue(true);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(42, 123);
    expect(context.switchToHttp().getRequest().user).toEqual(requestUser);
  });

  it('supports the workspaceId route used by access management', async () => {
    const context = createContext({ id: 42 });
    context.switchToHttp().getRequest().params = { workspaceId: '123' };
    authService.canAccessWorkSpace.mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(42, 123);
  });

  it.each(['1e2', '1.0', ' 123', '9007199254740992'])(
    'rejects malformed workspace route %s', async workspaceId => {
      await expect(guard.canActivate(createContext({ id: 42 }, workspaceId)))
        .rejects.toThrow(UnauthorizedException);
      expect(authService.canAccessWorkSpace).not.toHaveBeenCalled();
    }
  );

  it('denies an OIDC user without workspace access', async () => {
    usersService.findUserByIdentity.mockResolvedValue({ id: 1 } as never);
    authService.canAccessWorkSpace.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({ id: 'oidc-1' }))).rejects.toThrow(ForbiddenException);
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(1, 123);
  });

  it('returns forbidden for a verified local user without workspace access', async () => {
    authService.canAccessWorkSpace.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({ id: 42, userId: 42 })))
      .rejects.toThrow(ForbiddenException);
    expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(42, 123);
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

  it('returns forbidden when workspace membership was revoked for a valid scoped token', async () => {
    authService.canAccessWorkSpace.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({
      id: 12,
      workspace: 123,
      tokenUse: 'workspace',
      isWorkspaceToken: true
    }))).rejects.toThrow(ForbiddenException);
    expect(authService.canAccessWorkSpace).toHaveBeenCalledWith(12, 123);
  });

  it('denies malformed requests', async () => {
    await expect(guard.canActivate(createContext(undefined))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(createContext({ id: 'oidc-1' }, undefined))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(createContext({ id: 'oidc-1' }, 'workspace-abc'))).rejects.toThrow(UnauthorizedException);
  });
});
