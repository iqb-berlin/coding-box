import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArguments } from './arguments.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');

/** Unit coverage must not remove the independently produced integration proof. */
export function prepareUnitReports(output) {
  mkdirSync(output, { recursive: true });
  for (const file of readdirSync(output)) {
    if (!file.startsWith('integration-')) rmSync(path.join(output, file), { recursive: true, force: true });
  }
}

async function execute(args, environment) {
  const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' });
  let interrupted;
  const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { interrupted = signal; child.kill(signal); }]));
  for (const [signal, handler] of signals) process.on(signal, handler);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally {
    for (const [signal, handler] of signals) process.off(signal, handler);
  }
}

export async function runBackendTests(overrides = {}, environment = process.env) {
  const options = { ...parseArguments([]), ...overrides };
  if (Number(process.versions.node.split('.')[0]) !== 24 || process.versions.node.localeCompare('24.22.1', undefined, { numeric: true }) < 0) {
    throw new Error('Backend Vitest requires Node 24.22.1 or newer within Node 24.');
  }
  if (!existsSync(path.join(directory, 'node_modules/vitest/vitest.mjs'))) throw new Error('Install backend test tools: npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts');
  if (options.scope === 'integration') {
    // Fail early when the explicitly disposable test infrastructure is absent.
    const { integrationConfiguration } = await import('../../scripts/qa/run-backend-integration.mjs');
    integrationConfiguration(environment);
  }
  const output = path.join(root, 'coverage/apps/backend');
  if (options.scope !== 'integration' && !options.typecheckOnly) prepareUnitReports(output);
  if (!options.testsOnly) {
    const status = await execute([path.join(directory, 'typecheck.mjs')], environment);
    if (status !== 0) throw new Error('Backend test typecheck failed.');
  } else {
    console.log('Focused test execution: the separate Vitest typecheck was explicitly skipped.');
  }
  if (options.typecheckOnly) return;
  if (options.scope === 'integration') {
    const { runIntegration } = await import('./integration.mjs');
    return runIntegration(options, environment);
  }
  const env = { ...environment, BACKEND_VITEST_SCOPE: options.scope, BACKEND_VITEST_FILTERED: options.filter ? 'true' : 'false', POSTGRES_INTEGRATION_TESTS: 'false', WORKSPACE_DELETION_TEST_DATABASE_URL: '' };
  if (options.workers) env.BACKEND_VITEST_WORKERS = String(options.workers);
  delete env.REDIS_HOST; delete env.REDIS_PORT; delete env.REDIS_PREFIX;
  const status = await execute(['--experimental-vm-modules', path.join(directory, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(directory, 'vitest.config.mjs'), '--reporter=default', '--reporter=json', '--reporter=junit',
    '--outputFile.json=coverage/apps/backend/results.json', '--outputFile.junit=coverage/apps/backend/junit.xml',
    ...(options.coverage ? ['--coverage'] : []), ...(options.filter ? options.filter.split(',').map(value => value.trim()).filter(Boolean) : [])], env);
  if (status !== 0) throw new Error('Backend Vitest tests or coverage thresholds failed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runBackendTests(parseArguments(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
