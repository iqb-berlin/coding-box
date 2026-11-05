import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { readWorkflowCatalog, workflowCoverage } from './e2e-workflows.mjs';
import { renderSummary, summarizeReports } from './e2e-report.mjs';

const require = createRequire(import.meta.url);
const { buildReport, renderJunit, registerCypressReporting } = require('./cypress-reporting.cjs');
const { parseStringPromise } = require('xml2js');
const root = path.resolve(import.meta.dirname, '../..');
const spec = 'cypress/auth/example.cy.ts';
const reference = { suite: 'auth-live', spec, title: 'saves a result' };
const catalog = { scope: 'test', workflows: [{ id: 'WF-001', name: 'Save', priority: 'critical', tests: [reference] }] };
const result = (state = 'passed') => ({ browserName: 'electron', totalDuration: 1200,
  runs: [{ spec: { relative: spec }, stats: { tests: 1 }, tests: [{
    title: ['Session & <coding>', reference.title], state, duration: 1100,
    attempts: [{ state }], displayError: 'Authorization: Bearer secret-do-not-publish'
  }] }] });
const report = state => buildReport('auth-live', result(state), { revision: 'a'.repeat(40), pipelineId: '1' });

test('JUnit is valid XML, preserves durations and escaped names, and excludes browser diagnostics', async () => {
  const failed = report('failed');
  const xml = renderJunit(failed);
  const parsed = await parseStringPromise(xml);
  const suite = parsed.testsuites.testsuite[0];
  assert.equal(suite.$.failures, '1');
  assert.equal(suite.$.time, '1.2');
  assert.equal(suite.testcase[0].$.time, '1.1');
  assert.equal(suite.testcase[0].$.name, 'Session & <coding> > saves a result');
  assert.doesNotMatch(xml + JSON.stringify(failed), /secret-do-not-publish/);
});

test('empty specs, startup failures and unmatched run failures cannot become successful reports', () => {
  const empty = result(); empty.runs[0].tests = [];
  assert.equal(buildReport('auth-live', empty).summary.errors, 1);
  const startup = buildReport('auth-live', { message: 'secret-do-not-publish' });
  assert.equal(startup.summary.errors, 1);
  assert.doesNotMatch(JSON.stringify(startup), /secret-do-not-publish/);
  const outside = result(); outside.totalFailed = 2;
  assert.equal(buildReport('auth-live', outside).summary.errors, 1);
});

test('skipped tests and a failed retry followed by a pass remain distinguishable', () => {
  const data = result();
  data.runs[0].tests[0].attempts = [{ state: 'failed' }, { state: 'passed' }];
  data.runs[0].tests.push({ title: ['skipped'], state: 'pending', attempts: [] });
  const built = buildReport('auth-live', data);
  assert.equal(built.summary.retriedPasses, 1);
  assert.equal(built.summary.skipped, 1);
  assert.match(renderJunit(built), /<skipped\/>/);
});

test('reports survive cleanup failure and reject stale artifacts at the start of a new run', async t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'cypress-report-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'coverage/cypress/auth-live');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'results.json'), 'stale');
  const hooks = new Map();
  registerCypressReporting((event, callback) => hooks.set(event, callback), { projectRoot: directory }, 'auth-live', async () => { throw new Error('cleanup failed'); });
  assert.equal(fs.existsSync(path.join(output, 'results.json')), true, 'configuration inspection preserves previous results');
  hooks.get('before:run')();
  assert.equal(fs.existsSync(path.join(output, 'results.json')), false);
  await assert.rejects(hooks.get('after:run')(result()), /cleanup failed/);
  const saved = JSON.parse(fs.readFileSync(path.join(output, 'results.json')));
  assert.equal(saved.summary.errors, 1);
  assert.match(fs.readFileSync(path.join(output, 'junit.xml'), 'utf8'), /<error /);
});

test('the checked-in catalog refers to unique active live tests and records external gaps', () => {
  const actual = readWorkflowCatalog(root);
  const coverage = workflowCoverage(actual);
  assert.ok(coverage.critical.total > 0);
  assert.equal(coverage.critical.mapped, coverage.critical.total);
  assert.equal(coverage.critical.passed, 0);
  assert.ok(coverage.summary.gaps > 0);
});

test('deleted, renamed, disabled and duplicate references fail catalog validation', t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'workflow-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(path.join(directory, spec)), { recursive: true });
  const manifest = { schemaVersion: 1, scope: 'test', workflows: [{ ...catalog.workflows[0], risk: 'Loss' }] };
  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(manifest));
  for (const source of ["it('renamed', () => {});", "it.skip('saves a result', () => {});",
    "describe.skip('suite', () => { it('saves a result', () => {}); });",
    "it('saves a result', () => {}); it('saves a result', () => {});"]) {
    fs.writeFileSync(path.join(directory, spec), source);
    assert.throws(() => readWorkflowCatalog(directory, 'catalog.json'), /expected one active test/);
  }
  fs.writeFileSync(path.join(directory, spec), "it('saves a result', () => {});");
  assert.equal(readWorkflowCatalog(directory, 'catalog.json').workflows.length, 1);
  manifest.workflows.push(manifest.workflows[0]);
  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(manifest));
  assert.throws(() => readWorkflowCatalog(directory, 'catalog.json'), /duplicate/);
});

test('plan coverage is separate from successful execution and requires every referenced test', () => {
  assert.equal(workflowCoverage(catalog).critical.mapped, 1);
  assert.equal(workflowCoverage(catalog).critical.passed, 0);
  for (const state of ['pending', 'skipped', 'failed']) assert.equal(workflowCoverage(catalog, [report(state)]).critical.passed, 0);
  assert.equal(workflowCoverage(catalog, [report('passed')]).critical.passed, 1);
  assert.equal(workflowCoverage(catalog, [report('passed'), report('passed')]).critical.passed, 0);
  const incomplete = structuredClone(catalog);
  incomplete.workflows[0].tests.push({ ...reference, title: 'also required' });
  assert.equal(workflowCoverage(incomplete, [report('passed')]).critical.passed, 0);
  const error = report('passed'); error.summary.errors = 1;
  assert.equal(workflowCoverage(catalog, [error]).critical.passed, 0);
});

test('aggregate reports expose missing suites, execution failure rate and the slowest tests', () => {
  const data = summarizeReports(catalog, [report('failed')], ['auth-live', 'replay-live']);
  assert.deepEqual(data.missingSuites, ['replay-live']);
  assert.equal(data.summary.failureRate, 1);
  assert.equal(data.slowestTests[0].durationMs, 1100);
  assert.match(renderSummary(data), /1\/1 mit Live-Testreferenzen; 0\/1/);
  assert.match(renderSummary(data), /Fehlende Suiten: replay-live/);
  assert.deepEqual(data.unverifiedRequiredWorkflows, ['WF-001']);
  const skipped = summarizeReports(catalog, [report('pending')], ['auth-live']);
  assert.deepEqual(skipped.unverifiedRequiredWorkflows, ['WF-001']);
  assert.equal(skipped.summary.failureRate, null);
  const other = { ...report('passed'), suite: 'replay-live', revision: 'b'.repeat(40) };
  assert.equal(summarizeReports(catalog, [report('passed'), other]).inconsistentSources, true);
});
