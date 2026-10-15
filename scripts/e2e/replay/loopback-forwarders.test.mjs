import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { startLoopbackForwarders } from './loopback-forwarders.mjs';

const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const close = server => new Promise((resolve, reject) => {
  server.close(error => (error ? reject(error) : resolve()));
});

test('forwards real HTTP requests from loopback to the remote service', { timeout: 5000 }, async t => {
  let receivedRequest;
  const service = http.createServer((request, response) => {
    receivedRequest = { method: request.method, url: request.url };
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('service response');
  });
  const remotePort = await listen(service);
  t.after(() => close(service));
  const forwarders = await startLoopbackForwarders('127.0.0.1', [{ localPort: 0, remotePort }]);
  t.after(() => forwarders.close());
  const response = await fetch(`http://127.0.0.1:${forwarders.ports[0]}/realm?query=1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await response.text(), 'service response');
  assert.deepEqual(receivedRequest, { method: 'GET', url: '/realm?query=1' });
});

test('closes open streams and releases the listener during cleanup', { timeout: 5000 }, async t => {
  const service = net.createServer();
  const remotePort = await listen(service);
  t.after(() => close(service));
  const forwarders = await startLoopbackForwarders('127.0.0.1', [{ localPort: 0, remotePort }]);
  t.after(() => forwarders.close());
  const connected = once(service, 'connection');
  const client = net.connect(forwarders.ports[0], '127.0.0.1');
  t.after(() => client.destroy());
  const [upstream] = await connected;
  t.after(() => upstream.destroy());
  const clientClosed = once(client, 'close');
  const upstreamClosed = once(upstream, 'close');
  await forwarders.close();
  await Promise.all([clientClosed, upstreamClosed]);
  const replacement = net.createServer();
  replacement.listen(forwarders.ports[0], '127.0.0.1');
  await once(replacement, 'listening');
  await close(replacement);
});

test('releases earlier listeners when a later forwarding port is occupied', { timeout: 5000 }, async t => {
  const occupied = net.createServer();
  const occupiedPort = await listen(occupied);
  t.after(() => close(occupied));
  const available = net.createServer();
  const availablePort = await listen(available);
  await close(available);
  await assert.rejects(startLoopbackForwarders('127.0.0.1', [
    { localPort: availablePort, remotePort: occupiedPort },
    { localPort: occupiedPort, remotePort: occupiedPort }
  ]), { code: 'EADDRINUSE' });
  const replacement = net.createServer();
  replacement.listen(availablePort, '127.0.0.1');
  await once(replacement, 'listening');
  await close(replacement);
});
