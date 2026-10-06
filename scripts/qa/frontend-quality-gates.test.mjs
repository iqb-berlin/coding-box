import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workspace = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const { ESLint } = require('eslint');
const eslint = new ESLint({ cwd: workspace });
const templatePath = 'apps/frontend/src/app/components/home/home.component.html';
const componentPath = 'apps/frontend/src/app/components/home/home.component.ts';

test('external Angular templates report invalid syntax', async () => {
  const [result] = await eslint.lintText('<div>{{ ??? }}</div>', { filePath: templatePath });
  assert.ok(result.messages.some(message => message.fatal), JSON.stringify(result.messages));
});

test('external and inline templates enforce keyboard accessibility', async () => {
  const template = '<div (click)="save()">Save</div>';
  const source = `import { Component } from '@angular/core';
    @Component({ selector: 'coding-box-probe', template: \`${template}\` })
    export class ProbeComponent { save(): void {} }`;
  for (const [code, filePath] of [[template, templatePath], [source, componentPath]]) {
    const [result] = await eslint.lintText(code, { filePath });
    assert.ok(result.messages.some(message => message.ruleId ===
      '@angular-eslint/template/click-events-have-key-events'), JSON.stringify(result.messages));
  }
});

test('native buttons pass template accessibility rules', async () => {
  const [result] = await eslint.lintText('<button type="button" (click)="save()">Save</button>', {
    filePath: templatePath
  });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});

