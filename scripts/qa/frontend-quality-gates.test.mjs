import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

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
      const result = await readInitialOptions(process.cwd() + '/apps/frontend/jest.zoneless.config.ts');
      assert.equal(result.config.displayName, 'frontend-zoneless');
    })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: workspace, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${first}: ${result.stdout}${result.stderr}`);
  }
});

test('CI selects coverage, rejects empty suites, and publishes reports as a required job', () => {
  const project = JSON.parse(readFileSync(join(workspace, 'apps/frontend/project.json'), 'utf8'));
  assert.equal(project.targets.test.configurations.ci.codeCoverage, true);
  assert.equal(project.targets.test.configurations.ci.ci, true);
  assert.equal(project.targets.test.options.passWithNoTests, false);
  assert.equal(project.targets.lint.options.maxWarnings, 0);
  const ci = readFileSync(join(workspace, '.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'), 'utf8');
  const job = ci.split('\ntest-frontend-zoneless:\n')[1].split('\ntest-zoneless-approval:\n')[0];
  assert.match(job, /allow_failure: false/);
  assert.match(job, /frontend:test --configuration=ci/);
  assert.match(job, /frontend:test-quality-gates/);
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
