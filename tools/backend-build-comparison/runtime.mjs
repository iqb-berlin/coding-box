import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const nxManifest = require.resolve('nx/package.json');
const nx = path.resolve(path.dirname(nxManifest), require(nxManifest).bin.nx);
const variant = process.argv.find(value => value.startsWith('--variant='))?.split('=')[1];
const phase = process.argv.find(value => value.startsWith('--phase='))?.split('=')[1];
assert.ok(['webpack', 'rspack', 'tsc'].includes(variant));
assert.ok(['codebook', 'browser', 'worker'].includes(phase));
const directory = path.join(root, 'tmp/backend-build-comparison');
const infra = path.join(directory, 'infra');
const proof = path.join(directory, `${phase}-${variant}`);
await mkdir(proof, { recursive: true });
const executable = path.join(root, `dist/backend-build-comparison/${variant}/main.mjs`);
const digest = data => createHash('sha256').update(data).digest('hex');
const artifactHash = createHash('sha256');
const artifactFiles = [];
async function hashTree(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashTree(file);
    else artifactFiles.push(file);
  }
}
await hashTree(path.dirname(executable));
for (const file of artifactFiles.sort()) {
  artifactHash.update(path.relative(path.dirname(executable), file)); artifactHash.update('\0');
  artifactHash.update(await readFile(file));
}
const started = performance.now();
const report = { variant, phase, sourceCommit: '7a4197c5badd19a89c220c4c1c83e85f1cff82dd',
  transport: 'Own local PostgreSQL 14.24 / Redis 7.4.2 / Keycloak 26.4.0; no production data; no Docker claim',
  entrySha256: digest(await readFile(executable)), startedAt: new Date().toISOString() };
report.artifactTreeSha256 = artifactHash.digest('hex');
const environment = {
  ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_ISOLATE_PLUGINS: 'false',
  API_HOST: '127.0.0.1', POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '25441',
  POSTGRES_USER: phase === 'browser' ? 'replay_e2e' : 'codebook_test',
  POSTGRES_PASSWORD: 'disposable_test_only', POSTGRES_DB: phase === 'browser' ? 'replay_e2e' : 'codebook_test',
  REDIS_HOST: '127.0.0.1', REDIS_PORT: '26441', APP_ROLE: phase === 'worker' ? 'export-worker' : 'api',
  JWT_SECRET: 'build-comparison-disposable-local-proof-only',
  OAUTH2_CLIENT_ID: phase === 'browser' ? 'replay-e2e' : 'codebook-proof',
  OAUTH2_CLIENT_SECRET: '', NODE_ENV: 'development'
};
const issuer = `http://127.0.0.1:28441/realms/${phase === 'browser' ? 'coding-e2e' : 'codebook-proof'}`;
Object.assign(environment, {
  OIDC_ISSUER: issuer, OIDC_JWKS_URI: issuer + '/protocol/openid-connect/certs',
  OIDC_AUTHORIZATION_ENDPOINT: issuer + '/protocol/openid-connect/auth',
  OIDC_TOKEN_ENDPOINT: issuer + '/protocol/openid-connect/token',
  OIDC_USERINFO_ENDPOINT: issuer + '/protocol/openid-connect/userinfo',
  OIDC_END_SESSION_ENDPOINT: issuer + '/protocol/openid-connect/logout',
  OIDC_ACCOUNT_ENDPOINT: issuer + '/account', FRONTEND_URL: 'http://127.0.0.1:24200',
  OAUTH2_REDIRECT_URL: '//127.0.0.1:24200/api/auth/callback',
  REDIS_PREFIX: phase === 'browser' ? `replay-e2e:build-comparison-${variant}` : 'codebook-proof'
});

