import { createServer, Server } from 'http';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

describe('Live Testcenter verification client with synthetic API generations', () => {
  let server: Server;
  let baseUrl: string;
  let version: string;
  let requests: string[];
  const run = promisify(execFile);

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader('Content-Type', 'application/json');
      const session = { token: 'synthetic-session', claims: { workspaceAdmin: [{ id: '12' }] } };
      if (request.url === '/api/session/admin' && !version.startsWith('17.')) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Brute Force protection active. Challenge for this password must be solved to create a session');
      } else if (request.url === '/api/session/challenge') {
        response.end(JSON.stringify({
          algorithm: 'SHA-256',
          salt: 'fixture-salt',
          maxNumber: 20,
          signature: 'fixture-signature',
          challenge: createHash('sha256').update('fixture-salt17').digest('hex')
        }));
      } else if (request.url === '/api/session/admin' || request.url === '/api/session') {
        response.end(JSON.stringify(session));
      } else if (request.url === '/api/version') {
        response.end(JSON.stringify({ version }));
      } else if (request.url === '/api/workspace/12/results') {
        response.end(JSON.stringify([{
          groupName: 'fixture-group', groupLabel: 'Fixture', bookletsStarted: 1, numUnitsMin: 1, numUnitsMax: 1, numUnitsTotal: 1, numUnitsAvg: 1, lastChange: 1
        }]));
      } else if (request.url?.startsWith('/api/workspace/12/report/response?')) {
        response.end(JSON.stringify([{
          groupname: 'fixture-group',
          loginname: 'fixture-person',
          code: 'fixture-code',
          bookletname: 'fixture-booklet',
          unitname: 'fixture-unit',
          originalUnitId: 'fixture-unit',
          laststate: '{"PRESENTATIONCOMPLETE":"yes"}',
          responses: [{
            id: 'main', ts: 1, responseType: 'application/json', content: '[{"id":"VAR","value":1,"status":"VALUE_CHANGED"}]'
          }]
        }]));
      } else if (request.url?.startsWith('/api/workspace/12/report/log?')) {
        response.end(JSON.stringify([{
          groupname: 'fixture-group',
          loginname: 'fixture-person',
          code: 'fixture-code',
          bookletname: 'fixture-booklet',
          unitname: 'fixture-unit',
          timestamp: 10,
          logentry: 'FOCUS=IN'
        }]));
      } else if (request.url === '/api/workspace/12/files') {
        response.end(JSON.stringify({
          Unit: [{
            type: 'Unit', name: 'fixture.xml', id: 'fixture', size: 7
          }]
        }));
      } else if (request.url === '/api/workspace/12/file/Unit/fixture.xml') {
        response.end(JSON.stringify('<Unit/>'));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local HTTP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); }); });

  it.each(['17.6.1', '18.3.1', '19.0.1'])('runs authentication, data reads and real parser through the standalone client: %s', async selected => {
    version = selected;
    requests = [];
    const { stdout } = await run(process.execPath, [path.resolve('scripts/qa/verify-testcenter-live.cjs')], {
      env: {
        ...process.env,
        TESTCENTER_LIVE_URL: baseUrl,
        TESTCENTER_LIVE_USERNAME: 'synthetic-user',
        TESTCENTER_LIVE_PASSWORD: 'synthetic-password',
        TESTCENTER_LIVE_WORKSPACE: '12',
        TESTCENTER_LIVE_GROUP: 'fixture-group'
      },
      timeout: 20000
    });
    expect(JSON.parse(stdout)).toMatchObject({
      version,
      authenticated: true,
      groupFound: true,
      fileDownloaded: true,
      responseRows: 1,
      logRows: 1,
      parsedResponses: 1,
      parsedLogs: 1,
      persistedToCodingBox: false
    });
    expect(stdout).not.toMatch(/synthetic-password|synthetic-session|fixture-salt|fixture-person/);
    expect(requests.includes('POST /api/session/challenge')).toBe(!version.startsWith('17.'));
  }, 25000);
});
