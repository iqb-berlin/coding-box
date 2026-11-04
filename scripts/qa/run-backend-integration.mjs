import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function integrationConfiguration(environment) {
  if (!environment.BACKEND_INTEGRATION_TEST_DATABASE_URL) {
    throw new Error('BACKEND_INTEGRATION_TEST_DATABASE_URL must explicitly identify a disposable PostgreSQL test server.');
  }
  const server = new URL(environment.BACKEND_INTEGRATION_TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(server.protocol)) throw new Error('The integration database URL must use PostgreSQL.');
  if (!server.hostname || !server.username || server.pathname.length < 2) {
    throw new Error('The test server URL must explicitly provide its host, user, and administrative database.');
  }
  if (!environment.BULLMQ_TEST_REDIS_HOST || !/^\d+$/.test(environment.BULLMQ_TEST_REDIS_PORT || '') ||
      Number(environment.BULLMQ_TEST_REDIS_PORT) < 1 || Number(environment.BULLMQ_TEST_REDIS_PORT) > 65535) {
    throw new Error('BULLMQ_TEST_REDIS_HOST and BULLMQ_TEST_REDIS_PORT must explicitly identify test Redis.');
  }
  return { server, redisHost: environment.BULLMQ_TEST_REDIS_HOST, redisPort: Number(environment.BULLMQ_TEST_REDIS_PORT) };
}

export function assertIntegrationResults(results, benchmarkEnabled = false) {
  if (!results.success || !results.numPassedTests || results.numPendingTestSuites || !results.testResults?.length) {
    throw new Error('Integration gate requires executed, successful suites; skipped suites are not accepted.');
  }
  let skippedBenchmarks = 0;
  for (const suite of results.testResults) {
    for (const assertion of suite.assertionResults) {
      if (assertion.status === 'passed') continue;
      if (!benchmarkEnabled && assertion.status === 'pending' &&
          path.basename(suite.name) === 'double-coding-kappa-query.postgres.spec.ts' &&
          assertion.fullName === 'Kappa SQL filters against PostgreSQL and the complete Liquibase schema measures the former and filtered retrieval on identical synthetic data') {
        skippedBenchmarks += 1;
        continue;
      }
      throw new Error(`Integration gate requires every mandatory test to pass: ${assertion.fullName} (${assertion.status}).`);
    }
  }
  if (results.numPendingTests !== skippedBenchmarks || results.numTodoTests) {
    throw new Error('Only the optional Kappa benchmark may be skipped by the integration gate.');
  }
}

export async function runIntegration(environment = process.env) {
  const { runBackendTests } = await import('../../tools/backend-vitest/run.mjs');
  return runBackendTests({ scope: 'integration' }, environment);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runIntegration().catch(error => { console.error(error.message); process.exitCode = 1; });
}
