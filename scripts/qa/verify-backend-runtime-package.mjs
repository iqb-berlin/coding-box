import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dockerfile = readFileSync(join(workspace, 'apps/backend/Dockerfile'), 'utf8');
const npmVersion = dockerfile.match(/npm install -g --no-fund npm@(\d+\.\d+\.\d+)/)?.[1];
assert.ok(npmVersion, 'The backend Docker npm version must be pinned');
assert.ok(readFileSync(join(workspace, 'Dockerfile'), 'utf8').includes(`npm@${npmVersion}`),
  'Build and runtime Docker stages must use the same npm version');

const directory = mkdtempSync(join(tmpdir(), 'backend-runtime-package-'));
const manifests = ['package.json', 'package-lock.json'];
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const env = { ...process.env, NODE_PATH: '' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: directory, env, stdio: 'inherit', timeout: 300_000, ...options
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
  return result;
}

try {
  for (const file of manifests) cpSync(join(workspace, file), join(directory, file));
  cpSync(join(workspace, 'vendor'), join(directory, 'vendor'), { recursive: true });
  const before = manifests.map(file => digest(join(directory, file)));
  const npmArgs = ['exec', '--yes', `--package=npm@${npmVersion}`, '--', 'npm'];
  const version = run('npm', [...npmArgs, '--version'], { encoding: 'utf8', stdio: 'pipe' });
  assert.equal(version.stdout.trim(), npmVersion);
  // Use cwd rather than --prefix: local file overrides resolve against this copy.
  run('npm', [...npmArgs, 'ci', '--omit=dev', '--no-fund', '--no-audit']);
  assert.deepEqual(manifests.map(file => digest(join(directory, file))), before,
    'A clean runtime installation must not change either manifest');

  run(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const local = createRequire(path.join(process.cwd(), 'package.json'));
    const lock = local('./package-lock.json');
    const modules = [
      'express', '@nestjs/core', '@nestjs/platform-express', '@nestjs/bullmq',
      '@nestjs/throttler', 'bullmq', 'ioredis', 'pg', 'libxmljs2', 'sqlite3'
    ];
    for (const name of modules) {
      assert.ok(local.resolve(name).startsWith(path.join(process.cwd(), 'node_modules') + path.sep),
        name + ' must resolve within the isolated production installation');
      local(name);
    }
    for (const name of ['express', '@nestjs/core', '@nestjs/platform-express', 'pg']) {
      assert.equal(local(name + '/package.json').version, lock.packages['node_modules/' + name].version);
    }
    assert.equal(local('libxmljs2').parseXml('<runtime/>').root().name(), 'runtime');
    assert.ok(local('sqlite3').Database);
    console.log('Fresh production dependencies loaded successfully; manifests unchanged.');
  `]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
