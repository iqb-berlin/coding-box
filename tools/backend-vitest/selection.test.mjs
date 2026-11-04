import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { selectTestPaths } from './selection.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'backend-test-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['apps/backend/src/nest-esm.spec.ts', 'apps/backend/src/app.controller.spec.ts',
    'apps/backend/src/comma,a.test.ts', 'apps/backend/src/app.controller.ts', 'tools/backend-vitest/contracts/compat.spec.ts'];
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '');
  }
  return root;
}
const include = ['apps/backend/src/**/*.{spec,test}.ts', 'tools/backend-vitest/contracts/**/*.spec.ts'];

test('Jest path expressions retain escaped dots, alternation and anchors', t => {
  const root = fixture(t);
  assert.deepEqual(selectTestPaths(include, [String.raw`(nest-esm|app\.controller)\.spec\.ts$`], root),
    ['apps/backend/src/app.controller.spec.ts', 'apps/backend/src/nest-esm.spec.ts']);
  for (const pattern of [String.raw`NEST-ESM\.SPEC\.TS$`, String.raw`^src/nest-esm\.spec\.ts$`, String.raw`./src/nest-esm\.spec\.ts$`]) {
    assert.deepEqual(selectTestPaths(include, [pattern], root), ['apps/backend/src/nest-esm.spec.ts']);
  }
});

test('repeated expressions form a union without splitting commas inside an expression', t => {
  const root = fixture(t);
  assert.deepEqual(selectTestPaths(include, [String.raw`comma,a\.test\.ts$`, String.raw`compat\.spec\.ts$`], root),
    ['apps/backend/src/comma,a.test.ts', 'tools/backend-vitest/contracts/compat.spec.ts']);
});

test('path expressions cannot expand their scope and unmatched expressions select nothing', t => {
  const root = fixture(t);
  assert.deepEqual(selectTestPaths(['tools/backend-vitest/contracts/**/*.spec.ts'], ['nest-esm'], root), []);
  assert.deepEqual(selectTestPaths(include, ['does-not-exist'], root), []);
});
