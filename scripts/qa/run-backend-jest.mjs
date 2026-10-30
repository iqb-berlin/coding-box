import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nxManifest = require.resolve('nx/package.json');
const nxBinary = path.resolve(path.dirname(nxManifest), require(nxManifest).bin.nx);
// VM modules must be enabled before Jest/Nx is loaded, including --runInBand.
// Keep @nx/jest's argument/configuration handling for all existing callers.
const child = spawn(process.execPath, [
  '--experimental-vm-modules', nxBinary, 'run', 'backend:test-jest', ...process.argv.slice(2)
], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
