import { spawn } from 'node:child_process';

/** Keep process/module startup outside the parser's infinite-loop watchdog. */
function checkInChild(initialize: string, check: string, executionTimeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      (async () => {
        ${initialize}
        process.once('message', () => {
          ${check}
          process.disconnect();
        });
        process.send('ready');
      })().catch(error => {
        console.error(error);
        process.disconnect();
        process.exitCode = 1;
      });
    `], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    let started = false;
    const fail = (error: Error) => {
      clearTimeout(watchdog);
      child.kill('SIGKILL');
      reject(error);
    };
    let watchdog = setTimeout(() => fail(new Error('Image parser initialization timed out')), 30_000);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', fail);
    child.once('message', message => {
      if (message !== 'ready') { fail(new Error('Unexpected image parser readiness message')); return; }
      clearTimeout(watchdog);
      started = true;
      watchdog = setTimeout(() => fail(new Error('Image parser execution timed out')), executionTimeout);
      child.send('check', error => { if (error) fail(error); });
    });
    child.once('close', (code, signal) => {
      clearTimeout(watchdog);
      if (code !== 0 || !started) {
        reject(new Error(`Image parser child exited (${code ?? signal})${stderr ? `: ${stderr}` : ''}`));
      } else {
        resolve();
      }
    });
  });
}

/** Exercise the parser actually resolved by the installed CommonJS generator. */
describe('Codebook image parser security', () => {
  it('rejects an ICNS entry that cannot advance instead of looping forever', async () => {
    await checkInChild(`
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const entry = require.resolve('@iqb/ngx-coding-components/codebook-generator');
      const parser = require(require.resolve('image-size', { paths: [path.dirname(entry)] }));
    `, `
      const invalid = Buffer.alloc(16);
      invalid.write('icns', 0);
      invalid.writeUInt32BE(16, 4);
      invalid.write('ic07', 8);
      invalid.writeUInt32BE(0, 12);
      assert.throws(() => parser.imageSize(invalid), /Invalid ICNS/);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
      const dimensions = parser.imageSize(png);
      assert.equal(dimensions.width, 1);
      assert.equal(dimensions.height, 1);
    `);
  }, 40_000);

  it('allows slow initialization without consuming the parser execution deadline', async () => {
    await checkInChild('await new Promise(resolve => setTimeout(resolve, 6000));', '');
  }, 40_000);

  it('kills a parser that does not terminate after initialization', async () => {
    await expect(checkInChild('', 'while (true) {}', 100)).rejects.toThrow('Image parser execution timed out');
  }, 40_000);

  it('propagates parser assertions instead of accepting a clean startup', async () => {
    await expect(checkInChild('', "throw new Error('Synthetic parser failure');")).rejects.toThrow('Synthetic parser failure');
  }, 40_000);
});
