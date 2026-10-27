import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requestContractBindingErrors, verifyDiagnostics } from './check-backend-strict.mjs';

test('requires zero diagnostics, including errors formerly accepted by a legacy baseline', () => {
  assert.doesNotThrow(() => verifyDiagnostics([]));
  assert.throws(() => verifyDiagnostics([
    { file: 'legacy.ts', code: 18048, message: 'value is possibly undefined', count: 1 }
  ]), /no legacy baseline/);
});

test('the production compiler configuration enables strict checking', () => {
  const config = JSON.parse(readFileSync(new URL('../../apps/backend/tsconfig.app.json', import.meta.url), 'utf8'));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.strictPropertyInitialization, false);
});

test('rejects drift between the runtime contract and the declared input type', () => {
  const errors = source => requestContractBindingErrors(ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true));
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'WorkspaceFullDto'>) {} }").length, 0);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'UserFullDto'>) {} }").length, 1);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: any) {} }").length, 1);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto', true) body: RequestBody<'WorkspaceFullDto'> | undefined) {} }").length, 0);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'WorkspaceFullDto'> | undefined) {} }").length, 1);
});

function contractErrors(files) {
  const options = { noLib: true, experimentalDecorators: true, module: ts.ModuleKind.CommonJS };
  const sources = new Map(Object.entries(files).map(([name, text]) => [name, ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)]));
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => sources.get(name);
  host.fileExists = name => sources.has(name);
  host.readFile = name => sources.get(name)?.text;
  host.getCurrentDirectory = () => '/';
  host.resolveModuleNames = names => names.map(name => ({ resolvedFileName: '/' + name.replace('./', '') + '.ts' }));
  const program = ts.createProgram([...sources.keys()], options, host);
  return requestContractBindingErrors(program.getSourceFile('/controller.ts'), program.getTypeChecker());
}

test('resolves local, imported and generic request aliases without hiding schema mismatches', () => {
  const definitions = `export type RequestBody<Name> = { value: Name }; export type Imported = RequestBody<'A'>;`;
  for (const [type, count] of [['Local', 0], ['Imported', 0], ["Generic<'A'>", 0], ["Generic<'B'>", 1], ['any', 1]]) {
    const errors = contractErrors({
      '/contracts.ts': definitions,
      '/controller.ts': `import { RequestBody, Imported } from './contracts';
        type Local = RequestBody<'A'>; type Generic<Name> = RequestBody<Name>;
        class C { route(@ValidatedBody('A') body: ${type}) {} }`
    });
    assert.equal(errors.length, count, type);
  }
});

test('detects a mismatch through a renamed RequestBody import', () => {
  for (const [name, count] of [['A', 0], ['B', 1]]) {
    assert.equal(contractErrors({
      '/contracts.ts': 'export type RequestBody<Name> = { value: Name };',
      '/controller.ts': `import { RequestBody as Input } from './contracts'; class C { route(@ValidatedBody('A') body: Input<'${name}'>) {} }`
    }).length, count);
  }
});

test('both existing backend unit gates execute strict checking before publishing can proceed', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const schema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('!reference', { kind: 'sequence', construct: data => data })
  ]);
  const read = file => yaml.load(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { schema });
  const branch = read('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml')['test-backend'];
  const release = read('.gitlab-ci/Release-Pipelines.gitlab-ci.yml')['test-main-pr-backend'];
  for (const job of [branch, release]) {
    assert.equal(job.allow_failure, false);
    assert.ok(job.script.some(command => command.includes('run backend:typecheck')));
  }
});

test('replay and real-auth fixtures provide explicit current OIDC verification endpoints', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const base = yaml.load(readFileSync(new URL('../e2e/replay/docker-compose.replay.yml', import.meta.url), 'utf8'));
  for (const file of ['docker-compose.replay.yml', 'docker-compose.auth.yml']) {
    const config = yaml.load(readFileSync(new URL('../e2e/replay/' + file, import.meta.url), 'utf8'));
    const env = { ...base.services.backend.environment, ...config.services.backend.environment };
    for (const key of ['OAUTH2_CLIENT_ID', 'OIDC_ISSUER', 'OIDC_JWKS_URI']) assert.ok(env[key], file + ': ' + key);
  }
});

test('both backend CI gates exercise BullMQ against Redis without making failures optional', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const schema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('!reference', { kind: 'sequence', construct: data => data })
  ]);
  const read = file => yaml.load(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { schema });
  const branch = read('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml')['test-backend'];
  const release = read('.gitlab-ci/Release-Pipelines.gitlab-ci.yml')['test-main-pr-backend'];
  assert.equal(branch.allow_failure, false);
  assert.equal(release.allow_failure, false);
  assert.ok(branch.services.some(service => service.alias === 'bullmq-redis' && service.name.includes('redis:7.4')));
  assert.equal(branch.variables.BULLMQ_TEST_REDIS_HOST, 'bullmq-redis');
  assert.equal(branch.variables.BULLMQ_TEST_REDIS_PORT, '6379');
  assert.ok(release.script.some(command => command.includes('redis:7.4') && command.includes('--network-alias bullmq-redis')));
  const tests = release.script.find(command => command.includes('test backend --configuration=ci'));
  assert.ok(tests.includes('--env BULLMQ_TEST_REDIS_HOST=bullmq-redis'));
  assert.ok(tests.includes('--env BULLMQ_TEST_REDIS_PORT=6379'));
});

test('the mandatory integration gate is uncached and gates backend images on every quality-gate pipeline', () => {
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('!reference', { kind: 'sequence', construct: data => data })]);
  const read = file => yaml.load(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), { schema });
  const branch = read('.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml');
  const release = read('.gitlab-ci/Release-Pipelines.gitlab-ci.yml');
  const gate = branch['test-backend-integration'];
  assert.equal(gate.allow_failure, false);
  assert.deepEqual(gate.rules, branch['test-backend'].rules);
  assert.ok(gate.services.some(service => service.alias === 'integration-postgres'));
  assert.ok(gate.services.some(service => service.alias === 'integration-redis'));
  assert.ok(gate.variables.BACKEND_INTEGRATION_TEST_DATABASE_URL);
  assert.ok(gate.script.includes('npx nx run backend:test-integration'));
  for (const configuration of [branch, release]) {
    for (const [name, job] of Object.entries(configuration)) {
      if (!Array.isArray(job.needs) || !job.needs.some(need => need.job === 'test-backend')) continue;
      assert.ok(job.needs.some(need => need.job === 'test-backend-integration' && !need.optional), name);
    }
  }
  const project = JSON.parse(readFileSync(new URL('../../apps/backend/project.json', import.meta.url), 'utf8'));
  assert.equal(project.targets['test-integration'].cache, false);
  for (const variable of ['POSTGRES_INTEGRATION_TESTS', 'WORKSPACE_DELETION_TEST_DATABASE_URL', 'POSTGRES_DB', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PREFIX']) {
    assert.ok(project.targets.test.inputs.some(input => input.env === variable));
  }
});
