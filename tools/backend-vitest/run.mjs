import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
if (Number(process.versions.node.split('.')[0]) !== 24 || process.versions.node.localeCompare('24.22.1', undefined, { numeric: true }) < 0) {
  throw new Error('The manual backend Vitest pilot requires Node 24.22.1 or newer within Node 24.');
}
if (!existsSync(path.join(directory, 'node_modules/vitest/vitest.mjs'))) throw new Error('Install the isolated tools first: npm ci --prefix tools/backend-vitest --include=dev --ignore-scripts');
const options = { scope: 'all', coverage: false, testsOnly: false, typecheckOnly: false, filter: undefined };
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--scope=')) options.scope = argument.slice(8);
  else if (argument === '--coverage') options.coverage = true;
  else if (argument === '--tests-only') options.testsOnly = true;
  else if (argument === '--typecheck-only') options.typecheckOnly = true;
  else if (argument.startsWith('--filter=')) options.filter = argument.slice(9);
  else throw new Error('Unknown pilot argument: ' + argument);
}
if (!['all', 'pilot', 'contracts', 'integration'].includes(options.scope)) throw new Error('Unknown scope: ' + options.scope);
if (options.testsOnly && options.typecheckOnly) throw new Error('Choose either --tests-only or --typecheck-only.');
process.chdir(root);
if (!options.testsOnly) {
  const checked = spawnSync(process.execPath, [path.join(directory, 'typecheck.mjs')], { cwd: root, stdio: 'inherit' });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status ?? 1);
} else {
  console.log('Focused test execution: the separate Vitest typecheck was explicitly skipped.');
}
if (options.typecheckOnly) process.exit(0);
if (options.scope === 'integration') {
  const { runIntegration } = await import('./integration.mjs');
  await runIntegration(options);
} else {
  const env = { ...process.env, BACKEND_VITEST_SCOPE: options.scope, POSTGRES_INTEGRATION_TESTS: 'false', WORKSPACE_DELETION_TEST_DATABASE_URL: '' };
  delete env.REDIS_HOST; delete env.REDIS_PORT; delete env.REDIS_PREFIX;
  mkdirSync(path.join(root, 'coverage/apps/backend-vitest'), { recursive: true });
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', path.join(directory, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', path.join(directory, 'vitest.config.mjs'), '--reporter=default', '--reporter=json', '--reporter=junit',
    '--outputFile.json=coverage/apps/backend-vitest/results.json', '--outputFile.junit=coverage/apps/backend-vitest/junit.xml',
    ...(options.coverage ? ['--coverage'] : []), ...(options.filter ? options.filter.split(',').map(value => value.trim()).filter(Boolean) : [])], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
