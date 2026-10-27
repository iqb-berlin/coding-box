import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { assertIntegrationResults, integrationConfiguration } from './run-backend-integration.mjs';

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

const successfulResults = {
  success: true, numPassedTests: 1, numPendingTests: 0, numPendingTestSuites: 0, numTodoTests: 0,
  testResults: [{ name: '/test/locking.postgres.spec.ts', assertionResults: [{ fullName: 'protects a workspace mutation', status: 'passed' }] }]
};
const benchmark = {
  name: '/test/double-coding-kappa-query.postgres.spec.ts',
  assertionResults: [{
    fullName: 'Kappa SQL filters against PostgreSQL and the complete Liquibase schema measures the former and filtered retrieval on identical synthetic data',
    status: 'pending'
  }]
};

test('successful mandatory integration tests pass the gate', () => {
  assert.doesNotThrow(() => assertIntegrationResults(successfulResults));
});

test('individual skipped or todo mandatory tests fail even when other tests pass', () => {
  for (const status of ['pending', 'todo', 'disabled']) {
    const results = structuredClone(successfulResults);
    results.testResults[0].assertionResults.push({ fullName: 'verifies transaction rollback', status });
    results.numPendingTests = 1;
    assert.throws(() => assertIntegrationResults(results), /every mandatory test/);
  }
});

test('only the exact optional Kappa benchmark may be skipped unless explicitly enabled', () => {
  const results = { ...successfulResults, numPendingTests: 1, testResults: [...successfulResults.testResults, benchmark] };
  assert.doesNotThrow(() => assertIntegrationResults(results));
  assert.throws(() => assertIntegrationResults(results, true), /every mandatory test/);
  const wrongSuite = structuredClone(results);
  wrongSuite.testResults[1].name = '/test/another.postgres.spec.ts';
  assert.throws(() => assertIntegrationResults(wrongSuite), /every mandatory test/);
});

test('failed, empty or skipped suites cannot satisfy the integration gate', () => {
  for (const invalid of [{ success: false }, { numPassedTests: 0 }, { numPendingTestSuites: 1 }, { testResults: [] }]) {
    assert.throws(() => assertIntegrationResults({ ...successfulResults, ...invalid }), /executed, successful suites/);
  }
  assert.throws(() => assertIntegrationResults({ ...successfulResults, numPendingTests: 1 }), /Only the optional/);
});
