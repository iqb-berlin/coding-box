import { fork } from 'child_process';
import { once } from 'events';
import { promises as fs } from 'fs';
import ts from 'typescript';
import * as path from 'path';

describe('Nest process shutdown', () => {
  it.each([
    ['api', 'SIGTERM'], ['api', 'SIGINT'], ['export-worker', 'SIGTERM'], ['export-worker', 'SIGINT']
  ] as const)('runs awaited cleanup for %s on %s', async (role, signal) => {
    const temporaryRoot = path.resolve('tmp');
    await fs.mkdir(temporaryRoot, { recursive: true });
    const directory = await fs.mkdtemp(path.join(temporaryRoot, 'backend-shutdown-'));
    const trace = path.join(directory, 'trace.jsonl');
    const environment = { ...process.env };
    delete environment.NO_COLOR;
    delete environment.FORCE_COLOR;
    for (const name of ['shutdown.test.factory', 'shutdown']) {
      const source = await fs.readFile(path.join(__dirname, `${name}.ts`), 'utf8');
      const emitted = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2021,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false
        }
      }).outputText.replace("from './shutdown'", "from './shutdown.mjs'");
      await fs.writeFile(path.join(directory, `${name}.mjs`), emitted);
    }
    const child = fork(path.join(directory, 'shutdown.test.factory.mjs'), [], {
      execArgv: [],
      env: { ...environment, APP_ROLE: role, SHUTDOWN_TRACE_PATH: trace },
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
