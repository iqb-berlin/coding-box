import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { compareDiagnostics, requestContractBindingErrors } from './check-backend-strict.mjs';

const old = { file: 'legacy.ts', code: 18048, message: 'value is possibly undefined', count: 1 };

test('allows existing diagnostics and reductions', () => {
  assert.deepEqual(compareDiagnostics([old], [old]), []);
  assert.deepEqual(compareDiagnostics([], [old]), []);
});

test('rejects new diagnostics and additional occurrences of an existing diagnostic', () => {
  assert.deepEqual(compareDiagnostics([{ ...old, count: 2 }], [old]), [{ ...old, count: 2 }]);
  assert.equal(compareDiagnostics([{ ...old, file: 'new.ts' }], [old]).length, 1);
  assert.equal(compareDiagnostics([{ ...old, code: 7006 }], [old]).length, 1);
  assert.equal(compareDiagnostics([{ ...old, message: 'different error' }], [old]).length, 1);
});

test('rejects drift between the runtime contract and the declared input type', () => {
  const errors = source => requestContractBindingErrors(ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true));
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'WorkspaceFullDto'>) {} }").length, 0);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'UserFullDto'>) {} }").length, 1);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: any) {} }").length, 1);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto', true) body: RequestBody<'WorkspaceFullDto'> | undefined) {} }").length, 0);
  assert.equal(errors("class C { route(@ValidatedBody('WorkspaceFullDto') body: RequestBody<'WorkspaceFullDto'> | undefined) {} }").length, 1);
});
