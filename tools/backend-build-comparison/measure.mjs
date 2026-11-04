import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = path.join(root, 'tmp/backend-build-comparison');
await mkdir(directory, { recursive: true });
const require = createRequire(import.meta.url);
const nxManifest = require.resolve('nx/package.json');
const nx = path.resolve(path.dirname(nxManifest), require(nxManifest).bin.nx);
const environment = { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true',
  NX_ISOLATE_PLUGINS: 'false', NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false' };
delete environment.FORCE_COLOR;
delete environment.NO_COLOR;
const target = variant => `backend:build-${variant}-pilot${variant === 'tsc' ? '' : ':production'}`;
const report = process.argv.includes('--watch-only') ? JSON.parse(await readFile(path.join(directory, 'measurements.json'), 'utf8')) : {
  createdAt: new Date().toISOString(), node: process.version, platform: process.platform,
  arch: process.arch, cpu: os.cpus()[0].model,
  method: 'Sequential full builds in fresh processes; no Nx task cache; warm filesystem; type checking enabled for every variant.',
  builds: [], watch: []
};
const save = () => writeFile(path.join(directory, 'measurements.json'), JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const strip = text => text.replace(/\x1b\[[0-9;]*m/g, '');

async function build(variant, round) {
  const start = performance.now();
  const loadBefore = os.loadavg();
  await rm(path.join(root, 'dist/backend-build-comparison', variant), { recursive: true, force: true });
  const child = spawn(process.execPath, [nx, 'run', target(variant), '--skip-nx-cache', '--outputStyle=stream'],
    { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const [code, signal] = await once(child, 'exit');
  const record = { variant, round, elapsedMs: performance.now() - start, code, signal, loadBefore, loadAfter: os.loadavg() };
  report.builds.push(record);
  await writeFile(path.join(directory, `build-${variant}-${round}.log`), strip(log));
  await save();
  console.log(JSON.stringify(record));
  if (code !== 0) throw new Error(`${variant} build failed; see saved log`);
}

async function watch(variant) {
  const child = spawn(process.execPath, [nx, 'run', target(variant), '--watch', '--skip-nx-cache', '--outputStyle=stream'],
    { cwd: root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', completed = 0;
  const read = chunk => {
    log += chunk;
    writeFileSync(path.join(directory, `watch-${variant}.log`), strip(log));
    completed = [...strip(log).matchAll(/compiled successfully|BUILD_COMPARISON_COMPLETED/g)].length;
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const wait = async expected => {
    const deadline = Date.now() + 120_000;
    while (completed < expected) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`${variant}: watcher failed or timed out`);
      await pause(15);
    }
  };
  const files = ['apps/backend/src/app/http/request-id.ts', 'api-dto/workspaces/workspace-settings-dto.ts'];
  const originals = new Map();
  try {
    const start = performance.now();
    await wait(1);
    report.watch.push({ variant, stage: 'initial', elapsedMs: performance.now() - start });
    for (const file of files) {
      const absolute = path.join(root, file);
      const original = await readFile(absolute, 'utf8');
      originals.set(absolute, original);
      for (let round = 1; round <= 3; round += 1) {
        // A harmless source edit exercises parsing, graph invalidation and emit.
        const expected = completed + 1;
        const start = performance.now();
        await writeFile(absolute, original + `\n// Build comparison watch probe ${round}.\n`);
        await wait(expected);
        const record = { variant, stage: 'edit', file, round, elapsedMs: performance.now() - start };
        report.watch.push(record);
        console.log(JSON.stringify(record));
        await save();
        await pause(400);
      }
    }
  } finally {
    const restorationErrors = [];
    try {
      for (const [file, original] of originals) {
        try {
          if (await readFile(file, 'utf8') !== original) {
            const expected = completed + 1;
            await writeFile(file, original);
            if (child.exitCode === null) await wait(expected);
          }
        } catch (error) { restorationErrors.push(error); }
      }
    } finally {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      if (child.exitCode === null) await Promise.race([once(child, 'exit'), pause(5000)]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      if (variant === 'tsc') await rm(path.join(root, 'dist/backend-build-comparison/tsc/.tsbuildinfo'), { force: true });
    }
    if (restorationErrors.length) throw new AggregateError(restorationErrors, 'Source restoration or rebuild failed');
    await writeFile(path.join(directory, `watch-${variant}.log`), strip(log));
    await save();
  }
}

if (!process.argv.includes('--watch-only')) for (let round = 1; round <= 3; round += 1) {
  const order = ['webpack', 'rspack', 'tsc'];
  const offset = round - 1;
  for (const variant of [...order.slice(offset), ...order.slice(0, offset)]) await build(variant, round);
}
if (!process.argv.includes('--builds-only')) {
  const selected = process.argv.find(argument => argument.startsWith('--watch-variant='))?.split('=')[1];
  const variants = selected ? [selected] : ['webpack', 'rspack', 'tsc'];
  report.watch = selected ? report.watch.filter(record => record.variant !== selected) : [];
  for (const variant of variants) await watch(variant);
}
console.log(`Measurements: ${path.join(directory, 'measurements.json')}`);
