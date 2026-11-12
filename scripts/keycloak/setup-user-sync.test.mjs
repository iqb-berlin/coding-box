import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncEndpoints, updateSyncEnv, setupFromEnvFile } from './setup-user-sync.mjs';

test('derives the realm and internal admin URL without replacing the public issuer', () => {
  assert.deepEqual(syncEndpoints({
    OIDC_ISSUER: 'https://login.example.test/auth/realms/coding-box',
    OIDC_TOKEN_ENDPOINT: 'http://keycloak:8080/auth/realms/coding-box/protocol/openid-connect/token'
  }), {
    issuer: 'https://login.example.test/auth/realms/coding-box',
    realm: 'coding-box', base: 'http://keycloak:8080/auth',
    tokenUrl: 'http://keycloak:8080/auth/realms/coding-box/protocol/openid-connect/token',
    usersUrl: 'http://keycloak:8080/auth/admin/realms/coding-box/users'
  });
});

test('refuses mismatched realms and credentials embedded in URLs', () => {
  assert.throws(() => syncEndpoints({ OIDC_ISSUER: 'https://login.test/realms/one',
    OIDC_TOKEN_ENDPOINT: 'https://login.test/realms/two/protocol/openid-connect/token' }), /same Keycloak realm/);
  assert.throws(() => syncEndpoints({ OIDC_ISSUER: 'https://user:secret@login.test/realms/one' }), /without credentials/);
});

test('env updates preserve unrelated settings and comments and are idempotent', () => {
  const before = '# Keep me\nOIDC_ISSUER=https://login.test/realms/one\nKEYCLOAK_USER_SYNC_ENABLED=false\n';
  const settings = { KEYCLOAK_USER_SYNC_ENABLED: 'true', KEYCLOAK_USER_SYNC_CLIENT_SECRET: 'synthetic-safe-secret' };
  const after = updateSyncEnv(before, settings);
  assert.equal(after, '# Keep me\nOIDC_ISSUER=https://login.test/realms/one\nKEYCLOAK_USER_SYNC_ENABLED=true\nKEYCLOAK_USER_SYNC_CLIENT_SECRET=synthetic-safe-secret\n');
  assert.equal(updateSyncEnv(after, settings), after);
  assert.throws(() => updateSyncEnv(before, { KEYCLOAK_USER_SYNC_CLIENT_SECRET: 'bad\nADMIN_PASSWORD=bad' }));
});

test('external OIDC and opt-out require neither admin credentials nor a Keycloak request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-box-setup-unit-'));
  try {
    const file = join(directory, '.env');
    const contents = 'OIDC_ISSUER=https://other-provider.test\nKEYCLOAK_USER_SYNC_AUTO_SETUP=false\n';
    await writeFile(file, contents);
    await setupFromEnvFile(file, undefined, true);
    assert.equal(await readFile(file, 'utf8'), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unsuccessful setup leaves application configuration unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-box-setup-unit-'));
  try {
    const file = join(directory, '.env');
    const contents = 'OIDC_ISSUER=https://login.test/realms/one\nOIDC_TOKEN_ENDPOINT=https://login.test/realms/one/protocol/openid-connect/token\nKEYCLOAK_USER_SYNC_ENABLED=false\n';
    await writeFile(file, contents);
    await assert.rejects(setupFromEnvFile(file), /temporary Keycloak admin credentials/);
    assert.equal(await readFile(file, 'utf8'), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [variant, target, envName] of [
  ['dev', 'dev-keycloak-user-sync-setup', '.env.dev'],
  ['prod', 'coding-box-keycloak-user-sync-setup', '.env.coding-box']
]) {
  test(`${variant} Make setup starts Compose with the newly generated secret, not its old exported value`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coding-box-setup-make-'));
    try {
      await mkdir(join(directory, 'scripts', 'keycloak'), { recursive: true });
      await mkdir(join(directory, 'scripts', 'make'), { recursive: true });
      await mkdir(join(directory, 'bin'));
      const makefile = join(directory, 'scripts', 'make', `${variant}.mk`);
      await copyFile(fileURLToPath(new URL(`../make/${variant}.mk`, import.meta.url)), makefile);
      await copyFile(fileURLToPath(new URL('./setup-user-sync.sh', import.meta.url)),
        join(directory, 'scripts', 'keycloak', 'setup-user-sync.sh'));
      const envFile = join(directory, envName);
      await writeFile(envFile, 'KEYCLOAK_USER_SYNC_CLIENT_SECRET=\n');
      const log = join(directory, 'compose-secret.txt');
      await writeFile(join(directory, 'bin', 'docker'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'run') {
  fs.writeFileSync(process.env.FIXTURE_ENV_FILE, 'KEYCLOAK_USER_SYNC_CLIENT_SECRET=new-synthetic-secret\\n');
} else if (process.argv[2] === 'compose') {
  fs.writeFileSync(process.env.FIXTURE_LOG, process.env.KEYCLOAK_USER_SYNC_CLIENT_SECRET || 'EMPTY');
} else { process.exit(1); }
`, { mode: 0o700 });
      execFileSync('make', ['--no-print-directory', '-f', makefile, `CODING_BOX_BASE_DIR=${directory}`, target], {
        cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          FIXTURE_ENV_FILE: envFile, FIXTURE_LOG: log }
      });
      assert.equal(await readFile(log, 'utf8'), 'new-synthetic-secret');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
