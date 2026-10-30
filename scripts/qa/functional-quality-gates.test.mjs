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
  const booleans = expression.replace(/\$(\w+)(?:\s*(==|!=|=~)\s*(?:"([^"]*)"|\$(\w+)))?/g,
    (_atom, key, op, literal, variable) => {
      const left = env[key] || '';
      const right = variable ? (env[variable] || '') : literal;
      if (!op) return String(Boolean(left));
      if (op === '==') return String(left === right);
      if (op === '!=') return String(left !== right);
      assert.ok(right.startsWith('/') && right.endsWith('/'));
      return String(new RegExp(right.slice(1, -1)).test(left));
    });
  // Only boolean operators reach the VM; variable values are never evaluated.
  assert.match(booleans, /^(?:true|false|&&|\|\||[()\s])+$/,
    `Unsupported rule expression: ${expression}`);
  return runInNewContext(booleans, {}, { timeout: 1000 });
}
function selectedRule(rules, env) {
  return rules.flatMap(rule => Array.isArray(rule) ? config[rule[0]][rule[1]] : [rule])
    .find(candidate => !candidate.if || matches(candidate.if, env));
}
function selected(name, env) {
  const rule = selectedRule(resolve(name).rules, env);
  return Boolean(rule && rule.when !== 'never');
}
const workflowRule = env => selectedRule(config.workflow.rules, env);
const pipelineSelected = env => {
  const rule = workflowRule(env);
  return Boolean(rule && rule.when !== 'never');
};
const featurePush = {
  CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'feature-fixture',
  CI_COMMIT_SHA: 'a'.repeat(40)
};
const githubDevelopPr = {
  ...featurePush, CI_PIPELINE_SOURCE: 'external_pull_request_event',
  CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME: 'develop',
  CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME: featurePush.CI_COMMIT_BRANCH,
  CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_SHA: featurePush.CI_COMMIT_SHA,
  CI_EXTERNAL_PULL_REQUEST_SOURCE_REPOSITORY: 'iqb-berlin/coding-box',
  CI_EXTERNAL_PULL_REQUEST_TARGET_REPOSITORY: 'iqb-berlin/coding-box'
};

test('a same-repository GitHub develop PR selects exactly one complete pipeline', () => {
  assert.equal(pipelineSelected(githubDevelopPr), false);
  assert.equal(pipelineSelected(featurePush), true);
  const env = { ...config.variables, ...featurePush };
  for (const name of [...gates, 'install-dependencies', 'build-app', 'test-browser',
    'audit-app', 'build-db-image', 'build-liquibase-image', 'test-db',
    'gemnasium-dependency_scanning']) {
    assert.ok(selected(name, env), `Canonical feature pipeline is missing ${name}`);
    // The former external PR checks ran even for documentation-only changes.
    assert.equal(selectedRule(resolve(name).rules, env).changes, undefined, name);
    for (const dependency of resolve(name).needs || []) {
      if (dependency.optional) continue;
      const needed = typeof dependency === 'string' ? dependency : dependency.job;
      assert.ok(selected(needed, env), `${name} needs absent ${needed}`);
    }
  }
});

test('feature branches keep their complete pipeline before and after a PR is closed', () => {
  assert.equal(pipelineSelected(featurePush), true);
  // GitHub PRs do not populate the native GitLab MR variable.
  assert.equal(pipelineSelected({ ...featurePush, CI_OPEN_MERGE_REQUESTS: '' }), true);
});

for (const field of ['CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME',
  'CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_SHA', 'CI_EXTERNAL_PULL_REQUEST_SOURCE_REPOSITORY',
  'CI_EXTERNAL_PULL_REQUEST_TARGET_REPOSITORY', 'CI_COMMIT_SHA', 'CI_COMMIT_BRANCH']) {
  test(`incomplete PR metadata retains validation when ${field} is missing`, () => {
    for (const value of [undefined, '']) {
      const env = { ...githubDevelopPr, [field]: value };
      assert.equal(pipelineSelected(env), true);
      assert.equal(workflowRule(env).variables.DOCKER_HUB_PROXY, '');
    }
  });
}

for (const [label, values] of [
  ['foreign repository', { CI_EXTERNAL_PULL_REQUEST_SOURCE_REPOSITORY: 'other/coding-box' }],
  ['different source SHA', { CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_SHA: 'b'.repeat(40) }],
  ['different source branch', { CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME: 'other-feature' }],
  ['back-merge from main', { CI_COMMIT_BRANCH: 'main', CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME: 'main' }],
  ['develop source branch', { CI_COMMIT_BRANCH: 'develop', CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME: 'develop' }],
  ['main target', { CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME: 'main' }]
]) {
  test(`${label} keeps the external PR pipeline and its public-image fallback`, () => {
    const env = { ...githubDevelopPr, ...values };
    assert.equal(pipelineSelected(env), true);
    assert.equal(workflowRule(env).variables.DOCKER_HUB_PROXY, '');
    assert.equal(workflowRule(env).variables.DOCKER_IMAGE, 'docker:28');
  });
}
const scenarios = [
  ['GitHub develop PR fallback', { CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME: 'develop', CI_PIPELINE_SOURCE: 'external_pull_request_event' }],
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
    assert.ok(pipelineSelected(env), `${label}: pipeline is absent`);
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
  assert.equal(project.targets.test.executor, 'nx:run-commands');
  assert.equal(project.targets.test.configurations.ci.command,
    'node scripts/qa/run-backend-jest.mjs --configuration=ci');
  const launcher = readFileSync(new URL('./run-backend-jest.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /'--experimental-vm-modules'/);
  assert.match(launcher, /'backend:test-jest'/);
  const jest = project.targets['test-jest'];
  assert.equal(jest.executor, '@nx/jest:jest');
  assert.equal(jest.cache, false);
  assert.equal(jest.configurations.ci.codeCoverage, true);
  assert.equal(jest.configurations.ci.ci, true);
  assert.equal(jest.options.passWithNoTests, false);
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
