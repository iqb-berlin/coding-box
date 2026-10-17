import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareAuthEnvironment } from './auth-environment.mjs';
import { createAdminToken } from './harness.mjs';

test('generates a separate fixture login with the backend audience and a short-lived browser session', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oidc-harness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = await prepareAuthEnvironment(directory, 8123, 8420);
  const realm = JSON.parse(await readFile(path.join(directory, 'coding-e2e-realm.json'), 'utf8'));
  const browser = realm.clients.find(client => client.clientId === 'replay-e2e');
  const bootstrap = realm.clients.find(client => client.clientId === 'replay-e2e-bootstrap');
  assert.equal(environment.REPLAY_E2E_OIDC_ISSUER, 'http://127.0.0.1:8123/realms/coding-e2e');
  assert.equal(environment.REPLAY_E2E_CALLBACK_URL, '//127.0.0.1:8420/api/auth/callback');
  assert.equal(realm.accessTokenLifespan, 30);
  assert.ok(browser.redirectUris.includes('http://127.0.0.1:8420/*'));
  assert.equal(browser.attributes['pkce.code.challenge.method'], 'S256');
  assert.equal(bootstrap.standardFlowEnabled, false);
  assert.equal(bootstrap.directAccessGrantsEnabled, true);
  assert.equal(bootstrap.protocolMappers[0].config['included.client.audience'], browser.clientId);
});

test('requests fixture credentials from OIDC and does not mint local JWTs', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: Object.fromEntries(options.body) });
    return Response.json({ access_token: 'provider-signed-token' });
  });
  assert.equal(await createAdminToken({ issuer: 'http://issuer.test', authPassword: 'ephemeral' }), 'provider-signed-token');
  assert.deepEqual(requests, [{
    url: 'http://issuer.test/protocol/openid-connect/token',
    body: { grant_type: 'password', client_id: 'replay-e2e-bootstrap', username: 'replay-e2e-bootstrap', password: 'ephemeral' }
  }]);
});

test('rejects an OIDC fixture login failure without including credentials in the error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('secret response', { status: 401 }));
  await assert.rejects(createAdminToken({ issuer: 'http://issuer.test', authPassword: 'ephemeral' }), {
    message: 'OIDC fixture login failed with HTTP 401.'
  });
});
