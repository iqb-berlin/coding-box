import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareProofDirectory } from './proof-directory.mjs';

test('default proof directories are private and unique', async () => {
  const directory = await prepareProofDirectory();
  const other = await prepareProofDirectory();
  try {
    assert.notEqual(directory, other);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await writeFile(path.join(directory, 'report.json'), '{"passed":true}');
    assert.equal(await readFile(path.join(directory, 'report.json'), 'utf8'), '{"passed":true}');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test('an explicit operator-owned output directory retains the existing reuse behavior', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'proof-directory-test-'));
  try {
    const output = path.join(directory, 'evidence');
    assert.equal(await prepareProofDirectory(output), output);
    await writeFile(path.join(output, 'retained'), 'previous run');
    assert.equal(await prepareProofDirectory(output), output);
    assert.equal(await readFile(path.join(output, 'retained'), 'utf8'), 'previous run');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed proof startup still identifies the retained private evidence directory', async () => {
  const environment = { ...process.env };
  delete environment.CODEBOOK_PROOF_DIR;
  const runner = new URL('./verify-live.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `globalThis.fetch = async () => { throw new Error('intentional offline preflight'); }; await import(${JSON.stringify(runner)});`
  ], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: environment, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /intentional offline preflight/);
  const output = result.stdout.match(/Codebook proof evidence directory: (.+)/)?.[1];
  assert(output, 'failure output identifies the newly allocated evidence directory');
  try {
    assert.equal((await stat(output)).mode & 0o777, 0o700);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
