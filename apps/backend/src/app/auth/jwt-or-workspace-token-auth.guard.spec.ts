import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtOrWorkspaceTokenAuthGuard } from './jwt-or-workspace-token-auth.guard';
import {
  AllowAnyWorkspaceTokenScopes,
  AllowWorkspaceTokenScopes,
  WORKSPACE_API_TOKEN_TYPE,
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
} from './workspace-token';
import { WORKSPACE_TOKEN_STRATEGY } from './workspace-token.constants';

describe('JwtOrWorkspaceTokenAuthGuard (Backend)', () => {
  let guard: JwtOrWorkspaceTokenAuthGuard;
  let passportCanActivateSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtOrWorkspaceTokenAuthGuard,
        Reflector
      ]
    }).compile();

    guard = module.get<JwtOrWorkspaceTokenAuthGuard>(JwtOrWorkspaceTokenAuthGuard);
    passportCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(JwtOrWorkspaceTokenAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    passportCanActivateSpy.mockRestore();
  });

  const createContext = (
    user: Record<string, unknown>,
    handler: () => void = jest.fn()
  ): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ user })
    }),
    getHandler: () => handler,
    getClass: () => class TestController {}
  } as unknown as ExecutionContext);

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should extend AuthGuard with jwt and workspace token strategies', () => {
    expect(guard).toBeInstanceOf(AuthGuard(['jwt', WORKSPACE_TOKEN_STRATEGY]));
  });

  it('should allow regular authenticated users without workspace token scope metadata', async () => {
    await expect(guard.canActivate(createContext({ id: 1 }))).resolves.toBe(true);
  });

  it('should reject workspace API tokens without allowed scope metadata', async () => {
    await expect(guard.canActivate(createContext({
      id: 1,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    }))).rejects.toThrow(UnauthorizedException);
  });

  it('should allow workspace API tokens when the endpoint allows the token scope', async () => {
    const handler = jest.fn();
    AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)(handler);

    await expect(guard.canActivate(createContext({
      id: 1,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    }, handler))).resolves.toBe(true);
  });

  it('should allow workspace API tokens when any configured scope alternative matches', async () => {
    const handler = jest.fn();
    AllowAnyWorkspaceTokenScopes(
      WORKSPACE_TOKEN_SCOPE_REPLAY_READ,
      WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE
    )(handler);

    await expect(guard.canActivate(createContext({
      id: 1,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE]
    }, handler))).resolves.toBe(true);
  });

  it('should reject workspace API tokens without a matching token scope', async () => {
    const handler = jest.fn();
    AllowWorkspaceTokenScopes(WORKSPACE_TOKEN_SCOPE_REPLAY_READ)(handler);

    await expect(guard.canActivate(createContext({
      id: 1,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE]
    }, handler))).rejects.toThrow(UnauthorizedException);
  });

  it('should return false when passport authentication fails without checking scopes', async () => {
    passportCanActivateSpy.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({
      id: 1,
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
    }))).resolves.toBe(false);
  });
});
