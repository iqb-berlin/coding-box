import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertNoReferenceData, assertProductionCopyPolicy, referenceFingerprints, verifyReferencePackaging } from './verify-reference-packaging.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fingerprints = referenceFingerprints(root);
const temporary = callback => {
  const path = mkdtempSync(join(tmpdir(), 'reference-packaging-'));
  try { callback(path); } finally { rmSync(path, { recursive: true, force: true }); }
};
const dockerCopy = directory => {
  for (const project of ['backend', 'frontend']) {
    mkdirSync(join(directory, `apps/${project}`), { recursive: true });
    cpSync(join(root, `apps/${project}/Dockerfile`), join(directory, `apps/${project}/Dockerfile`));
  }
};

test('production stages copy only runtime inputs and inherit runtime images', () => {
  assertProductionCopyPolicy(root);
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /RUN node scripts\/qa\/verify-reference-packaging\.mjs/);
  assert.ok(dockerfile.indexOf('verify-reference-packaging.mjs') > dockerfile.indexOf('npx nx run-many --target=build'));
  assert.match(readFileSync(join(root, '.gitlab-ci/Branch&PreRelease-Pipelines.gitlab-ci.yml'), 'utf8'),
    /npx nx run backend:verify-reference-packaging --configuration=ci/);
});
test('normal application artifacts pass', () => temporary(directory => {
  writeFileSync(join(directory, 'main.js'), 'console.log("application");');
  assert.equal(assertNoReferenceData(directory, fingerprints), 1);
}));
test('a renamed copy of the reference CSV is rejected by content', () => temporary(directory => {
  cpSync(join(root, 'scripts/reference/coding-box/expected-matrix-keep-code.csv'), join(directory, 'renamed.bin'));
  assert.throws(() => assertNoReferenceData(directory, fingerprints), /Reference file copied/);
}));
test('reference data embedded in a compiled bundle is rejected', () => temporary(directory => {
  writeFileSync(join(directory, 'main.js'), 'const cases=[{"id":"study-P001-U1"}];');
  assert.throws(() => assertNoReferenceData(directory, fingerprints), /Reference data embedded/);
}));
test('fixture directories and symlinks cannot bypass the boundary', () => temporary(directory => {
  mkdirSync(join(directory, '__fixtures__'));
  writeFileSync(join(directory, '__fixtures__/data.json'), '{}');
  assert.throws(() => assertNoReferenceData(directory, fingerprints), /Test-only path/);
  rmSync(join(directory, '__fixtures__'), { recursive: true });
  symlinkSync(join(root, 'scripts/reference'), join(directory, 'linked-data'));
  assert.throws(() => assertNoReferenceData(directory, fingerprints), /Unexpected symlink/);
}));
test('copying the full builder into a runtime stage is rejected', () => temporary(directory => {
  dockerCopy(directory);
  const path = join(directory, 'apps/backend/Dockerfile');
  writeFileSync(path, readFileSync(path, 'utf8').replace('/usr/src/coding-box-base/dist/apps/${PROJECT} .', '/usr/src/coding-box-base .'));
  assert.throws(() => assertProductionCopyPolicy(directory), /Unexpected backend production COPY/);
}));
test('inheriting builder layers in the final image is rejected', () => temporary(directory => {
  dockerCopy(directory);
  const path = join(directory, 'apps/frontend/Dockerfile');
  writeFileSync(path, readFileSync(path, 'utf8').replace('FROM ${REGISTRY_PATH}nginxinc/nginx-unprivileged:stable AS prod', 'FROM base AS prod'));
  assert.throws(() => assertProductionCopyPolicy(directory), /runtime image/);
}));
test('a direct frontend reference COPY is rejected', () => temporary(directory => {
  dockerCopy(directory);
  const path = join(directory, 'apps/frontend/Dockerfile');
  writeFileSync(path, `${readFileSync(path, 'utf8')}\nCOPY scripts/reference /usr/share/nginx/html/reference\n`);
  assert.throws(() => assertProductionCopyPolicy(directory), /Unexpected frontend production COPY/);
}));
test('CI checks frontend-only builds; an absent backend is allowed only in CI mode', () => temporary(directory => {
  for (const name of ['dist/apps/frontend', 'scripts/reference', 'vendor']) mkdirSync(join(directory, name), { recursive: true });
  writeFileSync(join(directory, 'scripts/reference/data.csv'), 'synthetic,reference\n');
  writeFileSync(join(directory, 'vendor/package.json'), '{"name":"runtime"}');
  writeFileSync(join(directory, 'package.json'), '{"name":"application"}');
  writeFileSync(join(directory, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(directory, 'dist/apps/frontend/main.js'), 'console.log("application");');
  assert.deepEqual(verifyReferencePackaging(directory, false, true), { runtimeInputs: 3, frontend: 1 });
  assert.throws(() => verifyReferencePackaging(directory), /ENOENT/);
  rmSync(join(directory, 'dist/apps/frontend'), { recursive: true });
  assert.throws(() => verifyReferencePackaging(directory, false, true), /ENOENT/);
}));
