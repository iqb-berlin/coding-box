import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { waitForHttp } from './http-readiness.mjs';
import { waitForBackendAuthentication } from './harness.mjs';

async function serve(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('waits for a service to recover from an HTTP error', { timeout: 5000 }, async t => {
  let requests = 0;
  const url = await serve(t, (_request, response) => {
    response.writeHead(++requests === 1 ? 503 : 200);
    response.end();
  });
  await waitForHttp(url, 2000, { retryIntervalMs: 10 });
  assert.equal(requests, 2);
});

test('retries a connected server that never sends response headers', { timeout: 5000 }, async t => {
  let requests = 0;
  const url = await serve(t, (_request, response) => {
    if (++requests > 1) response.end('ready');
  });
  await waitForHttp(url, 2000, { requestTimeoutMs: 100, retryIntervalMs: 10 });
  assert.equal(requests, 2);
});

test('bounds an in-flight request by the overall deadline', { timeout: 5000 }, async t => {
  const url = await serve(t, () => {});
  const start = performance.now();
  await assert.rejects(waitForHttp(url, 150, { requestTimeoutMs: 30_000 }), /request timed out/);
  assert.ok(performance.now() - start < 2000, 'must not wait for the request timeout');
});

test('reports the last HTTP error when the service stays unhealthy', { timeout: 5000 }, async t => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await assert.rejects(waitForHttp(url, 150, { retryIntervalMs: 10 }), /HTTP status: 503/);
});

test('waits for backend JWT verification to recover before fixture mutations', { timeout: 5000 }, async t => {
  const requests = [];
  let probes = 0;
  const url = await serve(t, (request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === '/protocol/openid-connect/token') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ access_token: 'fixture-provider-token' }));
      return;
    }
    assert.equal(request.headers.authorization, 'Bearer fixture-provider-token');
    response.writeHead(++probes === 1 ? 503 : 200);
    response.end();
  });
  await waitForBackendAuthentication({ issuer: url, apiUrl: url, authPassword: 'ephemeral' }, 2000, {
    retryIntervalMs: 10
  });
  assert.deepEqual(requests, [
    { method: 'POST', url: '/protocol/openid-connect/token' },
    { method: 'GET', url: '/api/admin/workspace?page=1&limit=1' },
    { method: 'GET', url: '/api/admin/workspace?page=1&limit=1' }
  ]);
});

test('fails authenticated readiness within its budget without leaking credentials', { timeout: 5000 }, async t => {
  const url = await serve(t, (request, response) => {
    if (request.url === '/protocol/openid-connect/token') {
      response.end(JSON.stringify({ access_token: 'private-token' }));
      return;
    }
    response.writeHead(503);
    response.end('private-provider-diagnostics');
  });
  await assert.rejects(
    waitForBackendAuthentication({ issuer: url, apiUrl: url, authPassword: 'private-password' }, 150, {
      retryIntervalMs: 10
    }),
    error => /last HTTP status: 503/.test(error.message) && !/private-/.test(error.message)
  );
});
