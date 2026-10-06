import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  symlinkSync, utimesSync, writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { hashFrontendArtifact } from './hash-frontend-artifact.mjs';

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

test('image builds authenticate with the Dependency Proxy only when it is used', () => {
  const yaml = require('js-yaml');
  const schema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('!reference', { kind: 'sequence', construct: data => data })
  ]);
  const config = yaml.load(readFileSync(join(workspace,
    '.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'), 'utf8'), { schema });
  const logins = Object.values(config).flatMap(job => job?.before_script || [])
    .filter(command => typeof command === 'string' &&
      command.includes('docker login') && command.includes('CI_DEPENDENCY_PROXY_SERVER'));
  assert.ok(logins.length > 0);
  for (const command of logins) {
    for (const proxy of ['', 'proxy.example/containers/']) {
      const result = spawnSync('sh', ['-eu', '-c',
        `docker() { printf '%s\\n' "$*"; }\n${command}`], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          DOCKER_HUB_PROXY: proxy,
          ...(proxy ? {
            CI_DEPENDENCY_PROXY_USER: 'probe-user',
            CI_DEPENDENCY_PROXY_PASSWORD: 'probe-password',
            CI_DEPENDENCY_PROXY_SERVER: 'proxy.example'
          } : {})
        }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, proxy ? 'login -u probe-user -p probe-password proxy.example\n' : '');
    }
  }
});

test('the actual lint job checks earlier commits and rejects frontend failures', () => {
  const yaml = require('js-yaml');
  const schema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('!reference', { kind: 'sequence', construct: data => data })
  ]);
  const config = yaml.load(readFileSync(join(workspace,
    '.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'), 'utf8'), { schema });
  assert.equal(config['lint-app'].allow_failure, false);
  const directory = mkdtempSync(join(tmpdir(), 'lint-commit-gate-'));
  const env = {
    ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_TUI: 'false',
    NX_WORKSPACE_ROOT_PATH: directory, NX_CACHE_DIRECTORY: join(directory, '.nx/cache')
  };
  const run = (command, args) => spawnSync(command, args, {
    cwd: directory, env, encoding: 'utf8', timeout: 30000
  });
  const succeed = (command, args) => {
    const result = run(command, args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result;
  };
  try {
    symlinkSync(join(workspace, 'node_modules'), join(directory, 'node_modules'), 'junction');
    writeFileSync(join(directory, 'package.json'), '{"name":"lint-gate-fixture","private":true}');
    writeFileSync(join(directory, 'nx.json'), '{"plugins":[],"targetDefaults":{"lint":{"cache":false}}}');
    writeFileSync(join(directory, '.gitignore'), 'node_modules/\n.nx/\n*.linted\nfail-frontend\n');
    writeFileSync(join(directory, 'lint.cjs'), `
      const fs = require('node:fs');
      const project = process.argv[2];
      fs.writeFileSync(project + '.linted', 'checked');
      if (project === 'frontend' && fs.existsSync('fail-frontend')) process.exitCode = 1;
    `);
    for (const project of ['frontend', 'backend']) {
      const root = join(directory, 'apps', project);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'project.json'), JSON.stringify({
        name: project,
        targets: { lint: { executor: 'nx:run-commands', options: {
          command: `node lint.cjs ${project}`
        } } }
      }));
      writeFileSync(join(root, 'source.ts'), 'export const value = 1;\n');
    }
    succeed('git', ['init', '-b', 'lint-fixture']);
    const commit = message => {
      succeed('git', ['add', '.']);
      succeed('git', ['-c', 'user.name=Quality Gate', '-c', 'user.email=qa@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', message]);
    };
    commit('initial projects');
    writeFileSync(join(directory, 'apps/frontend/source.ts'), 'export const value = 2;\n');
    commit('change frontend');
    writeFileSync(join(directory, 'README.md'), 'Documentation only.\n');
    commit('update documentation');
    const affected = succeed('npx', ['nx', 'show', 'projects', '--affected', '--base=HEAD~1',
      '--withTarget=lint', '--json']);
    assert.deepEqual(JSON.parse(affected.stdout), []);

    const script = config['lint-app'].script.join('\n');
    succeed('sh', ['-eu', '-c', script]);
    for (const project of ['frontend', 'backend']) {
      assert.equal(readFileSync(join(directory, `${project}.linted`), 'utf8'), 'checked');
    }
    writeFileSync(join(directory, 'fail-frontend'), 'fail');
    const failed = run('sh', ['-eu', '-c', script]);
    assert.ifError(failed.error);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout + failed.stderr, /frontend:lint/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('artifact fingerprints follow served bytes and paths, not timestamps or directory order', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontend-artifact-gate-'));
  const artifact = join(directory, 'dist');
  try {
    const missing = await hashFrontendArtifact(artifact);
    mkdirSync(join(artifact, 'assets'), { recursive: true });
    assert.notEqual(await hashFrontendArtifact(artifact), missing);
    writeFileSync(join(artifact, 'index.html'), '<app-root></app-root>');
    const asset = join(artifact, 'assets', 'de.json');
    const original = '{"title":"Coding Box"}';
    writeFileSync(asset, original);
    const baseline = await hashFrontendArtifact(artifact);
    writeFileSync(asset, '{"title":"Broken"}');
    assert.notEqual(await hashFrontendArtifact(artifact), baseline);
    writeFileSync(asset, original);
    utimesSync(asset, 1, 1);
    assert.equal(await hashFrontendArtifact(artifact), baseline);
    const renamed = join(artifact, 'assets', 'en.json');
    renameSync(asset, renamed);
    assert.notEqual(await hashFrontendArtifact(artifact), baseline);
    renameSync(renamed, asset);
    writeFileSync(renamed, original);
    assert.notEqual(await hashFrontendArtifact(artifact), baseline);
    rmSync(renamed);
    rmSync(asset);
    assert.notEqual(await hashFrontendArtifact(artifact), baseline);
    // Recreate the same bytes in a different creation order.
    rmSync(join(artifact, 'index.html'));
    writeFileSync(asset, original);
    writeFileSync(join(artifact, 'index.html'), '<app-root></app-root>');
    assert.equal(await hashFrontendArtifact(artifact), baseline);
    const cli = spawnSync(process.execPath, [join(workspace,
      'scripts/qa/hash-frontend-artifact.mjs'), artifact], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, `${baseline}\n`);
    symlinkSync(asset, renamed);
    await assert.rejects(hashFrontendArtifact(artifact), /Unsupported artifact entry/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
  assert.ok(project.targets.e2e.inputs.includes('frontendE2e'));
  assert.ok(project.targets.e2e.inputs.includes('{workspaceRoot}/scripts/qa/hash-frontend-artifact.mjs'));
  assert.ok(project.targets.e2e.inputs.some(input =>
    input.runtime === 'node scripts/qa/hash-frontend-artifact.mjs'));
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
