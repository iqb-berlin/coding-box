import { fork } from 'child_process';
import { once } from 'events';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Nest process shutdown', () => {
  it.each([
    ['api', 'SIGTERM'], ['api', 'SIGINT'], ['export-worker', 'SIGTERM'], ['export-worker', 'SIGINT']
  ] as const)('runs awaited cleanup for %s on %s', async (role, signal) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-shutdown-'));
    const trace = path.join(directory, 'trace.jsonl');
    const environment = { ...process.env };
    delete environment.NO_COLOR;
    delete environment.FORCE_COLOR;
    const child = fork(path.join(__dirname, 'shutdown.test.factory.ts'), [], {
      execArgv: ['--no-experimental-strip-types', '-r', require.resolve('ts-node/register/transpile-only')],
      env: {
        ...environment,
        APP_ROLE: role,
        SHUTDOWN_TRACE_PATH: trace,
        TS_NODE_PROJECT: path.resolve('apps/backend/tsconfig.spec.json'),
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs' })
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let errors = '';
    child.stderr?.on('data', data => { errors += data.toString(); });
    const exit = once(child, 'exit');
    try {
      const ready = await Promise.race([
        once(child, 'message'),
        exit.then(() => { throw new Error(`Child exited before ready: ${errors}`); })
      ]);
      expect(ready[0]).toMatchObject({ ready: true });
      if (role === 'api') {
        expect(await (await fetch((ready[0] as { url: string }).url)).json()).toEqual({ ready: true });
      }
      child.kill(signal);
      await exit;
      const records = (await fs.readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(records).toEqual([
        { phase: 'destroy' }, { phase: 'before', signal }, { phase: 'shutdown', signal }
      ]);
      expect(errors).toBe('');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exit;
      }
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
