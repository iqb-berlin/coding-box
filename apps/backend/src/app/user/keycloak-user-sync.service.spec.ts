import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { of, Subject, throwError } from 'rxjs';
import { UsersService } from '../database/services/users';
import { KeycloakUserSyncService } from './keycloak-user-sync.service';
import { parseKeycloakUserSyncConfig } from './keycloak-user-sync.config';

const config = {
  KEYCLOAK_USER_SYNC_ENABLED: 'true',
  KEYCLOAK_USER_SYNC_USERS_URL: 'https://login.example/admin/realms/coding/users',
  KEYCLOAK_USER_SYNC_CLIENT_ID: 'directory-client',
  KEYCLOAK_USER_SYNC_CLIENT_SECRET: 'synthetic-secret',
  OIDC_TOKEN_ENDPOINT: 'https://login.example/realms/coding/protocol/openid-connect/token',
  OIDC_ISSUER: 'https://login.example/realms/coding'
};
const profile = {
  id: 'subject', username: 'new-coder', enabled: true, firstName: 'Ada', lastName: 'Lovelace'
};

describe('Keycloak directory configuration', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(parseKeycloakUserSyncConfig({})).toBeUndefined();
    expect(parseKeycloakUserSyncConfig({ KEYCLOAK_USER_SYNC_ENABLED: 'false' })).toBeUndefined();
    expect(() => parseKeycloakUserSyncConfig({ KEYCLOAK_USER_SYNC_ENABLED: 'yes' })).toThrow('true or false');
  });

  it.each(['KEYCLOAK_USER_SYNC_USERS_URL', 'KEYCLOAK_USER_SYNC_CLIENT_ID',
    'KEYCLOAK_USER_SYNC_CLIENT_SECRET', 'OIDC_TOKEN_ENDPOINT', 'OIDC_ISSUER'])('requires %s when enabled', key => {
    expect(() => parseKeycloakUserSyncConfig({ ...config, [key]: '' })).toThrow(key);
  });

  it.each(['file:///etc/users', 'https://user:secret@login.example/users', 'https://login.example/users?token=secret'])('rejects unsafe URLs without exposing their contents', url => {
    expect(() => parseKeycloakUserSyncConfig({ ...config, KEYCLOAK_USER_SYNC_USERS_URL: url }))
      .toThrow('KEYCLOAK_USER_SYNC_USERS_URL must be an HTTP(S) URL');
  });
});

describe('KeycloakUserSyncService', () => {
  const http = { get: jest.fn(), post: jest.fn() };
  const users = { syncKeycloakUser: jest.fn() };
  const runner = {
    connect: jest.fn(), query: jest.fn(), release: jest.fn(), manager: {}
  };
  const database = { createQueryRunner: jest.fn(() => runner) };
  let service: KeycloakUserSyncService;
  let errors: jest.SpyInstance;

  const createService = (env: Record<string, unknown> = config) => new KeycloakUserSyncService(
    { get: (key: string) => env[key] } as ConfigService,
    http as unknown as HttpService,
    users as unknown as UsersService,
    database as unknown as DataSource
  );

  beforeEach(() => {
    jest.clearAllMocks();
    http.post.mockReturnValue(of({ data: { access_token: 'synthetic-token' } }));
    http.get.mockReturnValue(of({ data: [] }));
    runner.query.mockResolvedValue([{ locked: true }]);
    users.syncKeycloakUser.mockResolvedValue(7);
    service = createService();
    const logger = (service as unknown as { logger: { log: () => void; warn: () => void; error: () => void } }).logger;
    jest.spyOn(logger, 'log').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    errors = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  it('does no work when disabled', async () => {
    await createService({}).synchronize();
    expect(database.createQueryRunner).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('imports enabled people before login and continues past short pages', async () => {
    http.get.mockReturnValueOnce(of({
      data: [profile, { ...profile, id: 'disabled', enabled: false },
        { ...profile, id: 'service', serviceAccountClientId: 'technical-client' }, null]
    }))
      .mockReturnValueOnce(of({ data: [{ ...profile, id: 'next', username: 'next-coder' }] }))
      .mockReturnValueOnce(of({ data: [] }));
    await service.synchronize();
    expect(users.syncKeycloakUser).toHaveBeenCalledTimes(2);
    expect(users.syncKeycloakUser).toHaveBeenCalledWith({
      identity: 'subject',
      issuer: config.OIDC_ISSUER,
      username: 'new-coder',
      firstName: 'Ada',
      lastName: 'Lovelace',
      isAdmin: false
    }, runner.manager);
    expect(http.get.mock.calls.map(call => call[1].params.first)).toEqual([0, 100, 200]);
    expect(http.get).toHaveBeenCalledWith(config.KEYCLOAK_USER_SYNC_USERS_URL, expect.objectContaining({
      params: {
        enabled: true, briefRepresentation: false, first: 0, max: 100
      },
      maxRedirects: 0,
      timeout: 10_000
    }));
    const body = new URLSearchParams(http.post.mock.calls[0][1]);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('directory-client');
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('skips a conflicting account and still imports subsequent accounts', async () => {
    http.get.mockReturnValueOnce(of({ data: [profile, { ...profile, id: 'second' }] })).mockReturnValueOnce(of({ data: [] }));
    users.syncKeycloakUser.mockRejectedValueOnce(new Error('identity conflict'));
    await service.synchronize();
    expect(users.syncKeycloakUser).toHaveBeenCalledTimes(2);
  });

  it('skips a concurrent run in this process and another API instance', async () => {
    const token = new Subject<never>();
    http.post.mockReturnValueOnce(token);
    const first = service.synchronize();
    await Promise.resolve();
    await Promise.resolve();
    await service.synchronize();
    expect(database.createQueryRunner).toHaveBeenCalledTimes(1);
    token.error(new Error('unavailable'));
    await first;
    runner.query.mockResolvedValueOnce([{ locked: false }]);
    await service.synchronize();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(2);
  });

  it('retries after provider failure and never logs credentials or profiles', async () => {
    http.get.mockReturnValueOnce(throwError(() => ({
      isAxiosError: true, response: { status: 503, data: profile }, config: { secret: config.KEYCLOAK_USER_SYNC_CLIENT_SECRET }
    })));
    await service.synchronize();
    expect(errors).toHaveBeenCalledWith({ event: 'keycloak-user-sync.failed', status: 503 });
    expect(JSON.stringify(errors.mock.calls)).not.toContain('synthetic-secret');
    expect(JSON.stringify(errors.mock.calls)).not.toContain('new-coder');
    await service.synchronize();
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('recovers when creating the database connection fails before the run starts', async () => {
    database.createQueryRunner.mockImplementationOnce(() => { throw new Error('database unavailable'); });
    await service.synchronize();
    expect(runner.release).not.toHaveBeenCalled();
    await service.synchronize();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('stops malformed or repeating directory responses', async () => {
    http.get.mockReturnValueOnce(of({ data: [profile] })).mockReturnValueOnce(of({ data: [profile] }));
    await service.synchronize();
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(users.syncKeycloakUser).toHaveBeenCalledTimes(1);
    http.get.mockReturnValueOnce(of({ data: { users: [profile] } }));
    await service.synchronize();
    expect(errors).toHaveBeenCalledTimes(2);
  });
});
