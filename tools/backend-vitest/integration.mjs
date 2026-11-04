import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { integrationConfiguration, assertIntegrationResults } from '../../scripts/qa/run-backend-integration.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const require = createRequire(import.meta.url), { Client } = require('pg'), Redis = require('ioredis');

export function normalizeResults(report) {
  const result = structuredClone(report);
  for (const suite of result.testResults) for (const assertion of suite.assertionResults) {
    if (assertion.status === 'skipped') assertion.status = 'pending';
  }
  return result;
}

export async function runIntegration(options, environment = process.env) {
  if (options.filter || options.testPathPatterns?.length) throw new Error('The mandatory integration selection cannot be filtered.');
  const config = integrationConfiguration(environment);
  const databaseName = `backend_vitest_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: config.server.toString(), connectionTimeoutMillis: 5000 });
  const redis = new Redis({ host: config.redisHost, port: config.redisPort, lazyConnect: true,
    connectTimeout: 3000, commandTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => undefined);
  let created = false, child, interrupted;
  const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { interrupted = signal; child?.kill(signal); }]));
  for (const [signal, handler] of signals) process.on(signal, handler);
  const checkSignal = () => { if (interrupted) throw new Error('Integration run interrupted by ' + interrupted); };
  const output = path.join(root, 'coverage/apps/backend');
  mkdirSync(output, { recursive: true });
  const resultsFile = path.join(output, 'integration-results.json');
  for (const file of ['integration-results.json', 'integration-results-normalized.json', 'integration-junit.xml']) {
    rmSync(path.join(output, file), { force: true });
  }
  try {
    await redis.connect(); await redis.ping(); await admin.connect(); checkSignal();
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    // Match the existing integration runner's complete SQL changelog application.
    const changelog = path.join(root, 'database/changelog');
    for (const [, file] of readFileSync(path.join(changelog, 'coding-box.changelog-root.xml'), 'utf8').matchAll(/<include file="([^"]+)"/g)) {
      checkSignal();
      const sql = readFileSync(path.join(changelog, file), 'utf8').split(/^-- changeset /m).slice(1).map(chunk => {
        const end = chunk.indexOf('\n'), statements = chunk.slice(end + 1);
        return chunk.slice(0, end).includes('runInTransaction:false') ? statements : `BEGIN;\n${statements}\nCOMMIT;`;
      }).join('\n');
      execFileSync(environment.PSQL_BIN || 'psql', ['-h', config.server.hostname, '-p', config.server.port || '5432',
        '-U', decodeURIComponent(config.server.username), '-d', databaseName, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
        input: sql, stdio: 'pipe', timeout: 120000, env: { ...environment, PGPASSWORD: decodeURIComponent(config.server.password) }
      });
    }
    checkSignal();
    child = spawn(process.execPath, ['--experimental-vm-modules', path.join(directory, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', path.join(directory, 'vitest.config.mjs'), '--reporter=default', '--reporter=json', '--reporter=junit',
      `--outputFile.json=${resultsFile}`, `--outputFile.junit=${path.join(output, 'integration-junit.xml')}`,
      ...(options.coverage ? ['--coverage'] : [])], { cwd: root, stdio: 'inherit', env: {
      ...environment, BACKEND_VITEST_SCOPE: 'integration', BACKEND_VITEST_WORKERS: '1',
      BACKEND_VITEST_TEST_PATH_PATTERNS: '[]', BACKEND_VITEST_FILTERED: 'false',
      POSTGRES_INTEGRATION_TESTS: 'true', POSTGRES_HOST: config.server.hostname, POSTGRES_PORT: config.server.port || '5432',
      POSTGRES_USER: decodeURIComponent(config.server.username), POSTGRES_PASSWORD: decodeURIComponent(config.server.password), POSTGRES_DB: databaseName,
      WORKSPACE_DELETION_TEST_DATABASE_URL: config.server.toString(), KAPPA_QUERY_TEST_DATABASE_URL: config.server.toString(),
      REDIS_HOST: config.redisHost, REDIS_PORT: String(config.redisPort), REDIS_PREFIX: databaseName
    } });
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    checkSignal();
    if (status !== 0) throw new Error('Vitest integration tests failed.');
    const report = normalizeResults(JSON.parse(readFileSync(resultsFile, 'utf8')));
    assertIntegrationResults(report, environment.KAPPA_QUERY_BENCHMARK === '1');
    writeFileSync(path.join(output, 'integration-results-normalized.json'), JSON.stringify(report));
    console.log(`Vitest integration gate: ${report.numPassedTests} passed; ${report.numPendingTests} optional skips.`);
  } finally {
    for (const [signal, handler] of signals) process.off(signal, handler);
    redis.disconnect();
    try { if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); } finally { await admin.end(); }
  }
}
