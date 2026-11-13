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
  'test-auth-live', 'test-workflows-live', 'test-e2e-report'];
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

test('Cypress jobs publish JUnit on failure and join live evidence before publication', () => {
  for (const [name, suites] of [
    ['test-browser', 'component,browser'], ['test-replay-live', 'replay-live'],
    ['test-auth-live', 'auth-live'], ['test-workflows-live', 'workflows-live']
  ]) {
    const job = resolve(name);
    assert.equal(job.artifacts.when, 'always');
    assert.equal(job.artifacts.reports.junit, 'coverage/cypress/*/junit.xml');
    assert.ok(job.artifacts.paths.includes('coverage/cypress/'));
    assert.ok(job.after_script.includes(`npx nx run frontend:e2e-report --suites=${suites}`));
  }
  const aggregate = resolve('test-e2e-report');
  assert.ok(resolve('test-browser').script.includes('npx nx run frontend:e2e-report --suites=component,browser'));
  assert.equal(aggregate.when, 'always');
  assert.equal(aggregate.allow_failure, false);
  for (const live of ['test-replay-live', 'test-auth-live', 'test-workflows-live']) {
    assert.ok(aggregate.needs.some(dependency => dependency.job === live && dependency.artifacts !== false));
  }
  assert.ok(aggregate.script.includes('npx nx run frontend:e2e-report --suites=auth-live,replay-live,workflows-live'));
});

test('a same-repository GitHub develop PR selects exactly one complete pipeline', () => {
  assert.equal(pipelineSelected(githubDevelopPr), false);
  assert.equal(pipelineSelected(featurePush), true);
  const env = { ...config.variables, ...featurePush };
  for (const name of [...gates, 'install-dependencies', 'build-app', 'test-browser', 'test-backend-container',
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

test('feature builds do not require an image published by an earlier pipeline', () => {
  const job = resolve('build-app');
  assert.equal(job.image, '${DOCKER_HUB_PROXY}${BASE_IMAGE}');
  assert.ok(job.before_script.some(command => command.includes('apt-get install') && command.includes(' git')));
});

test('feature pipelines retain the shared Dependency Proxy for job and service images', () => {
  const prefix = 'registry.example/iqb/dependency_proxy/containers/';
  for (const source of ['push', 'web', 'schedule']) {
    const feature = { ...featurePush, CI_PIPELINE_SOURCE: source };
    assert.equal(workflowRule(feature).variables, undefined, source);
    const env = { ...config.variables, ...feature,
      CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX: prefix.slice(0, -1) };
    const expand = value => value.replace(/\$\{(\w+)\}/g, (_, name) => expand(env[name] || ''));
    assert.equal(expand(env.DOCKER_HUB_PROXY), prefix);
    assert.equal(expand(env.DOCKER_IMAGE), `${prefix}docker:28`);
    assert.equal(expand(env.DOCKER_SERVICE), `${prefix}docker:28-dind`);
    assert.equal(expand(env.TRAEFIK_BASE_IMAGE), `${prefix}traefik:v2.11`);
    assert.equal(expand(env.TRIVY_IMAGE), `${prefix}aquasec/trivy:latest`);
    for (const name of ['build-app', 'install-dependencies', 'test-backend',
      'test-backend-integration', 'test-backend-container', 'test-replay-live',
      'test-auth-live', 'test-workflows-live', 'lint-app', 'audit-app']) {
      const job = resolve(name);
      assert.ok(selected(name, env), name);
      // Cypress browser images already use Docker Hub directly; their DinD
      // services must still use the group's shared proxy.
      const image = job.image || config.image;
      const proxiedImages = [
        ...(image === '${CYPRESS_IMAGE}' ? [] : [image]),
        ...(job.services || []).map(service => service.name || service)
      ];
      for (const reference of proxiedImages) {
        const expanded = expand(typeof reference === 'string' ? reference : reference.name);
        assert.ok(expanded.startsWith(prefix), `${source}: ${name} bypasses the shared proxy`);
      }
    }
  }
});

test('proxy-dependent build and verification jobs retry runner failures only once', () => {
  for (const name of ['install-dependencies', 'build-cicd-base-image', 'build-db-image',
    'build-liquibase-image', 'build-app', 'test-backend-container', 'test-db',
    'test-backend', 'test-backend-integration', 'test-frontend',
    'test-replay-live', 'test-auth-live', 'test-workflows-live', 'lint-app', 'audit-app']) {
    assert.deepEqual(resolve(name).retry, { max: 1, when: 'runner_system_failure' }, name);
  }
  assert.equal(config.default?.retry, undefined);
  assert.equal(resolve('test-browser').retry, undefined);
  for (const name of publishers) {
    assert.equal(resolve(name).retry, undefined, `${name}: publication must not inherit verification retries`);
  }
});

test('develop, main and tag pipelines retain their existing registry configuration', () => {
  for (const values of [
    { CI_COMMIT_BRANCH: 'develop' },
    { CI_COMMIT_BRANCH: 'main' },
    { CI_COMMIT_BRANCH: '', CI_COMMIT_TAG: '2.0.0-rc.1' },
    { CI_COMMIT_BRANCH: '', CI_COMMIT_TAG: '2.0.0' }
  ]) {
    const env = { ...featurePush, ...values };
    assert.ok(pipelineSelected(env));
    assert.equal(workflowRule(env).variables, undefined);
  }
});

test('all live browser jobs install a Docker client and bound daemon readiness', () => {
  for (const name of ['test-replay-live', 'test-auth-live', 'test-workflows-live']) {
    const setup = resolve(name).before_script.join('\n');
    assert.match(setup, /apt-get install[^\n]* docker-cli docker-buildx docker-compose/);
    assert.match(setup, /docker --version/);
    assert.match(setup, /timeout 120 sh -c 'until docker info;/);
    assert.doesNotMatch(setup, /until docker info > \/dev\/null/);
  }
});

test('all live browser jobs use the same pipeline builds and retain independent test gates', () => {
  const producer = resolve('build-app');
  for (const project of ['frontend', 'backend']) {
    assert.ok(producer.script.some(command => command.startsWith(`npx nx build ${project}`)));
    assert.ok(producer.artifacts.paths.includes(`dist/apps/${project}/`));
  }
  for (const [label, env] of scenarios) {
    for (const name of ['test-replay-live', 'test-auth-live', 'test-workflows-live']) {
      assert.ok(selected('build-app', { ...config.variables, ...env }), label);
      const job = resolve(name);
      assert.equal(job.allow_failure, false);
      assert.equal(job.variables.REPLAY_E2E_PREBUILT, 'true');
      assert.ok(job.needs.includes('build-app'));
      assert.ok(job.needs.includes('install-dependencies'));
    }
  }
});

test('the feature pipeline builds and probes the Linux production image without publishing it', () => {
  const job = resolve('test-backend-container');
  assert.equal(job.allow_failure, false);
  const script = job.script.join('\n');
  assert.match(script, /docker build[^\n]*--target builder/);
  assert.match(script, /docker build[^\n]*--file apps\/backend\/Dockerfile --target prod/);
  assert.match(script, /--platform linux\/amd64/);
  assert.match(script, /require\('libxmljs2'\)/);
  assert.match(script, /require\('sqlite3'\)/);
  assert.match(script, /JWT_SECRET must be a non-empty string/);
  assert.doesNotMatch(script, /docker push/);
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
