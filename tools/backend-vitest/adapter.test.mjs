import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { transpile } from './adapter.mjs';

const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false, esModuleInterop: false, sourceMap: true, inlineSources: true };
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(directory + '/' + entry.name) : [directory + '/' + entry.name]);

test('every application module receives unmodified TypeScript ESM/decorator emission', () => {
  const files = walk('apps/backend/src').filter(file => file.endsWith('.ts') && !/(?:\.d\.ts|\.(?:spec|test)\.ts|test\.factory\.ts)$/.test(file));
  assert.ok(files.length > 400);
  for (const filename of files) {
    const code = readFileSync(filename, 'utf8');
    const plain = ts.transpileModule(code, { fileName: filename, compilerOptions });
    assert.equal(transpile(code, filename).code, plain.outputText, filename);
  }
});

test('bad production imports and cyclic relation types are never repaired by the adapter', () => {
  const source = "import * as AdmZip from 'adm-zip'; import { CaseOrderingMode } from './types'; import { ManyToOne } from 'typeorm'; export class Entity { @ManyToOne(() => Entity) related: Entity; } export const mode = CaseOrderingMode; export const zip = new AdmZip();";
  const emitted = transpile(source, '/app/example.ts').code;
  assert.match(emitted, /import \* as AdmZip/);
  assert.match(emitted, /import \{ CaseOrderingMode \}/);
  assert.match(emitted, /__metadata\("design:type", Entity\)/);
  assert.doesNotMatch(emitted, /require\(|__PilotRelation/);
});
