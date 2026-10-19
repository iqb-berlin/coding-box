import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const schema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('!reference', { kind: 'sequence', construct: data => data })
]);
const read = name => yaml.load(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8'), { schema });
const config = Object.assign({}, read('.gitlab-ci.yml'),
  read('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'),
  read('.gitlab-ci/Release-Pipelines.gitlab-ci.yml'),
  read('.gitlab-ci/Quality-Gates.gitlab-ci.yml'));
const gates = ['test-backend', 'test-frontend', 'lint-app', 'test-replay-live',
  'test-auth-live', 'test-workflows-live'];
const publishers = ['build-main-pr-backend-image', 'build-main-pr-frontend-image',
  'build-develop-commit-backend-image', 'build-develop-commit-frontend-image',
  'build-main-commit-backend-image', 'build-main-commit-frontend-image',
  'build-pre-release', 'build-release'];
const resolve = name => {
  const job = config[name];
  assert.ok(job, `Missing job ${name}`);
  return { ...(job.extends ? resolve(job.extends) : {}), ...job };
};
function matches(expression, env) {
  return expression.split(/\s*\|\|\s*/).some(or => or.split(/\s*&&\s*/).every(atom => {
    const match = atom.trim().match(/^\$(\w+)(?:\s*(==|!=|=~)\s*(?:"([^"]*)"|\$(\w+)))?$/);
    assert.ok(match, `Unsupported rule expression: ${atom}`);
    const [, key, op, literal, variable] = match;
    const left = env[key] || '';
    const right = variable ? (env[variable] || '') : literal;
    if (!op) return Boolean(left);
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    assert.ok(right.startsWith('/') && right.endsWith('/'));
    return new RegExp(right.slice(1, -1)).test(left);
  }));
}
function selected(name, env) {
  const rules = resolve(name).rules.flatMap(rule => Array.isArray(rule) ? config[rule[0]][rule[1]] : [rule]);
  const rule = rules.find(candidate => !candidate.if || matches(candidate.if, env));
  return Boolean(rule && rule.when !== 'never');
}
const scenarios = [
  ['GitHub develop PR', { CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME: 'develop', CI_PIPELINE_SOURCE: 'external_pull_request_event' }],
  ['GitHub main PR', { CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME: 'main', CI_PIPELINE_SOURCE: 'external_pull_request_event' }],
  ['GitLab develop MR', { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'develop', CI_PIPELINE_SOURCE: 'merge_request_event' }],
  ['GitLab main MR', { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main', CI_PIPELINE_SOURCE: 'merge_request_event' }],
  ['feature push', { CI_COMMIT_BRANCH: 'feature-fixture', CI_PIPELINE_SOURCE: 'push' }],
  ['develop push', { CI_COMMIT_BRANCH: 'develop', CI_PIPELINE_SOURCE: 'push' }],
  ['main push', { CI_COMMIT_BRANCH: 'main', CI_PIPELINE_SOURCE: 'push' }],
  ['prerelease tag', { CI_COMMIT_TAG: '2.0.0-rc.1', CI_PIPELINE_SOURCE: 'push' }],
  ['release tag', { CI_COMMIT_TAG: '2.0.0', CI_PIPELINE_SOURCE: 'push' }]
];
for (const [label, values] of scenarios) {
  test(`${label} includes every blocking functional gate and its dependencies`, () => {
    const env = { ...config.variables, ...values };
    for (const gate of gates) {
      assert.ok(selected(gate, env), `${label}: ${gate} is absent`);
      assert.equal(resolve(gate).allow_failure, false, gate);
      for (const dependency of resolve(gate).needs || []) {
        const name = typeof dependency === 'string' ? dependency : dependency.job;
        if (!dependency.optional) {
          assert.ok(selected(name, env), `${gate} needs absent ${name}`);
          assert.ok(config.stages.indexOf(resolve(name).stage) <= config.stages.indexOf(resolve(gate).stage),
            `${gate} needs a job in a later stage: ${name}`);
        }
      }
    }
    for (const publisher of publishers.filter(name => selected(name, env))) {
      const needs = resolve(publisher).needs;
      for (const dependency of needs) {
        const name = typeof dependency === 'string' ? dependency : dependency.job;
        if (dependency.optional) continue;
        assert.ok(selected(name, env), `${publisher} needs absent ${name}`);
        assert.ok(config.stages.indexOf(resolve(name).stage) <= config.stages.indexOf(resolve(publisher).stage),
          `${publisher} needs a job in a later stage: ${name}`);
      }
      for (const gate of gates) {
        assert.ok(needs.some(need => need.job === gate && !need.optional), `${publisher} bypasses ${gate}`);
      }
    }
  });
}
test('release backend test and lint failures block publication', () => {
  for (const name of ['test-main-pr-backend', 'lint-main-pr-backend']) {
    assert.equal(resolve(name).allow_failure, false);
  }
  const job = resolve('test-backend');
  assert.ok(job.script.some(command => command.includes('backend --configuration=ci')));
  assert.equal(job.artifacts.when, 'always');
  assert.equal(job.artifacts.reports.junit, 'coverage/apps/backend/junit.xml');
  const project = JSON.parse(readFileSync(new URL('../../apps/backend/project.json', import.meta.url)));
  assert.equal(project.targets.test.configurations.ci.codeCoverage, true);
  assert.equal(project.targets.test.options.passWithNoTests, false);
});

test('the installed frontend JUnit reporter includes suite initialization errors', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-junit-startup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ts = require('typescript');
  const source = readFileSync(new URL('../../apps/frontend/jest.config.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  runInNewContext(compiled.outputText, { exports });
  const [, options] = exports.default.reporters.find(reporter => Array.isArray(reporter) && reporter[0] === 'jest-junit');
  const Reporter = require('jest-junit');
  const reporter = new Reporter({ rootDir: directory }, {
    ...options, outputDirectory: directory, outputName: 'junit.xml'
  });
  await reporter.onRunComplete(new Set(), {
    startTime: Date.now(), numTotalTestSuites: 1, numTotalTests: 0, numFailedTests: 0,
    numPendingTests: 0, testResults: [{
      testFilePath: join(directory, 'startup.spec.ts'),
      testResults: [], numPassingTests: 0, numFailingTests: 0, numPendingTests: 0,
      perfStats: { start: 1, end: 2 },
      testExecError: { message: 'Synthetic suite initialization failure' },
      failureMessage: 'Synthetic suite initialization failure'
    }]
  });
  const xml = readFileSync(join(directory, 'junit.xml'), 'utf8');
  assert.match(xml, /<testcase/);
  assert.match(xml, /<failure/);
  assert.match(xml, /Synthetic suite initialization failure/);
});
