import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Request } from 'express';
import { WorkspaceTokenStrategy } from './workspace-token.strategy';
import {
  WORKSPACE_API_TOKEN_TYPE, WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE, WORKSPACE_TOKEN_SCOPE_REPLAY_READ
} from './workspace-token';
import { WORKSPACE_TOKEN_AUDIENCE, WORKSPACE_TOKEN_ISSUER } from './workspace-token.constants';

describe('WorkspaceTokenStrategy', () => {
  const createStrategy = (legacyEnabled: string | boolean = true) => new WorkspaceTokenStrategy(new ConfigService({
    JWT_SECRET: 'jwt-secret', ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS: legacyEnabled
  }));
  const modernPayload = {
    token_use: 'workspace',
    iss: WORKSPACE_TOKEN_ISSUER,
    aud: WORKSPACE_TOKEN_AUDIENCE,
    userId: 12,
    username: 'coder',
    workspace: 7,
    scopes: [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE]
  };
  const legacyPayload = {
    userId: 12,
    username: 'coder',
    sub: { identity: 'oidc-subject' },
    workspace: 7,
    tokenType: WORKSPACE_API_TOKEN_TYPE,
    scopes: [WORKSPACE_TOKEN_SCOPE_REPLAY_READ]
  };

  async function authenticate(payload: Record<string, unknown>, options: {
    legacyEnabled?: string | boolean; secret?: string; algorithm?: JwtSignOptions['algorithm'];
  } = {}): Promise<{ user?: Awaited<ReturnType<WorkspaceTokenStrategy['validate']>>; error?: string }> {
    const strategy = createStrategy(options.legacyEnabled);
    const claims = Object.fromEntries(Object.entries({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })
      .filter(([, value]) => value !== undefined));
    const token = new JwtService().sign(claims, {
      secret: options.secret ?? 'jwt-secret',
      algorithm: options.algorithm ?? 'HS256'
    });
    return new Promise(resolve => {
      strategy.success = user => resolve({ user });
      strategy.fail = error => resolve({ error: (error as Error)?.message || 'Unauthorized' });
      strategy.error = error => resolve({ error: error.message });
      strategy.authenticate({ headers: { authorization: `Bearer ${token}` } } as Request, {});
    });
  }

  it('maps a valid workspace token payload to the request user', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      iss: WORKSPACE_TOKEN_ISSUER,
      aud: WORKSPACE_TOKEN_AUDIENCE,
      token_use: 'workspace',
      userId: 12,
      username: 'coder',
      workspace: 7,
      scopes: [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE]
    })).resolves.toEqual({
      userId: 12,
      id: 12,
      name: 'coder',
      workspace: 7,
      tokenUse: 'workspace',
      tokenType: WORKSPACE_API_TOKEN_TYPE,
      scopes: [WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE],
      isWorkspaceToken: true
    });
  });

  it('rejects non-workspace tokens', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      userId: 12,
      workspace: 7
    })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed workspace token payloads', async () => {
    const strategy = createStrategy();

    await expect(strategy.validate({
      token_use: 'workspace',
      userId: 'not-a-number',
      workspace: 7
    })).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a signed current-format token with legacy compatibility disabled', async () => {
    const result = await authenticate(modernPayload, { legacyEnabled: false });
    expect(result.user).toMatchObject({ userId: 12, workspace: 7, scopes: modernPayload.scopes });
  });

  it('accepts an unexpired token issued by develop with its original scopes', async () => {
    const result = await authenticate(legacyPayload);
    expect(result.user).toMatchObject({
      userId: 12, workspace: 7, tokenType: WORKSPACE_API_TOKEN_TYPE, scopes: legacyPayload.scopes
    });
  });

  it('limits a scope-less legacy token to replay reading', async () => {
    const result = await authenticate({ ...legacyPayload, tokenType: undefined, scopes: undefined });
    expect(result.user?.scopes).toEqual([WORKSPACE_TOKEN_SCOPE_REPLAY_READ]);
  });

  it('does not turn malformed legacy scopes into replay permission', async () => {
    const result = await authenticate({ ...legacyPayload, scopes: 'replay:read' });
    expect(result.user?.scopes).toEqual([]);
  });

  it.each([false, 'false', '0', 'no', 'off'])('rejects legacy tokens when compatibility is %s', async legacyEnabled => {
    const result = await authenticate(legacyPayload, { legacyEnabled });
    expect(result.user).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it.each([
    { iss: undefined }, { iss: 'https://foreign-issuer.test' },
    { aud: undefined }, { aud: 'another-audience' }, { token_use: 'another-token-type' }
  ])('rejects invalid current-format claims without falling back to legacy: %j', async claims => {
    const result = await authenticate({ ...modernPayload, ...claims });
    expect(result.user).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it.each([
    { iss: 'https://foreign-issuer.test' }, { aud: 'another-audience' },
    { token_use: 'another-token-type' }, { tokenType: 'another-token-type' }, { exp: undefined }
  ])('rejects non-legacy claims on an old-format payload: %j', async claims => {
    const result = await authenticate({ ...legacyPayload, ...claims });
    expect(result.user).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  describe.each([['current', modernPayload], ['legacy', legacyPayload]])('%s token validation', (_format, payload) => {
    it.each([
      { secret: 'wrong-signing-secret' }, { algorithm: 'HS384' as JwtSignOptions['algorithm'] }
    ])('rejects invalid signature or algorithm: %j', async options => {
      const result = await authenticate(payload, options);
      expect(result.user).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('rejects expired tokens', async () => {
      const result = await authenticate({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 });
      expect(result.user).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it.each([{ userId: 0 }, { workspace: -1 }, { userId: 'invalid' }, { userId: true }])('rejects malformed ids: %j', async ids => {
      const result = await authenticate({ ...payload, ...ids });
      expect(result.user).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});