test('Jest configurations load through ts-node regardless of configuration order', () => {
  const env = { ...process.env };
  delete env.TS_NODE_COMPILER_OPTIONS;
  for (const first of ['apps/frontend/jest.config.ts', 'apps/backend/jest.config.ts', 'jest.config.ts']) {
    const result = spawnSync(process.execPath, ['--no-experimental-strip-types', '-e', `
    const assert = require('node:assert/strict');
    const { readInitialOptions } = require('jest-config');
    (async () => {
      await readInitialOptions(process.cwd() + '/' + ${JSON.stringify(first)});
      const result = await readInitialOptions(process.cwd() + '/apps/frontend/jest.config.ts');
      assert.equal(result.config.displayName, 'frontend');
    })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: workspace, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${first}: ${result.stdout}${result.stderr}`);
  }
});

test('frontend tests cannot reintroduce Zone.js or its timer helpers', () => {
  const filesUnder = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
  const files = filesUnder(join(workspace, 'apps/frontend/src')).filter(path =>
    path.endsWith('.spec.ts') || path.endsWith('/test-setup.ts'));
  assert.ok(files.length > 0);
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /(?:import|require)[^;]*(?:zone\.js|setup-env\/zone['"])/, path);
    assert.doesNotMatch(source, /\bfakeAsync\s*\(/, path);
  }
  const manifest = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies?.['zone.js'], undefined);
  assert.equal(manifest.devDependencies?.['zone.js'], undefined);
  for (const path of filesUnder(join(workspace, 'cypress')).filter(file => file.endsWith('.cy.ts'))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /import\s+['"][^'"]+\.cy['"]/, path);
  }
  const componentSetup = readFileSync(join(workspace, 'cypress/support/component.ts'), 'utf8');
  assert.match(componentSetup, /from 'cypress\/angular-zoneless'/);
  assert.doesNotMatch(componentSetup, /from 'cypress\/angular'/);
});

test('both browser targets reject a discovered spec that executes zero tests', () => {
  const ts = require('typescript');
  const source = readFileSync(join(workspace, 'cypress.config.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require });
  for (const type of ['component', 'e2e']) {
    const hooks = new Map();
    exports.default[type].setupNodeEvents((event, callback) => hooks.set(event, callback), {});
    const afterSpec = hooks.get('after:spec');
    assert.equal(typeof afterSpec, 'function');
    const spec = { relative: 'cypress/component/fixture.cy.ts' };
    assert.throws(() => afterSpec(spec, { stats: { tests: 0 } }), /did not execute any tests/);
    assert.doesNotThrow(() => afterSpec(spec, { stats: { tests: 1 } }));
    assert.doesNotThrow(() => afterSpec(spec, undefined));
  }
});

test('CI selects coverage, rejects empty suites, and publishes reports as a required job', () => {
  const project = JSON.parse(readFileSync(join(workspace, 'apps/frontend/project.json'), 'utf8'));
  assert.equal(project.targets.test.configurations.ci.codeCoverage, true);
  assert.equal(project.targets.test.configurations.ci.ci, true);
  assert.equal(project.targets.test.options.passWithNoTests, false);
  assert.equal(project.targets.lint.options.maxWarnings, 0);
  const ci = readFileSync(join(workspace, '.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'), 'utf8');
  const job = ci.split('\ntest-frontend:\n')[1].split('\ntest-browser:\n')[0];
  assert.match(job, /allow_failure: false/);
  assert.match(job, /frontend:test --configuration=ci/);
  assert.match(job, /frontend:test-quality-gates/);
  assert.match(job, /frontend:zoneless-approval/);
  assert.match(job, /frontend:zoneless-inventory-test/);
  assert.doesNotMatch(job, /frontend:lint|nx build frontend|frontend:test-zoneless/);
  assert.doesNotMatch(ci, /\ntest-(?:frontend-zoneless|zoneless-approval|browser-zoneless|browser-production):/);
  const backend = ci.split('\ntest-backend:\n')[1].split('\ntest-frontend:\n')[0];
  assert.match(backend, /--target=test --exclude=frontend/);
  assert.match(backend, /allow_failure: false/);
  const browser = ci.split('\ntest-browser:\n')[1].split('\ntest-replay-live:\n')[0];
  assert.match(browser, /- build-app/);
  assert.match(browser, /frontend:e2e --configuration=ci/);
  assert.match(browser, /frontend:component-test --browser=electron/);
  assert.equal(project.targets['component-test'].options.testingType, 'component');
  assert.equal(project.targets['component-test'].options.skipServe, true);
  assert.ok(project.targets['component-test'].inputs.includes('frontendE2e'));
  assert.equal(project.targets.e2e.configurations.ci.devServerTarget, 'frontend:serve-static');
  assert.equal(project.targets['serve-static'].options.staticFilePath, 'dist/apps/frontend');
  assert.equal(project.targets['serve-static'].options.watch, false);
  assert.equal(project.targets['serve-static'].options.buildTarget, undefined);
  assert.equal(project.targets['test-zoneless'], undefined);
  const setup = readFileSync(join(workspace, 'apps/frontend/src/test-setup.ts'), 'utf8');
  assert.match(setup, /setupZonelessTestEnv/);
  assert.doesNotMatch(setup, /setupZoneTestEnv/);
  assert.match(job, /coverage_format: cobertura/);
  assert.match(job, /coverage\/apps\/frontend\/junit.xml/);
  const expression = job.match(/coverage: '\/(.+)\/'/)?.[1];
  assert.ok(expression, 'CI must extract the coverage percentage');
  const coloredSummary = '\x1b[32;1mStatements   : 81.87% ( 76002/92828 )\x1b[0m';
  assert.equal(coloredSummary.match(new RegExp(expression))?.[1], '81.87');
  const release = readFileSync(join(workspace, '.gitlab-ci/Release-Pipelines.gitlab-ci.yml'), 'utf8');
  const mainTests = release.split('\ntest-main-pr-frontend:\n')[1].split('\nlint-main-pr-backend:\n')[0];
  const mainLint = release.split('\nlint-main-pr-frontend:\n')[1].split('\naudit-main-pr-backend:\n')[0];
  assert.match(mainTests, /allow_failure: false/);
  assert.match(mainTests, /test frontend --configuration=ci/);
  assert.match(mainTests, /frontend:test-quality-gates/);
  assert.match(mainTests, /docker cp .*coverage\/apps\/frontend/);
  assert.match(mainTests, /coverage_format: cobertura/);
  assert.match(mainLint, /allow_failure: false/);
});

test('the actual coverage thresholds reject passing tests with uncovered code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-coverage-gate-'));
  try {
    const presetPath = join(workspace, 'jest.preset.js');
    const coverage = require(presetPath).coverageThreshold.global;
    for (const metric of ['branches', 'functions', 'lines', 'statements']) {
      assert.equal(coverage[metric], 60);
    }
    writeFileSync(join(directory, 'subject.cjs'), `
      exports.used = () => 'used';
      exports.first = () => {
        const result = 'first';
        return result;
      };
      exports.second = () => {
        const result = 'second';
        return result;
      };
      exports.third = () => {
        const result = 'third';
        return result;
      };
    `);
    writeFileSync(join(directory, 'jest.config.cjs'), `module.exports = {
      ...require(${JSON.stringify(presetPath)}),
      rootDir: ${JSON.stringify(directory)},
      resolver: ${JSON.stringify(require.resolve('@nx/jest/plugins/resolver'))},
      testEnvironment: 'node',
      transform: {},
      testMatch: ['<rootDir>/fixture.test.cjs'],
      collectCoverage: true,
      collectCoverageFrom: ['subject.cjs'],
      coverageDirectory: '<rootDir>/coverage',
      coverageReporters: ['text-summary', 'cobertura']
    };`);
    const run = () => spawnSync(process.execPath, [require.resolve('jest/bin/jest'),
      '--config', join(directory, 'jest.config.cjs'), '--runInBand'], {
      cwd: workspace, encoding: 'utf8', timeout: 30000
    });
    writeFileSync(join(directory, 'fixture.test.cjs'), `
      const subject = require('./subject.cjs');
      test('covers every function', () => {
        expect(subject.used()).toBe('used');
        expect(subject.first()).toBe('first');
        expect(subject.second()).toBe('second');
        expect(subject.third()).toBe('third');
      });
    `);
    const covered = run();
    assert.ifError(covered.error);
    assert.equal(covered.status, 0, covered.stdout + covered.stderr);
    assert.match(readFileSync(join(directory, 'coverage/cobertura-coverage.xml'), 'utf8'), /<coverage/);

    writeFileSync(join(directory, 'fixture.test.cjs'), `
      const subject = require('./subject.cjs');
      test('passes while leaving most functions uncovered', () => {
        expect(subject.used()).toBe('used');
      });
    `);
    const uncovered = run();
    assert.ifError(uncovered.error);
    assert.equal(uncovered.status, 1, uncovered.stdout + uncovered.stderr);
    assert.match(uncovered.stderr, /does not meet "global" threshold/);
    assert.match(uncovered.stderr, /Tests:.*1 passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
