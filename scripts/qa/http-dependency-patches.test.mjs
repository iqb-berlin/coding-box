import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { packages } = require('./package-lock.json');
const corrected = {
  'follow-redirects': { 1: '1.16.2' },
  'body-parser': { 1: '1.20.9', 2: '2.4.0' },
  multer: { 2: '2.5.0' },
  undici: { 6: '6.29.1', 7: '7.30.1' }
};

const installations = name => Object.entries(packages)
  .filter(([location]) => location.endsWith(`/node_modules/${name}`) || location === `node_modules/${name}`);

for (const [name, versions] of Object.entries(corrected)) {
  test(`every ${name} installation uses a corrected compatible major`, () => {
    assert.ok(installations(name).length > 0);
    for (const [location, entry] of installations(name)) {
      const expected = versions[entry.version.split('.')[0]];
      assert.ok(expected, `unreviewed major at ${location}`);
      assert.equal(entry.version, expected, location);
      const installed = JSON.parse(readFileSync(new URL(`../../${location}/package.json`, import.meta.url)));
      assert.equal(installed.version, expected, location);
    }
  });
}

function probe(source, location, ...args) {
  // An uncaught stream error must fail this child, rather than the whole runner.
  const result = spawnSync(process.execPath,
    ['-e', source, fileURLToPath(new URL(`../../${location}`, import.meta.url)), ...args],
    { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
}

const redirectProbe = `
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const redirects = require(process.argv[1]);
const crossRealm = process.argv[2] === 'cross-realm';
const arrayHeaders = process.argv[3] === 'array';
const sensitiveHeaders = crossRealm ? vm.runInNewContext("['X-API-Key']") : ['X-API-Key'];
const target = http.createServer((req, res) => res.end(JSON.stringify(req.headers)));
target.listen(0, '127.0.0.1', () => {
  const origin = http.createServer((req, res) => {
    assert.equal(req.headers['x-api-key'], 'fixture-secret');
    res.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port + '/' });
    res.end();
  });
  origin.listen(0, '127.0.0.1', () => {
    const headers = arrayHeaders
      ? ['X-API-Key', 'fixture-secret', 'X-Harmless', 'preserved']
      : { 'X-API-Key': 'fixture-secret', 'X-Harmless': 'preserved' };
    redirects.http.get({ hostname: '127.0.0.1', port: origin.address().port, path: '/',
      headers, sensitiveHeaders, agent: false }, response => {
      let body = '';
      response.setEncoding('utf8').on('data', chunk => { body += chunk; });
      response.on('end', () => {
        const received = JSON.parse(body);
        assert.equal(received['x-api-key'], undefined);
        assert.equal(received['x-harmless'], 'preserved');
        origin.close(() => target.close(() => console.log('ok')));
      });
    }).on('error', error => { throw error; });
  });
});
`;

for (const [location] of installations('follow-redirects')) {
  for (const realm of ['same-realm', 'cross-realm']) {
    for (const headers of ['object', 'array']) {
      test(`${location} strips custom credentials across origins with ${realm} ${headers} headers`, () => {
        probe(redirectProbe, location, realm, headers);
      });
    }
  }
}

const parserProbe = `
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const parser = require(process.argv[1]).json();
const encoding = process.argv[2];
const trailingBytes = process.argv[3] === 'trailing';
const compressed = encoding === 'gzip' ? zlib.gzipSync('{"a":1}') : zlib.deflateSync('{"a":1}');
const first = trailingBytes ? Buffer.concat([compressed, Buffer.from([0])]) : compressed;
const trailing = trailingBytes ? Buffer.alloc(1024, 0x58) : Buffer.alloc(0);
let client;
const server = http.createServer((req, res) => {
  parser(req, res, error => {
    assert.ifError(error);
    assert.deepEqual(req.body, { a: 1 });
    const finish = () => res.end(JSON.stringify(req.body));
    if (req.complete) finish();
    else {
      req.once('end', finish);
      req.resume();
      // Deliver the second chunk only after the decompressor has finished.
      client.end(trailing);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  client = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST',
    agent: false, headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding,
      'Content-Length': first.length + trailing.length }
  }, response => {
    let body = '';
    response.setEncoding('utf8').on('data', chunk => { body += chunk; });
    response.on('end', () => {
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(body), { a: 1 });
      server.close(() => console.log('ok'));
    });
  });
  client.on('error', error => { throw error; });
  if (trailingBytes) client.write(first);
  else client.end(first);
});
`;

for (const [location] of installations('body-parser')) {
  for (const encoding of ['gzip', 'deflate']) {
    for (const mode of ['valid', 'trailing']) {
      test(`${location} preserves ${encoding} JSON with ${mode} bytes`, () => {
        probe(parserProbe, location, encoding, mode);
      });
    }
  }
}

const fetchProbe = String.raw`
const assert = require('node:assert/strict');
const net = require('node:net');
const { fetch } = require(process.argv[1]);
const server = net.createServer(socket => socket.once('data', request => {
  if (request.toString().startsWith('GET /ok ')) {
    socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok');
  } else {
    // The response closes early after an excessive content-encoding chain.
    socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 100\r\n' +
      'Content-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\n\r\n');
  }
}));
server.listen(0, '127.0.0.1', async () => {
  const url = 'http://127.0.0.1:' + server.address().port;
  await assert.rejects(fetch(url + '/malformed'));
  // Give any orphaned stream error a turn before the legitimate control.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await (await fetch(url + '/ok')).text(), 'ok');
  server.close(() => console.log('ok'));
});
`;

for (const [location] of installations('undici')) {
  test(`${location} survives excessive content encodings and subsequent valid fetch`, () => {
    probe(fetchProbe, location);
  });
}
