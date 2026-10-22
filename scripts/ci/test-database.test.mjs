import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function exercise(failCommand) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-database-test-'));
  try {
    writeFileSync(path.join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') process.stdout.write('healthy\\n');
if (args[0] === 'logs') process.stdout.write('disposable database log\\n');
if (args.at(-1) === process.env.FAIL_COMMAND) process.exit(17);
`, { mode: 0o755 });
    writeFileSync(path.join(directory, 'zstd'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('bash', [fileURLToPath(new URL('./test-database.sh', import.meta.url))], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2',
        CALL_LOG: path.join(directory, 'calls.jsonl'),
        FAIL_COMMAND: failCommand || ''
      }
    });
    return {
      ...result,
      calls: readFileSync(path.join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)),
      log: readFileSync(path.join(directory, 'database-test.log'), 'utf8')
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('migration checks run in order on an isolated database and clean up only their own resources', () => {
  const result = exercise();
  assert.equal(result.status, 0, result.stderr);
  const migrations = result.calls.filter(args => args.includes('--changelogFile'));
  assert.deepEqual(migrations.map(args => args.at(-1)), ['status', 'validate', 'updateSQL', 'updateTestingRollback', 'history']);
  for (const args of migrations) {
    assert.equal(args[args.indexOf('--network') + 1], 'ci-db-123-2');
    assert.equal(args[args.indexOf('--url') + 1], 'jdbc:postgresql://db:5432/ci');
  }
  assert.deepEqual(result.calls.at(-2), ['rm', '--force', 'ci-db-123-2-db']);
  assert.deepEqual(result.calls.at(-1), ['network', 'rm', 'ci-db-123-2']);
  assert.match(result.log, /disposable database log/);
  assert.ok(!result.calls.some(args => args.includes('prune')));
});

test('a failed migration stops further operations, preserves failure and still captures logs and cleans up', () => {
  const result = exercise('validate');
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(result.calls.filter(args => args.includes('--changelogFile')).map(args => args.at(-1)), ['status', 'validate']);
  assert.deepEqual(result.calls.at(-2), ['rm', '--force', 'ci-db-123-2-db']);
  assert.deepEqual(result.calls.at(-1), ['network', 'rm', 'ci-db-123-2']);
  assert.match(result.log, /disposable database log/);
});
