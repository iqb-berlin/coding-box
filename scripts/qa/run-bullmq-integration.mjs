import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const nxManifest = require.resolve('nx/package.json');
const nxBinary = path.resolve(path.dirname(nxManifest), require(nxManifest).bin.nx);
const directory = await mkdtemp(path.join(tmpdir(), 'coding-box-bullmq-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));

const redis = spawn(process.env.BULLMQ_REDIS_SERVER || 'redis-server', [
  '--bind', '127.0.0.1', '--port', String(port), '--dir', directory,
  '--save', '', '--appendonly', 'no', '--protected-mode', 'yes'
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Redis did not start: ${output}`)), 10_000);
    const onOutput = chunk => {
      output = `${output}${chunk}`.slice(-8_000);
      if (output.includes('Ready to accept connections')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    redis.stdout.on('data', onOutput);
    redis.stderr.on('data', onOutput);
    redis.once('error', error => {
      clearTimeout(timeout);
      reject(new Error(`Cannot start Redis; set BULLMQ_REDIS_SERVER to a redis-server binary: ${error.message}`));
    });
    redis.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Redis exited (${code}): ${output}`));
    });
  });
  const test = spawn(process.execPath, [
    nxBinary, 'test', 'backend',
    '--runInBand', '--skipNxCache',
    ...(process.argv.includes('--all') ? [] : ['--testPathPatterns=bullmq.integration'])
  ], {
    cwd: root, stdio: 'inherit',
    env: {
      ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true',
      BULLMQ_TEST_REDIS_HOST: '127.0.0.1', BULLMQ_TEST_REDIS_PORT: String(port)
    }
  });
  process.exitCode = await new Promise((resolve, reject) => {
    test.once('error', reject);
    test.once('exit', code => resolve(code ?? 1));
  });
} finally {
  if (redis.pid && redis.exitCode === null && redis.signalCode === null) {
    await new Promise(resolve => {
      const force = setTimeout(() => redis.kill('SIGKILL'), 5_000);
      redis.once('exit', () => { clearTimeout(force); resolve(); });
      redis.kill('SIGTERM');
    });
  }
  await rm(directory, { recursive: true, force: true });
}
