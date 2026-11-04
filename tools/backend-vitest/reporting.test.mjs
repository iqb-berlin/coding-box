import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import configuration from './vitest.config.mjs';
import { prepareUnitReports } from './run.mjs';

const binary = fileURLToPath(new URL('./node_modules/vitest/vitest.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'backend-vitest-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'), `export default { test: {
    globals: true, include: ['*.spec.js'], maxWorkers: 1, passWithNoTests: false,
    coverage: { provider: 'v8', clean: ${configuration.test.coverage.clean}, include: ['source.js'], reporter: ['json-summary'],
      reportsDirectory: 'coverage', thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 } }
  } };`);
  return { root, run(args = []) {
    const result = spawnSync(process.execPath, [binary, 'run', '--root', root,
      '--config', path.join(root, 'vitest.config.mjs'), '--reporter=junit',
      '--outputFile=' + path.join(root, 'junit.xml'), ...args], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    return result;
  } };
}

test('native Vitest JUnit reports module initialization failures alongside passed assertions', t => {
  const { root, run } = fixture(t);
  writeFileSync(path.join(root, 'passed.spec.js'), "test('baseline assertion', () => expect(true).toBe(true));");
  writeFileSync(path.join(root, 'startup.spec.js'), "throw new Error('backend startup regression');");
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = readFileSync(path.join(root, 'junit.xml'), 'utf8');
  assert.match(report, /baseline assertion/);
  assert.match(report, /backend startup regression/);
  assert.match(report, /<failure/);
});

test('coverage rejects insufficient totals and preserves independent integration evidence', t => {
  const { root, run } = fixture(t);
  writeFileSync(path.join(root, 'source.js'), 'export const used = () => 1; export const unused = () => 2;');
  writeFileSync(path.join(root, 'coverage.spec.js'), "import { used } from './source.js'; test('covered', () => expect(used()).toBe(1));");
  const output = path.join(root, 'coverage');
  mkdirSync(output);
  writeFileSync(path.join(output, 'integration-results.json'), 'integration proof');
  writeFileSync(path.join(output, 'old-unit.json'), 'stale unit proof');
  prepareUnitReports(output);
  assert.equal(existsSync(path.join(output, 'old-unit.json')), false);
  const result = run(['--coverage']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /does not meet.*threshold/i);
  const summary = JSON.parse(readFileSync(path.join(root, 'coverage/coverage-summary.json'), 'utf8'));
  assert.ok(summary.total.functions.pct < 100);
  assert.equal(readFileSync(path.join(output, 'integration-results.json'), 'utf8'), 'integration proof');
});

test('an empty Vitest collection fails instead of producing a passing gate', t => {
  const { root, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(readFileSync(path.join(root, 'junit.xml'), 'utf8'), /tests="0"/);
});
