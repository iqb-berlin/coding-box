import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';

if (process.env.BACKEND_HARDENING_FIXTURE !== 'true') {
  throw new Error('Use only the disposable codebook Compose fixture; set BACKEND_HARDENING_FIXTURE=true.');
}
const root = fileURLToPath(new URL('../../..', import.meta.url));
const runtimeDirectory = process.env.BACKEND_HARDENING_RUNTIME_DIR ?
  path.resolve(process.env.BACKEND_HARDENING_RUNTIME_DIR) : root;
const executable = process.env.BACKEND_HARDENING_RUNTIME_DIR ?
  path.join(runtimeDirectory, 'main.js') : path.join(root, 'dist/apps/backend/main.js');
const output = path.resolve(process.env.BACKEND_HARDENING_PROOF_DIR || 'dist/backend-hardening-proof');
const environment = {
  ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', API_HOST: '127.0.0.1',
  POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '15441', POSTGRES_USER: 'codebook_test',
  POSTGRES_PASSWORD: 'disposable_test_only', POSTGRES_DB: 'codebook_test',
  REDIS_HOST: '127.0.0.1', REDIS_PORT: '16441', REDIS_PREFIX: 'backend-hardening-proof',
  JWT_SECRET: 'backend-hardening-disposable-proof', OAUTH2_CLIENT_ID: 'backend-hardening-proof',
  OAUTH2_CLIENT_SECRET: '', OIDC_ISSUER: 'http://fixture.invalid/realms/proof',
  OIDC_JWKS_URI: 'http://fixture.invalid/realms/proof/certs',
  OIDC_ACCOUNT_ENDPOINT: '', OIDC_AUTHORIZATION_ENDPOINT: '', OIDC_TOKEN_ENDPOINT: '',
  OIDC_USERINFO_ENDPOINT: '', OIDC_END_SESSION_ENDPOINT: ''
};
delete environment.NO_COLOR;
delete environment.FORCE_COLOR;
const database = new pg.Client({
  host: environment.POSTGRES_HOST, port: Number(environment.POSTGRES_PORT),
  user: environment.POSTGRES_USER, password: environment.POSTGRES_PASSWORD,
  database: environment.POSTGRES_DB
});
const redis = new Redis({ host: environment.REDIS_HOST, port: Number(environment.REDIS_PORT), lazyConnect: true });
const report = { binarySha256: createHash('sha256').update(await readFile(executable)).digest('hex'), probes: [] };
const processes = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout, message) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await pause(100);
  }
  throw new Error(message);
}
async function counts() {
  const query = await database.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
  const clients = (await redis.client('LIST')).trim().split('\n').filter(Boolean);
  return { postgres: query.rows[0].count, redis: clients.length };
}
function start(role, overrides = {}) {
  let logs = '';
  const child = spawn(process.execPath, [executable], {
    cwd: runtimeDirectory, env: { ...environment, APP_ROLE: role, ...overrides }, stdio: ['ignore', 'pipe', 'pipe']
  });
  processes.add(child);
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  let ended = false;
  const exit = once(child, 'exit').then(([code, signal]) => {
    ended = true;
    processes.delete(child);
    return { code, signal };
  });
  return { child, exit, logs: () => logs, ended: () => ended };
}
async function stop(app, baseline, label) {
  const started = Date.now();
  app.child.kill('SIGTERM');
  await until(async () => app.ended(), 9000, label + ': did not terminate within nine seconds');
  const exit = await app.exit;
  if (exit.signal !== 'SIGTERM' && exit.code !== 0) throw new Error(label + ': unexpected shutdown ' + JSON.stringify(exit));
  await until(async () => {
    const current = await counts();
    return current.postgres <= baseline.postgres && current.redis <= baseline.redis;
  }, 5000, label + ': connections remained after shutdown');
  return { signal: 'SIGTERM', elapsedMs: Date.now() - started, exit, after: await counts() };
}
try {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(3333, '127.0.0.1', resolve);
  });
  await new Promise(resolve => reservation.close(resolve));
  await database.connect();
  await redis.connect();
  const baseline = await counts();
  if (baseline.postgres !== 0 || baseline.redis !== 1) throw new Error('Fixture is already in use: ' + JSON.stringify(baseline));

  const invalid = start('api', { JWT_SECRET: '' });
  await until(async () => invalid.ended(), 10000, 'Invalid configuration did not fail promptly');
  const invalidExit = await invalid.exit;
  if (!invalidExit.code || !invalid.logs().includes('JWT_SECRET must be a non-empty string')) {
    throw new Error('Missing JWT_SECRET was not rejected safely: ' + invalid.logs());
  }
  const invalidCounts = await counts();
  if (invalidCounts.postgres !== baseline.postgres || invalidCounts.redis !== baseline.redis) {
    throw new Error('Invalid configuration opened infrastructure connections');
  }
  report.probes.push({ role: 'api', invalidConfiguration: 'JWT_SECRET', exit: invalidExit, connections: invalidCounts });

  for (const role of ['api', 'export-worker']) {
    const app = start(role, role === 'export-worker' ? {
      JWT_SECRET: '', OAUTH2_CLIENT_ID: '', OIDC_ISSUER: '', OIDC_JWKS_URI: ''
    } : {});
    await until(async () => {
      if (app.ended()) throw new Error(role + ' exited before ready: ' + app.logs());
      if (role === 'export-worker') return app.logs().includes('Export worker started');
      try { return (await fetch('http://127.0.0.1:3333/api/health')).ok; } catch { return false; }
    }, 60000, role + ': startup timed out');
    const active = await counts();
    if (active.postgres <= baseline.postgres || active.redis <= baseline.redis) {
      throw new Error(role + ': did not establish real PostgreSQL and Redis connections');
    }
    const shutdown = await stop(app, baseline, role);
    report.probes.push({ role, started: true, active, shutdown });
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, role + '.log'), app.logs());
  }
  report.success = true;
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  for (const child of processes) child.kill('SIGKILL');
  await database.end().catch(() => undefined);
  redis.disconnect();
}
