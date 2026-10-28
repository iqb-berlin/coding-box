import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

describe('Testcenter TLS trust at Node startup', () => {
  let directory: string;
  let server: https.Server;
  let port: number;
  const requests: { method: string | undefined; url: string | undefined; token: string | string[] | undefined; body: string }[] = [];
  const client = path.resolve(__dirname, '../../../../../../../scripts/qa/testcenter-tls-client.cjs');

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testcenter-startup-tls-'));
    const openssl = (args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Testcenter Fixture CA',
      '-keyout', 'ca-key.pem', '-out', 'ca.pem']);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-keyout', 'server-key.pem', '-out', 'server.csr']);
    fs.writeFileSync(path.join(directory, 'server.ext'), 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-set_serial', '1',
      '-days', '1', '-extfile', 'server.ext', '-out', 'server.pem']);
    server = https.createServer({
      key: fs.readFileSync(path.join(directory, 'server-key.pem')),
      cert: fs.readFileSync(path.join(directory, 'server.pem'))
    }, (request, response) => {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        requests.push({
          method: request.method, url: request.url, token: request.headers.authtoken, body
        });
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'PUT' && request.url === '/tci/api/session/admin') {
          response.end(JSON.stringify({ token: 'synthetic-token' }));
        } else if (request.method === 'GET' && request.url === '/tci/api/workspace/study/file/Unit/example.xml') {
          response.end(JSON.stringify({ content: '<Unit/>' }));
        } else {
          response.statusCode = 404;
          response.end('{}');
        }
      });
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => { requests.length = 0; });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => { server.close(error => (error ? reject(error) : resolve())); });
    }
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  const runClient = (hostname: string, ca?: string): Promise<{ code: number | string; result: Record<string, unknown>; stderr: string }> => {
    const env = { ...process.env };
    delete env.NODE_EXTRA_CA_CERTS;
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete env.NODE_OPTIONS;
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    if (ca) env.NODE_EXTRA_CA_CERTS = ca;
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [client, `https://${hostname}:${port}/tci`], { env, timeout: 20000 }, (error, stdout, stderr) => {
        try {
          resolve({ code: error?.code || 0, result: JSON.parse(stdout.trim()), stderr });
        } catch (parseError) {
          reject(new Error(`Testcenter TLS client failed: ${stderr || String(parseError)}`));
        }
      });
    });
  };

  it('rejects a private CA before sending credentials when no extra trust is configured', async () => {
    const result = await runClient('127.0.0.1');
    expect(result.code).toBe(1);
    expect(result.result.error).toMatch(/unable to verify|self.signed|unable to get local issuer/i);
    expect(requests).toHaveLength(0);
  }, 30000);

  it('authenticates and downloads through an individual HTTPS base path with NODE_EXTRA_CA_CERTS', async () => {
    const result = await runClient('127.0.0.1', path.join(directory, 'ca.pem'));
    expect(result).toEqual({ code: 0, result: { authenticated: true, downloaded: true }, stderr: '' });
    expect(requests).toEqual([
      {
        method: 'PUT', url: '/tci/api/session/admin', token: undefined, body: JSON.stringify({ name: 'tls-fixture', password: 'synthetic-password' })
      },
      {
        method: 'GET', url: '/tci/api/workspace/study/file/Unit/example.xml', token: 'synthetic-token', body: ''
      }
    ]);
  }, 30000);

  it('still rejects a hostname mismatch when the private CA is trusted', async () => {
    const result = await runClient('localhost', path.join(directory, 'ca.pem'));
    expect(result.code).toBe(1);
    expect(result.result.error).toMatch(/does not match certificate/i);
    expect(requests).toHaveLength(0);
  }, 30000);
});
