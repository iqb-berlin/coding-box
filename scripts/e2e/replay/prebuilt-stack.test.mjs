import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prebuiltStack } from './prebuilt-stack.mjs';

test('prebuilt mode fails on missing artifacts and never falls back to building', async t => {
  const deps = process.env.REPLAY_E2E_LINUX_DEPS_DIR;
  delete process.env.REPLAY_E2E_LINUX_DEPS_DIR;
  t.after(() => {
    if (deps !== undefined) process.env.REPLAY_E2E_LINUX_DEPS_DIR = deps;
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'replay-prebuilt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(await prebuiltStack(dir, undefined, false), undefined);
  await assert.rejects(prebuiltStack(dir, 'true', false), /production frontend/);
  for (const file of [
    'dist/apps/backend/main.mjs',
    'dist/apps/frontend/index.html',
    'dist/apps/frontend/assets/config/runtime-config.js',
    'node_modules/express/package.json'
  ]) {
    await assert.rejects(prebuiltStack(dir, 'true', true), { message: `Missing E2E build artifact: ${file}` });
    const target = path.join(dir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'fixture');
  }
  const stack = await prebuiltStack(dir, 'true', true);
  assert.equal(stack.environment.REPLAY_E2E_LINUX_DEPS_DIR, dir);
  assert.equal(stack.overrideFile, path.join(dir, 'scripts/e2e/replay/docker-compose.prebuilt.yml'));
  assert.equal(stack.environment.REPLAY_E2E_RUNTIME_CONFIG_TARGET, '/usr/share/nginx/html/assets/config/runtime-config.js');
});
