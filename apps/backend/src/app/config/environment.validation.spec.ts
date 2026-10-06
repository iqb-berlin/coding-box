import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isExportWorkerProcess } from '../export-worker/export-worker-role';
import { validateEnvironment } from './environment.validation';

const database = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'test',
  POSTGRES_PASSWORD: 'synthetic-password',
  POSTGRES_DB: 'test'
};
const api = { ...database, JWT_SECRET: 'synthetic-secret' };

describe('startup environment validation', () => {
  it('preserves secrets and unknown settings, and supplies existing Redis defaults', () => {
    expect(validateEnvironment({ ...api, JWT_SECRET: ' secret with spaces ', EXTRA: 'value' }))
      .toMatchObject({
        APP_ROLE: 'api',
        REDIS_HOST: 'redis',
        REDIS_PORT: '6379',
        REDIS_PREFIX: 'coding-box',
        JWT_SECRET: ' secret with spaces ',
        EXTRA: 'value'
      });
  });

  it.each(['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'JWT_SECRET'])('rejects missing API configuration %s', key => {
    const config: Record<string, unknown> = { ...api };
    delete config[key];
    expect(() => validateEnvironment(config)).toThrow(key);
  });

  it.each(['', ' ', '0', '65536', '6379x', '3.5', '-1', 'NaN', 'Infinity'])('rejects invalid database and Redis ports: %s', value => {
    for (const key of ['POSTGRES_PORT', 'REDIS_PORT']) {
      expect(() => validateEnvironment({ ...api, [key]: value })).toThrow(key);
    }
  });

  it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'JWT_SECRET', 'REDIS_HOST', 'REDIS_PREFIX'])('rejects blank configuration %s', key => {
    expect(() => validateEnvironment({ ...api, [key]: '  ' })).toThrow(key);
  });

  it('requires infrastructure but no API auth settings for the export worker', () => {
    expect(validateEnvironment({ ...database, APP_ROLE: 'export-worker', KEYCLOAK_URL: '' }))
      .toMatchObject({ APP_ROLE: 'export-worker' });
    expect(() => validateEnvironment({ ...database, APP_ROLE: 'export-worker', POSTGRES_DB: '' }))
      .toThrow('POSTGRES_DB');
  });

  it('rejects unknown process roles', () => {
    expect(() => validateEnvironment({ ...api, APP_ROLE: 'export-worker ' })).toThrow('APP_ROLE');
  });

  it('accepts complete Keycloak and explicit OIDC configurations', () => {
    expect(() => validateEnvironment({
      ...api,
      KEYCLOAK_URL: 'https://login.example',
      KEYCLOAK_REALM: 'coding',
      KEYCLOAK_CLIENT_ID: 'coding'
    })).not.toThrow();
    expect(() => validateEnvironment({
      ...api,
      OIDC_ISSUER: 'https://login.example/realms/coding',
      OIDC_JWKS_URI: 'https://login.example/certs',
      KEYCLOAK_CLIENT_ID: 'coding'
    })).not.toThrow();
  });

  it('rejects partial OIDC configuration that would skip issuer or audience verification', () => {
    expect(() => validateEnvironment({ ...api, OIDC_JWKS_URI: 'https://login.example/certs' }))
      .toThrow('KEYCLOAK_CLIENT_ID');
    expect(() => validateEnvironment({
      ...api,
      OIDC_JWKS_URI: 'https://login.example/certs',
      KEYCLOAK_CLIENT_ID: 'coding'
    })).toThrow('KEYCLOAK_REALM');
    expect(() => validateEnvironment({
      ...api,
      OIDC_ISSUER: 'https://login.example/issuer',
      KEYCLOAK_CLIENT_ID: 'coding'
    })).toThrow('OIDC_PROVIDER_URL');
  });

  it.each(['file:///tmp/certs', 'not-a-url', 'https://user:private-token@login.example'])('rejects invalid auth URLs without printing credentials: %s', url => {
    expect(() => validateEnvironment({
      ...api,
      OIDC_ISSUER: url,
      OIDC_JWKS_URI: url,
      KEYCLOAK_CLIENT_ID: 'coding'
    })).toThrow('HTTP(S) URL');
    try {
      validateEnvironment({
        ...api, OIDC_ISSUER: url, OIDC_JWKS_URI: url, KEYCLOAK_CLIENT_ID: 'coding'
      });
    } catch (error) {
      expect(String(error)).not.toContain('private-token');
      expect(String(error)).not.toContain(api.JWT_SECRET);
      expect(String(error)).not.toContain(api.POSTGRES_PASSWORD);
    }
  });

  it('prevents ConfigModule bootstrap when the effective configuration is invalid', async () => {
    await expect(ConfigModule.forRoot({
      ignoreEnvFile: true,
      validate: () => validateEnvironment({ ...api, POSTGRES_PASSWORD: '' })
    }))
      .rejects.toThrow('POSTGRES_PASSWORD');
  });

  it('provides validated values through the real ConfigService', async () => {
    const previous = { ...process.env };
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({
        ignoreEnvFile: true,
        validate: () => validateEnvironment({ ...api, REDIS_PORT: '6380' })
      })]
    }).compile();
    try {
      expect(module.get(ConfigService).get('REDIS_PORT')).toBe('6380');
    } finally {
      await module.close();
      process.env = previous;
    }
  });

  it('uses the env-file role and lets process variables override env-file values', async () => {
    const previous = { ...process.env };
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-config-'));
    const envFilePath = path.join(directory, '.env');
    let module: TestingModule | undefined;
    try {
      for (const key of [...Object.keys(api), 'APP_ROLE', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PREFIX',
        'KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID', 'OIDC_ISSUER', 'OIDC_JWKS_URI', 'OIDC_PROVIDER_URL']) {
        delete process.env[key];
      }
      await fs.writeFile(envFilePath, Object.entries({
        ...database,
        APP_ROLE: 'export-worker',
        POSTGRES_PORT: 'invalid-in-file'
      }).map(([key, value]) => `${key}=${value}`).join('\n'));
      process.env.POSTGRES_PORT = '5432';
      module = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ envFilePath, validate: validateEnvironment })]
      }).compile();
      expect(module.get(ConfigService).get('POSTGRES_PORT')).toBe('5432');
      expect(module.get(ConfigService).get('APP_ROLE')).toBe('export-worker');
      expect(isExportWorkerProcess()).toBe(true);
      expect(module.get(ConfigService).get('JWT_SECRET')).toBeUndefined();
    } finally {
      await module?.close();
      await fs.rm(directory, { recursive: true, force: true });
      process.env = previous;
    }
  });
});
