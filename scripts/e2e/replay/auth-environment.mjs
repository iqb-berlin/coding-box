import { randomBytes } from 'node:crypto';
import { chown, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FILE_ACCESS_USERS } from './file-access-users.mjs';

export async function prepareAuthEnvironment(
  runDir,
  keycloakPort,
  frontendPort,
  connectHost = '127.0.0.1'
) {
  const url = `http://${connectHost}:${keycloakPort}`;
  const origin = `http://${connectHost}:${frontendPort}`;
  const password = randomBytes(24).toString('hex');
  const adminPassword = randomBytes(24).toString('hex');
  const realm = {
    realm: 'coding-e2e',
    enabled: true,
    sslRequired: 'none',
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 600,
    ssoSessionMaxLifespan: 1800,
    roles: { realm: [{ name: 'admin' }] },
    clients: [
      {
        clientId: 'replay-e2e',
        publicClient: true,
        standardFlowEnabled: true,
        redirectUris: [`${origin}/*`],
        webOrigins: [origin],
        defaultClientScopes: [
          'basic',
          'web-origins',
          'profile',
          'roles',
          'email'
        ],
        attributes: { 'pkce.code.challenge.method': 'S256' }
      }
    ],
    users: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        username: 'coding-e2e',
        enabled: true,
        emailVerified: true,
        email: 'coding-e2e@example.invalid',
        firstName: 'Coding',
        lastName: 'E2E',
        realmRoles: ['admin'],
        clientRoles: { account: ['manage-account', 'view-profile'] },
        credentials: [{ type: 'password', value: password, temporary: false }]
      },
      ...FILE_ACCESS_USERS.map(user => ({
        id: user.identity,
        username: user.username,
        enabled: true,
        emailVerified: true,
        email: `${user.username}@example.invalid`,
        firstName: 'Files',
        lastName: 'E2E',
        realmRoles: [],
        clientRoles: { account: ['manage-account', 'view-profile'] },
        credentials: [{ type: 'password', value: password, temporary: false }]
      }))
    ]
  };
  const realmFile = path.join(runDir, 'coding-e2e-realm.json');
  await writeFile(
    realmFile,
    JSON.stringify(realm),
    { mode: 0o600 }
  );
  // Linux CI writes as root; Keycloak 26.4 runs as UID 1000 and must read this
  // private bind-mounted fixture. Keep mode 0600 rather than exposing passwords.
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    await chown(realmFile, 1000, 0);
  }
  await writeFile(
    path.join(runDir, 'runtime-config.js'),
    `window.RUNTIME_CONFIG = ${JSON.stringify({
      backendUrl: 'api/',
      keycloak: { url, realm: 'coding-e2e', clientId: 'replay-e2e' }
    })};\n`
  );
  return {
    REPLAY_E2E_AUTH: 'true',
    REPLAY_E2E_AUTH_DIR: runDir,
    REPLAY_E2E_KEYCLOAK_PORT: String(keycloakPort),
    REPLAY_E2E_KEYCLOAK_URL: url,
    REPLAY_E2E_AUTH_PASSWORD: password,
    REPLAY_E2E_KEYCLOAK_ADMIN_PASSWORD: adminPassword,
    REPLAY_E2E_OIDC_ISSUER: `${url}/realms/coding-e2e`
  };
}
