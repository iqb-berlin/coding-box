import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'backend-runner-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = path.join(root, 'tools/backend-vitest');
  mkdirSync(tools, { recursive: true });
  for (const file of ['run.mjs', 'arguments.mjs', 'environment.mjs', 'selection.mjs', 'vitest.config.mjs', 'adapter.mjs', 'manifest.json']) {
    copyFileSync(path.join(directory, file), path.join(tools, file));
  }
  symlinkSync(path.join(directory, 'node_modules'), path.join(tools, 'node_modules'), 'dir');
  writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  const sources = path.join(root, 'apps/backend/src');
  mkdirSync(sources, { recursive: true });
  writeFileSync(path.join(sources, 'optin.postgres.spec.ts'), `
    const live = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? it : it.skip;
    live('executes the explicitly enabled PostgreSQL case', () => {
      expect(process.env.POSTGRES_DB).toBe('disposable_fixture');
      expect(process.env.REDIS_HOST).toBe('synthetic-test-redis');
      expect(process.env.REDIS_PORT).toBe('16379');
      expect(process.env.REDIS_PREFIX).toBe('runner-fixture');
    });
  `);
  writeFileSync(path.join(sources, 'deletion.postgres.spec.ts'), `
    const live = process.env.WORKSPACE_DELETION_TEST_DATABASE_URL ? it : it.skip;
    live('executes the independently enabled workspace deletion case', () => {
      expect(process.env.WORKSPACE_DELETION_TEST_DATABASE_URL).toBe('postgresql://fixture:synthetic@test.invalid/postgres');
      expect(process.env.REDIS_HOST).toBe('synthetic-test-redis');
    });
  `);
  writeFileSync(path.join(sources, 'unit.spec.ts'), `
    it('does not inherit application Redis in an ordinary unit run', () => {
      expect(process.env.POSTGRES_INTEGRATION_TESTS).toBe('false');
      expect(process.env.WORKSPACE_DELETION_TEST_DATABASE_URL).toBe('');
      expect(process.env.REDIS_HOST).toBeUndefined();
      expect(process.env.REDIS_PORT).toBeUndefined();
      expect(process.env.REDIS_PREFIX).toBeUndefined();
    });
  `);
  return (args, overrides = {}) => {
    const environment = { ...process.env };
    for (const key of ['POSTGRES_INTEGRATION_TESTS', 'WORKSPACE_DELETION_TEST_DATABASE_URL', 'KAPPA_QUERY_TEST_DATABASE_URL', 'BULLMQ_TEST_REDIS_HOST', 'BULLMQ_TEST_REDIS_PORT']) delete environment[key];
    const result = spawnSync(process.execPath, [path.join(tools, 'run.mjs'), '--tests-only', ...args], {
      cwd: root, encoding: 'utf8', timeout: 30000, env: {
        ...environment, POSTGRES_DB: 'disposable_fixture',
        REDIS_HOST: 'synthetic-test-redis', REDIS_PORT: '16379', REDIS_PREFIX: 'runner-fixture', ...overrides
      }
    });
    assert.ifError(result.error);
    return { result, report: JSON.parse(readFileSync(path.join(root, 'coverage/apps/backend/results.json'), 'utf8')) };
  };
}

test('the real runner executes explicit PostgreSQL opt-ins selected by an anchored regular expression', t => {
  const run = fixture(t);
  const { result, report } = run([String.raw`--testPathPatterns=optin\.postgres\.spec\.ts$`], { POSTGRES_INTEGRATION_TESTS: 'true' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(report.numPassedTests, 1);
  assert.equal(report.numPendingTests, 0);
});

test('the real runner preserves the independent workspace deletion opt-in', t => {
  const run = fixture(t);
  const { result, report } = run([String.raw`--testPathPatterns=deletion\.postgres\.spec\.ts$`], {
    WORKSPACE_DELETION_TEST_DATABASE_URL: 'postgresql://fixture:synthetic@test.invalid/postgres'
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(report.numPassedTests, 1);
  assert.equal(report.numPendingTests, 0);
});

test('the real runner keeps ordinary unit runs offline', t => {
  const run = fixture(t);
  const { result, report } = run(['--filter=unit.spec.ts']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(report.numPassedTests, 1);
});

test('unmatched regular expressions fail without falling back to the complete suite', t => {
  const run = fixture(t);
  const { result, report } = run(['--testPathPatterns=does-not-exist']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(report.numPassedTests, 0);
  assert.equal(report.success, false);
});
