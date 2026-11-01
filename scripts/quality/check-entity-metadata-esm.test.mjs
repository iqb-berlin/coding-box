import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { verifyEntityMetadata } from './check-entity-metadata-esm.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = {
  module: ts.ModuleKind.Node20, moduleResolution: ts.ModuleResolutionKind.Node16,
  target: ts.ScriptTarget.ES2021, experimentalDecorators: true, emitDecoratorMetadata: true,
  strict: true, strictPropertyInitialization: false, skipLibCheck: true, types: ['node']
};

function fixture(relationType, run, columnOptions = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'entity-metadata-fixture-'));
  try {
    symlinkSync(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}');
    writeFileSync(path.join(root, 'booklet.entity.ts'), `
      import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
      import { BookletLog } from './bookletLog.entity';
      @Entity('fixture_booklet')
      export class Booklet {
        @PrimaryGeneratedColumn() id: number;
        @Column(${columnOptions}) title: string;
        @OneToMany(() => BookletLog, log => log.booklet) logs: BookletLog[];
      }
    `);
    writeFileSync(path.join(root, 'bookletLog.entity.ts'), `
      import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
      import type { Relation } from 'typeorm';
      import { Booklet } from './booklet.entity';
      @Entity('fixture_booklet_log')
      export class BookletLog {
        @PrimaryGeneratedColumn() id: number;
        @ManyToOne(() => Booklet, booklet => booklet.logs, { onDelete: 'CASCADE', nullable: false })
        @JoinColumn({ name: 'booklet_id' }) booklet: ${relationType};
      }
    `);
    return run({ root, options, files: ['booklet.entity.ts', 'bookletLog.entity.ts'].map(file => path.join(root, file)) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('detects a native ESM metadata cycle that CommonJS accepts', () => {
  fixture('Booklet', input => assert.throws(() => verifyEntityMetadata(input),
    error => /Cannot access 'Booklet' before initialization/.test(error.stderr?.toString())));
});

test('Relation preserves inferred PostgreSQL columns, inverse relations and cascading foreign keys in ESM', () => {
  const metadata = fixture('Relation<Booklet>', verifyEntityMetadata);
  assert.equal(metadata.length, 2);
  const booklet = metadata.find(entity => entity.name === 'Booklet');
  const log = metadata.find(entity => entity.name === 'BookletLog');
  assert.equal(booklet.table.columns.find(column => column.name === 'title').type, 'character varying');
  assert.equal(booklet.table.columns.find(column => column.name === 'id').isPrimary, true);
  assert.equal(log.table.foreignKeys[0].onDelete, 'CASCADE');
  assert.deepEqual(log.table.foreignKeys[0].columnNames, ['booklet_id']);
  assert.equal(log.relations[0].target, 'fixture_booklet');
  assert.equal(log.relations[0].inverse, 'logs');
  assert.equal(log.relations[0].nullable, false);
});

test('rejects a column contract that differs between the native ESM and CommonJS loaders', () => {
  fixture('Relation<Booklet>', input => assert.throws(() => verifyEntityMetadata(input),
    /Native ESM and CommonJS PostgreSQL metadata must match/),
  "{ type: typeof require === 'undefined' ? 'integer' : 'varchar' }");
});
