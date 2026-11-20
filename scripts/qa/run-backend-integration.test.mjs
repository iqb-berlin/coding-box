import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { test } from 'node:test';
import { assertIntegrationResults, assertPostgresVersion, integrationConfiguration } from './run-backend-integration.mjs';

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

test('the PostgreSQL 17 gate cannot silently validate PostgreSQL 14 or a different patch release', () => {
  const config = integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: database, ...redis,
    BACKEND_INTEGRATION_POSTGRES_VERSION: '17.12' });
  assert.equal(config.expectedPostgresVersion, '17.12');
  assert.doesNotThrow(() => assertPostgresVersion('17.12 (Alpine)', config.expectedPostgresVersion));
  assert.throws(() => assertPostgresVersion('14.24', config.expectedPostgresVersion), /wrong server/);
  assert.throws(() => assertPostgresVersion('17.11', config.expectedPostgresVersion), /wrong server/);
  assert.doesNotThrow(() => assertPostgresVersion('14.24', undefined));
  assert.throws(() => integrationConfiguration({ BACKEND_INTEGRATION_TEST_DATABASE_URL: database, ...redis,
    BACKEND_INTEGRATION_POSTGRES_VERSION: '17' }), /major.minor/);
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
const resetPreviewBenchmark = {
  name: '/test/coding-reset-preview.postgres.spec.ts',
  assertionResults: [{
    fullName: 'Reset preview against isolated PostgreSQL data measures global and selective previews with one million responses',
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

test('only the exact optional reset-preview benchmark may be skipped unless explicitly enabled', () => {
  const results = { ...successfulResults, numPendingTests: 1, testResults: [...successfulResults.testResults, resetPreviewBenchmark] };
  assert.doesNotThrow(() => assertIntegrationResults(results));
  assert.throws(() => assertIntegrationResults(results, false, true), /every mandatory test/);
  const mandatoryTest = structuredClone(results);
  mandatoryTest.testResults[1].assertionResults[0].fullName = 'counts the exact reset and cleanup scope';
  assert.throws(() => assertIntegrationResults(mandatoryTest), /every mandatory test/);
  const wrongSuite = structuredClone(results);
  wrongSuite.testResults[1].name = '/test/another.postgres.spec.ts';
  assert.throws(() => assertIntegrationResults(wrongSuite), /every mandatory test/);
});

test('both optional benchmark skips are counted and their enable flags remain independent', () => {
  const results = { ...successfulResults, numPendingTests: 2, testResults: [...successfulResults.testResults, benchmark, resetPreviewBenchmark] };
  assert.doesNotThrow(() => assertIntegrationResults(results));
  assert.throws(() => assertIntegrationResults(results, true), /every mandatory test/);
  assert.throws(() => assertIntegrationResults(results, false, true), /every mandatory test/);
  assert.throws(() => assertIntegrationResults({ ...results, numPendingTests: 3 }), /Only the optional/);
});

test('failed, empty or skipped suites cannot satisfy the integration gate', () => {
  for (const invalid of [{ success: false }, { numPassedTests: 0 }, { numPendingTestSuites: 1 }, { testResults: [] }]) {
    assert.throws(() => assertIntegrationResults({ ...successfulResults, ...invalid }), /executed, successful suites/);
  }
  assert.throws(() => assertIntegrationResults({ ...successfulResults, numPendingTests: 1 }), /Only the optional/);
});

test('unsuffixed release images remain on PostgreSQL 14 and CI tests both major versions', () => {
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('!reference', { kind: 'sequence', construct: value => value })]);
  const config = file => yaml.load(readFileSync(file, 'utf8'), { schema });
  const ci = config('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml');
  const image = config('.gitlab-ci.yml').variables.POSTGRES17_BASE_IMAGE;
  assert.match(image, /^postgres:17\.12-.*@sha256:[a-f0-9]{64}$/);
  assert.match(readFileSync('database/Postgres.Dockerfile', 'utf8'), /^ARG POSTGRES_IMAGE=postgres:14\./m);
  assert.equal(config('docker-compose.coding-box.prod.yaml').services.db.image,
    '${REGISTRY_PATH}iqbberlin/coding-box-db:${TAG}${POSTGRES_IMAGE_SUFFIX:-}');
  const primary = ci['test-backend-integration'];
  assert.equal(primary.variables.BACKEND_INTEGRATION_POSTGRES_VERSION, '14.25');
  assert(primary.services.some(service => service.name.includes('postgres:14.25-')));
  const optional = ci['test-backend-integration-postgres17'];
  assert.equal(optional.extends, 'test-backend-integration');
  assert.equal(optional.variables.BACKEND_INTEGRATION_POSTGRES_VERSION, '17.12');
  assert(optional.services.some(service => service.name === '${DOCKER_HUB_PROXY}${POSTGRES17_BASE_IMAGE}'));
});

test('new installs select PostgreSQL 17 on the project volume and can select a restored target', () => {
  for (const file of ['docker-compose.yaml', 'docker-compose.coding-box.yaml']) {
    const config = yaml.load(readFileSync(file, 'utf8'));
    assert.deepEqual(config.services.db.volumes, ['db_vol:/var/lib/postgresql/data']);
    assert.equal(config.volumes.db_vol.name, '${POSTGRES_DATA_VOLUME:-${COMPOSE_PROJECT_NAME}_db_vol}');
    assert.equal(config.volumes.db_vol.external, '${POSTGRES_DATA_VOLUME_EXTERNAL:-false}');
  }
  const template = readFileSync('.env.coding-box.template', 'utf8');
  assert.match(template, /^POSTGRES_IMAGE_SUFFIX=-pg17$/m);
  assert.match(template, /^POSTGRES_DATA_VOLUME=$/m);
  assert.match(template, /^POSTGRES_DATA_VOLUME_EXTERNAL=false$/m);
});
