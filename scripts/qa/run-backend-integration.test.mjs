import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { integrationConfiguration } from './run-backend-integration.mjs';

const database = 'postgresql://integration:integration@127.0.0.1:5432/postgres';
const redis = { BULLMQ_TEST_REDIS_HOST: '127.0.0.1', BULLMQ_TEST_REDIS_PORT: '6379' };

test('application database settings cannot accidentally enable the integration gate', () => {
  assert.throws(() => integrationConfiguration({ POSTGRES_HOST: 'application', POSTGRES_DB: 'application', ...redis }), /BACKEND_INTEGRATION_TEST_DATABASE_URL/);
});

test('both explicit test services are required', () => {
  for (const port of [undefined, '', '0', '65536', 'not-a-port']) {
    assert.throws(() => integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: database, ...redis, BULLMQ_TEST_REDIS_PORT: port }), /test Redis/);
  }
  assert.throws(() => integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: 'https://example.test', ...redis }), /PostgreSQL/);
  assert.throws(() => integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: 'postgresql://localhost/postgres', ...redis }), /explicitly provide/);
});

test('valid configuration preserves the dedicated test server and Redis port', () => {
  const result = integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: database, ...redis });
  assert.equal(result.server.toString(), database);
  assert.equal(result.redisPort, 6379);
});

test('the mandatory command fails instead of silently skipping absent infrastructure', () => {
  const environment = { ...process.env };
  delete environment.BACKEND_INTEGRATION_TEST_DATABASE_URL;
  const result = spawnSync(process.execPath, [new URL('./run-backend-integration.mjs', import.meta.url).pathname], { env: environment, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BACKEND_INTEGRATION_TEST_DATABASE_URL/);
});
