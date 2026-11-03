import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

const hubKeys = ['https://index.docker.io/v1/', 'index.docker.io', 'docker.io', 'registry-1.docker.io'];
const images = [
  ['ratelimitpreview/test', 'latest'],
  ['library/node', '24.22.1-bookworm'],
  ['library/node', '24.22.1-bookworm-slim'],
  ['library/docker', '28'],
  ['library/docker', '28-dind'],
  ['library/redis', '7.4-alpine'],
  ['library/postgres', 'sha256:7161c8e7347ed8b4cdefc26087702336da5f467137cc964e611c85d745df6112'],
  ['library/golang', 'sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191'],
  ['liquibase/liquibase', 'sha256:7c813a2cb861f8b4718a09375c5265909127f4cb99f56bb95c956175c9b91525'],
  ['cypress/browsers', 'node-24.22.1-chrome-156.0.8078.73-1-ff-159.0-edge-156.0.4314.50-1']
];

function credentials(config) {
  const entry = hubKeys.map(key => config.auths?.[key]).find(Boolean);
  if (entry?.username && entry?.password) return `${entry.username}:${entry.password}`;
  if (entry?.auth) return Buffer.from(entry.auth, 'base64').toString('utf8');
  return null;
}

function summarize(config, source) {
  return {
    source,
    staticHubCredentialsPresent: Boolean(credentials(config)),
    identityTokenPresent: hubKeys.some(key => Boolean(config.auths?.[key]?.identitytoken)),
    credentialHelperConfigured: Boolean(config.credsStore || hubKeys.some(key => config.credHelpers?.[key]))
  };
}

function rate(value) {
  const match = String(value ?? '').match(/^(\d+)(?:;w=(\d+))?/);
  return match ? { pulls: Number(match[1]), windowSeconds: match[2] ? Number(match[2]) : null } : null;
}

