import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { setupFromEnvFile, updateSyncEnv } from '../keycloak/setup-user-sync.mjs';

const id = randomBytes(6).toString('hex');
const containers = [];
// Desktop sandboxes can have a private /tmp that the host Docker daemon cannot mount.
await mkdir(join(process.cwd(), '.nx'), { recursive: true });
const directory = await mkdtemp(join(process.cwd(), '.nx', 'keycloak-user-sync-live-'));
const adminName = 'fixture-admin';
const adminPassword = randomBytes(24).toString('hex');
const databasePassword = randomBytes(24).toString('hex');
const userPassword = randomBytes(24).toString('hex');
const docker = (args, env = {}) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }
}).trim();
const port = name => docker(['port', name, '8080/tcp']).split(':').at(-1);

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `Fixture request failed: HTTP ${response.status}`);
  return response.status === 204 || response.headers.get('content-length') === '0' ? undefined : response.json();
}

async function waitUntil(check, timeout = 180_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* Wait for the owned fixture only. */ }
    await delay(1000);
  }
  throw new Error('Isolated Keycloak/PostgreSQL fixture did not become ready.');
}

try {
  const keycloak = `coding-box-sync-kc-${id}`;
  containers.push(keycloak);
  docker(['run', '-d', '--name', keycloak, '--label', 'coding-box.test=keycloak-user-sync',
    '-p', '127.0.0.1::8080', '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME', '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD',
    '-e', 'KEYCLOAK_ADMIN', '-e', 'KEYCLOAK_ADMIN_PASSWORD',
    process.env.KEYCLOAK_SYNC_TEST_IMAGE || 'quay.io/keycloak/keycloak:26.4.0', 'start-dev'], {
    KC_BOOTSTRAP_ADMIN_USERNAME: adminName, KC_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    KEYCLOAK_ADMIN: adminName, KEYCLOAK_ADMIN_PASSWORD: adminPassword
  });
  const postgres = `coding-box-sync-pg-${id}`;
  containers.push(postgres);
  docker(['run', '-d', '--name', postgres, '--label', 'coding-box.test=keycloak-user-sync',
    '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=sync_test',
    '-e', 'POSTGRES_DB=sync_test', 'postgres:16-alpine'], { POSTGRES_PASSWORD: databasePassword });
  const base = `http://127.0.0.1:${port(keycloak)}`;
  await waitUntil(async () => (await fetch(`${base}/realms/master/.well-known/openid-configuration`)).ok);
  await waitUntil(() => docker(['exec', postgres, 'pg_isready', '-U', 'sync_test'])?.includes('accepting connections'));
  const { access_token: adminToken } = await json(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
      username: adminName, password: adminPassword })
  });
  const realm = 'coding-box-sync-test';
  const identity = randomUUID();
  const issuer = `${base}/realms/${realm}`;
  await json(`${base}/admin/realms`, { method: 'POST', headers: {
    Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ realm, enabled: true,
    clients: [{ clientId: 'coding-box-test-login', enabled: true, publicClient: true,
      directAccessGrantsEnabled: true, standardFlowEnabled: false, protocol: 'openid-connect' }],
    users: [{ id: identity, username: 'waiting-coder', enabled: false,
      firstName: 'Test', lastName: 'Coder', email: 'coder@example.test', emailVerified: true,
      credentials: [{ type: 'password', value: userPassword, temporary: false }] }] }) });

  const file = join(directory, '.env');
  const adminFile = join(directory, 'admin.env');
  await writeFile(file, `# Isolated fixture only\nOIDC_ISSUER=${issuer}\nOIDC_TOKEN_ENDPOINT=${issuer}/protocol/openid-connect/token\nKEYCLOAK_USER_SYNC_AUTO_SETUP=true\nKEYCLOAK_USER_SYNC_ENABLED=false\n`);
  await writeFile(adminFile, `ADMIN_NAME=${adminName}\nADMIN_PASSWORD=${adminPassword}\n`, { mode: 0o600 });
  await setupFromEnvFile(file, adminFile);
  const configured = parseEnv(await readFile(file, 'utf8'));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await setupFromEnvFile(file, adminFile);
  assert.equal(parseEnv(await readFile(file, 'utf8')).KEYCLOAK_USER_SYNC_CLIENT_SECRET, configured.KEYCLOAK_USER_SYNC_CLIENT_SECRET);
  await setupFromEnvFile(file, undefined, true);
  console.log('PASS: provisioning is repeatable, secrets stay stable, subsequent starts need no admin credentials.');
  {
    const dockerFile = join(directory, '.env.docker');
    await writeFile(dockerFile, updateSyncEnv(await readFile(file, 'utf8'), {
      OIDC_TOKEN_ENDPOINT: `http://127.0.0.1:8080/realms/${realm}/protocol/openid-connect/token`
    }), { mode: 0o600 });
    try {
      execFileSync('bash', ['scripts/keycloak/setup-user-sync.sh', dockerFile, adminFile], {
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KEYCLOAK_SETUP_NETWORK: `container:${keycloak}` }
      });
    } catch (error) {
      console.error(String(error.stderr || 'Docker setup helper failed.'));
      throw new Error('Docker setup helper failed.');
    }
    assert.equal(parseEnv(await readFile(dockerFile, 'utf8')).KEYCLOAK_USER_SYNC_CLIENT_SECRET, configured.KEYCLOAK_USER_SYNC_CLIENT_SECRET);
    console.log('PASS: the Docker-only installation helper configures the same client without a host Node dependency.');
  }

  const adminApi = (path, options = {}) => json(`${base}/admin/realms/${realm}${path}`, {
    ...options, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
  });
  const syncClient = (await adminApi('/clients?clientId=coding-box-user-sync'))[0];
  const managementClient = (await adminApi('/clients?clientId=realm-management'))[0];
  const account = await adminApi(`/clients/${syncClient.id}/service-account-user`);
  const writeRole = await adminApi(`/clients/${managementClient.id}/roles/manage-users`);
  const rolePath = `/users/${account.id}/role-mappings/clients/${managementClient.id}`;
  await adminApi(rolePath, { method: 'POST', body: JSON.stringify([writeRole]) });
  const beforeRejectedSetup = await readFile(file, 'utf8');
  await assert.rejects(setupFromEnvFile(file, adminFile), /unexpected administrative roles/);
  assert.equal(await readFile(file, 'utf8'), beforeRejectedSetup);
  await adminApi(rolePath, { method: 'DELETE', body: JSON.stringify([writeRole]) });
  console.log('PASS: setup rejects an overprivileged service account without changing the app configuration.');

  const { access_token: readToken } = await json(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials',
      client_id: configured.KEYCLOAK_USER_SYNC_CLIENT_ID, client_secret: configured.KEYCLOAK_USER_SYNC_CLIENT_SECRET })
  });
  const denied = await fetch(`${base}/admin/realms/${realm}/users/${identity}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true })
  });
  assert.equal(denied.status, 403);
  console.log('PASS: service account can read users but cannot activate or edit them.');
  const pgPort = docker(['port', postgres, '5432/tcp']).split(':').at(-1);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/qa/run-backend-jest.mjs', '--runInBand',
      '--testPathPatterns=keycloak-user-sync.live.integration.spec.ts'], {
      stdio: 'inherit', env: { ...process.env, NX_DAEMON: 'false',
        KEYCLOAK_SYNC_TEST_URL: base, KEYCLOAK_SYNC_TEST_REALM: realm,
        KEYCLOAK_SYNC_TEST_ADMIN_TOKEN: adminToken, KEYCLOAK_SYNC_TEST_IDENTITY: identity,
        KEYCLOAK_SYNC_TEST_USER_PASSWORD: userPassword,
        KEYCLOAK_SYNC_TEST_SECRET: configured.KEYCLOAK_USER_SYNC_CLIENT_SECRET,
        KEYCLOAK_SYNC_TEST_DATABASE_URL: `postgresql://sync_test:${databasePassword}@127.0.0.1:${pgPort}/sync_test` }
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Live backend assertions failed.')));
  });
} catch (error) {
  // Docker errors include invocation details; never print fixture credentials.
  console.error(error instanceof assert.AssertionError ? error.message : 'Keycloak user-sync live verification failed.');
  process.exitCode = 1;
} finally {
  for (const container of containers.reverse()) {
    try { docker(['rm', '-fv', container]); } catch { console.error('Could not remove an owned test container.'); }
  }
  await rm(directory, { recursive: true, force: true });
}