const children = new Set();
function start(command, args, env, name) {
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(path.join(proof, name + '.log'));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once('exit', () => log.end());
  children.add(child);
  child.comparisonName = name;
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const started = performance.now();
  const exit = once(child, 'exit');
  process.kill(-child.pid, 'SIGTERM');
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 9000))]);
  const forced = child.exitCode === null && child.signalCode === null;
  if (forced) { process.kill(-child.pid, 'SIGKILL'); await exit; }
  return { forced, elapsedMs: performance.now() - started, exitCode: child.exitCode, signal: child.signalCode };
}
async function run(command, args, env, name) {
  const child = start(command, args, env, name);
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${name} failed; see ${proof}/${name}.log`);
}
async function reserve(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
let frontend;
try {
  await reserve(3333);
  const backend = start(process.execPath, [executable], environment, 'backend');
  const deadline = Date.now() + 60_000;
  while (true) {
    if (backend.exitCode !== null) throw new Error('Backend exited before readiness; see backend.log');
    try {
      if (phase === 'worker') {
        if ((await readFile(path.join(proof, 'backend.log'), 'utf8')).includes('Export worker started')) break;
      } else {
        const response = await fetch('http://127.0.0.1:3333/api/health', { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) break;
      }
    } catch {}
    if (Date.now() > deadline) throw new Error('Backend readiness timed out; see backend.log');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.startupMs = performance.now() - started;
  if (phase !== 'worker') {
    const document = await fetch('http://127.0.0.1:3333/api/docs-json');
    assert.equal(document.status, 200, 'The generated OpenAPI document must be available');
    const schema = await document.json();
    await writeFile(path.join(proof, 'openapi.json'), JSON.stringify(schema, null, 2));
  }
  if (phase === 'codebook') {
    const originalFile = path.join(root, 'scripts/e2e/codebook/verify-live.mjs');
    const original = await readFile(originalFile, 'utf8');
    const transformed = original.replace(/from '([.][^']+)'/g, (_, specifier) =>
      `from '${new URL(specifier, 'file://' + originalFile).href}'`)
      .replaceAll('15441', '25441').replaceAll('16441', '26441').replaceAll('18441', '28441')
      .replace('assert.equal(schema.rows[0].n, 163)', 'assert.equal(schema.rows[0].n, 169)')
      .replaceAll("readFile('dist/apps/backend/main.mjs')", 'readFile(process.env.BUILD_COMPARISON_MAIN)');
    const runner = path.join(directory, 'codebook-verify.mjs');
    await writeFile(runner, transformed);
    report.originalRunnerSha256 = digest(original);
    report.adaptedRunnerSha256 = digest(transformed);
    report.fixtureAdaptations = 'Local service ports, relative imports, artifact hash input; migration ledger count 169 for current included changesets (legacy runner expected 163). Export/autocoder assertions unchanged.';
    await run(process.execPath, [runner], { ...environment, CODEBOOK_PROOF_DIR: proof,
      BUILD_COMPARISON_MAIN: executable }, 'codebook');
    const result = JSON.parse(await readFile(path.join(proof, 'report.json'), 'utf8'));
    assert.equal(result.passed, true);
    report.exports = result.exports.length;
    report.autocoder = result.autocoder.length;
    report.failedPreflightLeavesPersistenceUnchanged = result.failedAutocoder.persistenceUnchanged;
  } else if (phase === 'browser') {
    await reserve(24200);
    const auth = JSON.parse(await readFile(path.join(infra, 'auth/environment.json'), 'utf8'));
    const bin = path.join(infra, 'bin'); await mkdir(bin, { recursive: true });
    await symlink(path.join(root, 'tools/backend-build-comparison/local-docker-transport.py'),
      path.join(bin, 'docker')).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const frontendRoot = path.join(root, 'dist/apps/frontend');
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html' };
    frontend = createServer(async (request, response) => {
      if (request.url.startsWith('/api/')) {
        const proxy = httpRequest({ hostname: '127.0.0.1', port: 3333, path: request.url,
          method: request.method, headers: request.headers }, upstream => {
          response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
        });
        proxy.on('error', () => { response.statusCode = 502; response.end(); });
        request.pipe(proxy); return;
      }
      try {
        if (request.url.split('?')[0] === '/assets/config/runtime-config.js') {
          response.setHeader('content-type', 'text/javascript');
          response.end(await readFile(path.join(infra, 'auth/runtime-config.js'))); return;
        }
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        let file = path.resolve(frontendRoot, '.' + pathname);
        if (!file.startsWith(frontendRoot + path.sep) || !(await stat(file).catch(() => undefined))?.isFile()) {
          file = path.join(frontendRoot, 'index.html');
        }
        response.setHeader('content-type', mime[path.extname(file)] ?? 'application/octet-stream');
        response.end(await readFile(file));
      } catch { response.statusCode = 500; response.end(); }
    });
    await new Promise(resolve => frontend.listen(24200, '127.0.0.1', resolve));
    const testEnvironment = {
      ...environment, ...auth, PATH: bin + path.delimiter + environment.PATH,
      REPLAY_E2E_API_URL: 'http://127.0.0.1:3333', REPLAY_E2E_BASE_URL: 'http://127.0.0.1:24200',
      REPLAY_E2E_CACHE_DIR: path.join(directory, 'player-cache'),
      REPLAY_E2E_COMPOSE_PROJECT: `coding-box-replay-build-comparison-${variant}`,
      REPLAY_E2E_FIXTURE_DIR: path.join(root, 'cypress/fixtures/replay-datasets/two-person-multipage'),
      REPLAY_E2E_JWT_SECRET: environment.JWT_SECRET, REPLAY_E2E_RUN_ID: `build-comparison-${variant}`,
      REPLAY_E2E_STATE_FILE: path.join(proof, 'state.json'), BUILD_COMPARISON_PROOF: proof
    };
    await run(process.execPath, [nx, 'run', 'frontend:e2e-build-comparison-pilot', '--skip-nx-cache'],
      testEnvironment, 'cypress');
    const result = JSON.parse(await readFile(path.join(proof, 'cypress-results.json'), 'utf8'));
    assert.ok(result.totalTests > 0 && result.totalFailed === 0);
    report.browser = result;
  } else { report.workerStarted = true; }
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack;
  process.exitCode = 1;
} finally {
  if (frontend) { frontend.closeAllConnections(); await new Promise(resolve => frontend.close(resolve)); }
  for (const child of children) {
    const outcome = await stop(child);
    if (child.comparisonName === 'backend') {
      report.shutdown = outcome;
      if (outcome?.forced) { report.passed = false; report.error = 'Backend required SIGKILL'; process.exitCode = 1; }
    }
  }
  report.elapsedMs = performance.now() - started;
  await writeFile(path.join(proof, 'runtime-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ variant, phase, passed: report.passed, elapsedMs: report.elapsedMs,
    exports: report.exports, autocoder: report.autocoder, tests: report.browser?.totalTests, proof }));
}