function publicHeaders(headers) {
  const source = headers['docker-ratelimit-source'];
  return {
    limit: rate(headers['ratelimit-limit']),
    remaining: rate(headers['ratelimit-remaining']),
    egressFingerprint: source ? createHash('sha256').update(String(source)).digest('hex') : null,
    digest: headers['docker-content-digest'] ?? null
  };
}

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const req = transport.request(url, { method, headers, timeout: 15000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2000000) req.destroy(new Error('RESPONSE_TOO_LARGE'));
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

async function probe(repository, ref, basic = null) {
  const tokenUrl = new URL('https://auth.docker.io/token');
  tokenUrl.searchParams.set('service', 'registry.docker.io');
  tokenUrl.searchParams.set('scope', `repository:${repository}:pull`);
  const authHeaders = basic ? { Authorization: `Basic ${Buffer.from(basic).toString('base64')}` } : {};
  const tokenResponse = await request(tokenUrl.href, 'GET', authHeaders);
  if (tokenResponse.status !== 200) return { repository, ref, tokenStatus: tokenResponse.status };
  const tokenBody = JSON.parse(tokenResponse.body);
  const token = tokenBody.token || tokenBody.access_token;
  if (typeof token !== 'string') throw new Error('TOKEN_MISSING');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const head = await request(`https://registry-1.docker.io/v2/${repository}/manifests/${ref}`, 'HEAD', {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
  });
  return {
    checkedAt: new Date().toISOString(), repository, ref,
    authenticatedSubjectPresent: Boolean(claims.sub), status: head.status,
    ...publicHeaders(head.headers)
  };
}

async function dockerInfo() {
  const daemon = process.env.DOCKER_HOST;
  if (!daemon?.startsWith('tcp://')) return { available: false, reason: 'TCP_DAEMON_NOT_CONFIGURED' };
  const url = daemon.replace(/^tcp:/, 'http:') + '/info';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await request(url);
      if (result.status === 200) {
        const info = JSON.parse(result.body);
        return { available: true, version: info.ServerVersion, imageCount: info.Images,
          registryMirrorCount: info.RegistryConfig?.Mirrors?.length ?? 0 };
      }
    } catch { /* Wait for the same DinD service used by the product CI. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return { available: false, reason: 'DAEMON_UNAVAILABLE' };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(), commit: process.env.CI_COMMIT_SHA,
    pipeline: process.env.CI_PIPELINE_URL, job: process.env.CI_JOB_URL,
    runnerId: process.env.CI_RUNNER_ID, runnerDescription: process.env.CI_RUNNER_DESCRIPTION,
    concurrentSlot: process.env.CI_CONCURRENT_ID,
    method: 'GET scoped authentication tokens; HEAD registry manifests only; no image GET or registry mutation',
    authConfigurations: [], samples: [], errors: []
  };
  const configs = [];
  try {
    const dockerConfig = join(process.env.DOCKER_CONFIG || join(homedir(), '.docker'), 'config.json');
    report.dockerClientConfigFilePresent = existsSync(dockerConfig);
    if (report.dockerClientConfigFilePresent) configs.push({ source: 'docker-client-config', config: JSON.parse(readFileSync(dockerConfig, 'utf8')) });
    report.dockerAuthConfigVariablePresent = Boolean(process.env.DOCKER_AUTH_CONFIG);
    if (process.env.DOCKER_AUTH_CONFIG) {
      const value = process.env.DOCKER_AUTH_CONFIG;
      const content = value.trim().startsWith('{') ? value : readFileSync(value, 'utf8');
      configs.push({ source: 'runner-auth-config-variable', config: JSON.parse(content) });
    }
    report.authConfigurations = configs.map(({ config, source }) => summarize(config, source));
    report.releaseLoginVariablesPresent = Boolean(process.env.DOCKERHUB_USER && process.env.DOCKERHUB_PASSWORD);
    report.dockerDaemon = await dockerInfo();
    const profiles = [{ source: 'anonymous', basic: null }, ...configs.flatMap(({ config, source }) => {
      const basic = credentials(config);
      return basic ? [{ source, basic }] : [];
    })];
    for (const profile of profiles) {
      for (const [repository, ref] of images) {
        try {
          const sample = { profile: profile.source, ...await probe(repository, ref, profile.basic) };
          report.samples.push(sample);
          console.log(JSON.stringify({ event: 'registry-head', ...sample }));
        } catch {
          report.errors.push({ profile: profile.source, repository, ref, error: 'PROBE_FAILED' });
        }
      }
    }
    report.samples.push({ profile: 'anonymous-final', ...await probe('ratelimitpreview/test', 'latest') });
  } catch {
    report.errors.push({ error: 'DIAGNOSTIC_FAILED' });
  }
  report.finishedAt = new Date().toISOString();
  report.complete = report.errors.length === 0 && report.samples.every(sample => sample.status === 200);
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/runner-docker-hub-proof.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'diagnostic-report', ...report }));
  if (!report.complete) process.exitCode = 1;
}

if (process.env.RUNNER_HUB_PROBE_SELF_TEST === '1') {
  const secret = 'fixture-user:fixture-password';
  const config = { auths: { 'https://index.docker.io/v1/': { auth: Buffer.from(secret).toString('base64') } } };
  assert.equal(credentials(config), secret);
  assert.deepEqual(summarize(config, 'fixture'), { source: 'fixture', staticHubCredentialsPresent: true,
    identityTokenPresent: false, credentialHelperConfigured: false });
  assert.equal(credentials({}), null);
  assert.equal(summarize({ credsStore: 'fixture' }, 'fixture').credentialHelperConfigured, true);
  const serialized = JSON.stringify(summarize(config, 'fixture'));
  assert.ok(!serialized.includes(secret) && !serialized.includes(config.auths[hubKeys[0]].auth));
  assert.deepEqual(rate('100;w=21600'), { pulls: 100, windowSeconds: 21600 });
  assert.equal(rate(undefined), null);
  const headers = publicHeaders({ 'ratelimit-remaining': '42;w=21600', 'docker-ratelimit-source': '192.0.2.1' });
  assert.equal(headers.remaining.pulls, 42);
  assert.ok(!JSON.stringify(headers).includes('192.0.2.1'));
  console.log('Diagnostic parsing and redaction self-tests passed');
} else {
  await main();
}
