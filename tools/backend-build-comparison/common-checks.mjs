import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = path.join(root, 'tmp/backend-build-comparison');
await mkdir(directory, { recursive: true });
const require = createRequire(import.meta.url);
const manifest = require.resolve('nx/package.json');
const nx = path.resolve(path.dirname(manifest), require(manifest).bin.nx);
const environment = { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_ISOLATE_PLUGINS: 'false',
  BACKEND_INTEGRATION_TEST_DATABASE_URL: 'postgresql://codebook_test:disposable_test_only@127.0.0.1:25441/backend_integration',
  BULLMQ_TEST_REDIS_HOST: '127.0.0.1', BULLMQ_TEST_REDIS_PORT: '26441' };
// Infrastructure tests belong to the separate mandatory integration gate.
delete environment.POSTGRES_INTEGRATION_TESTS;
delete environment.WORKSPACE_DELETION_TEST_DATABASE_URL;
delete environment.REDIS_HOST;
delete environment.REDIS_PORT;
delete environment.REDIS_PREFIX;
const report = process.argv.includes('--resume') ? JSON.parse(await readFile(path.join(directory, 'common-checks.json'), 'utf8')) :
  { scope: 'Common checks shared by all variants, with failed preparation runs repeated after correction.', steps: [] };
report.steps = report.steps.filter(step => step.code === 0);
for (const [name, args] of [
  ['typecheck', ['run', 'backend:typecheck', '--skip-nx-cache']],
  ['lint', ['lint', 'backend', '--skip-nx-cache']],
  ['unit', ['test', 'backend', '--maxWorkers=2', '--codeCoverage=false', '--skip-nx-cache',
    '--json', `--outputFile=${path.join(directory, 'unit-results.json')}`]],
  ['integration', ['run', 'backend:test-integration', '--skip-nx-cache']]
]) {
  if (report.steps.some(step => step.name === name && step.code === 0)) continue;
  const start = performance.now();
  const log = createWriteStream(path.join(directory, `common-${name}.log`));
  const child = spawn(process.execPath, [nx, ...args], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const [code, signal] = await once(child, 'exit'); log.end();
  const record = { name, elapsedMs: performance.now() - start, code, signal };
  report.steps.push(record);
  await writeFile(path.join(directory, 'common-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(record));
  assert.equal(code, 0, `${name} failed; see saved log`);
}
