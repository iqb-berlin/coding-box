import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

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
  const config = integrationConfiguration(environment);
  const databaseName = `backend_integration_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: config.server.toString(), connectionTimeoutMillis: 5000 });
  const redis = new Redis({
    host: config.redisHost, port: config.redisPort, lazyConnect: true,
    connectTimeout: 3000, commandTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null
  });
  redis.on('error', () => undefined);
  let created = false;
  const resultsFile = path.join(root, 'coverage/apps/backend/integration-results.json');
  try {
    await redis.connect();
    await redis.ping();
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const changelogRoot = path.join(root, 'database/changelog');
    const changelog = await readFile(path.join(changelogRoot, 'coding-box.changelog-root.xml'), 'utf8');
    for (const [, file] of changelog.matchAll(/<include file="([^"]+)"/g)) {
      const sql = (await readFile(path.join(changelogRoot, file), 'utf8')).split(/^-- changeset /m).slice(1).map(chunk => {
        const end = chunk.indexOf('\n');
        const statements = chunk.slice(end + 1);
        return chunk.slice(0, end).includes('runInTransaction:false') ? statements : `BEGIN;\n${statements}\nCOMMIT;`;
      }).join('\n');
      execFileSync(environment.PSQL_BIN || 'psql', [
        '-h', config.server.hostname, '-p', config.server.port || '5432', '-U', decodeURIComponent(config.server.username),
        '-d', databaseName, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'
      ], { input: sql, stdio: 'pipe', timeout: 120000, env: { ...environment, PGPASSWORD: decodeURIComponent(config.server.password) } });
    }
    await rm(resultsFile, { force: true });
    const nxPackage = require.resolve('nx/package.json');
    const nxBinary = path.join(path.dirname(nxPackage), require(nxPackage).bin.nx);
    const child = spawn(process.execPath, [
      nxBinary, 'test', 'backend', '--jestConfig=apps/backend/jest.integration.config.ts',
      '--runInBand', '--skip-nx-cache', '--codeCoverage=false', '--json', `--outputFile=${resultsFile}`
    ], {
      cwd: root, stdio: 'inherit', env: {
        ...environment, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', POSTGRES_INTEGRATION_TESTS: 'true',
        POSTGRES_HOST: config.server.hostname, POSTGRES_PORT: config.server.port || '5432',
        POSTGRES_USER: decodeURIComponent(config.server.username), POSTGRES_PASSWORD: decodeURIComponent(config.server.password),
        POSTGRES_DB: databaseName, WORKSPACE_DELETION_TEST_DATABASE_URL: config.server.toString(),
        KAPPA_QUERY_TEST_DATABASE_URL: config.server.toString(),
        REDIS_HOST: config.redisHost, REDIS_PORT: String(config.redisPort), REDIS_PREFIX: databaseName
      }
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', value => resolve(value ?? 1));
    });
    if (code !== 0) throw new Error('Backend integration tests failed.');
    const results = JSON.parse(await readFile(resultsFile, 'utf8'));
    assertIntegrationResults(results, environment.KAPPA_QUERY_BENCHMARK === '1');
    console.log(`Backend integration gate passed: ${results.numPassedTests} tests, ${results.numPendingTests} optional tests skipped.`);
  } finally {
    redis.disconnect();
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runIntegration().catch(error => { console.error(error.message); process.exitCode = 1; });
}
