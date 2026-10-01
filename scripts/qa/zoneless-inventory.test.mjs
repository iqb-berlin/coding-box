import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./zoneless-inventory.mjs', import.meta.url));

test('inventory rejects missing, changed and unreviewed coverage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zoneless-inventory-test-'));
  const matrix = path.join(directory, 'matrix.json');
  const run = (...args) => spawnSync(process.execPath, [script, '--matrix', matrix, ...args], { encoding: 'utf8' });
  try {
    assert.equal(run('--update').status, 0);
    assert.equal(run().status, 0);
    const original = fs.readFileSync(matrix, 'utf8');
    const missing = JSON.parse(original);
    missing.entries.pop();
    fs.writeFileSync(matrix, JSON.stringify(missing));
    const missingCheck = run();
    assert.equal(missingCheck.status, 1);
    assert.match(missingCheck.stderr, /new\/changed entries/);
    const changed = JSON.parse(original);
    changed.entries[0].fingerprint = 'outdated';
    fs.writeFileSync(matrix, JSON.stringify(changed));
    assert.equal(run().status, 1);
    fs.writeFileSync(matrix, original);
    const incomplete = run('--require-complete');
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /no zoneless approval/);
    const bypass = JSON.parse(original);
    bypass.scenarios = [];
    for (const entry of bypass.entries) {
      entry.review = {
        status: 'passed', caller: 'test', roles: ['test'],
        tests: ['apps/frontend/src/app/zoneless-dialog-responses.spec.ts'],
        evidence: ['test'], scenarios: {}
      };
    }
    fs.writeFileSync(matrix, JSON.stringify(bypass));
    assert.equal(run('--require-complete').status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
