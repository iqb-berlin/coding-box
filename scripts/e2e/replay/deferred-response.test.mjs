import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import deferredResponses from '../../../cypress/support/deferred-response-task.cjs';

test('keeps concurrent HTTP responses pending until explicitly released', { timeout: 5000 }, async t => {
  const responses = deferredResponses.createDeferredResponses();
  t.after(() => responses.reset());
  const first = await responses.create({ body: [{ jobId: 'job-1' }] });
  const second = await responses.create({ body: 'csv', headers: { 'content-type': 'text/csv' } });
  let firstSettled = false;
  const pending = fetch(first.url, { method: 'POST', body: '{}' }).then(async response => {
    firstSettled = true;
    assert.equal(response.status, 200);
    return response.json();
  });
  responses.release(second.id);
  const csv = await fetch(second.url);
  assert.equal(csv.headers.get('content-type'), 'text/csv');
  assert.equal(await csv.text(), 'csv');
  await delay(50);
  assert.equal(firstSettled, false);
  responses.release(first.id);
  assert.deepEqual(await pending, [{ jobId: 'job-1' }]);
});

test('reset aborts pending requests and permits another test server', { timeout: 5000 }, async t => {
  const responses = deferredResponses.createDeferredResponses();
  t.after(() => responses.reset());
  const gate = await responses.create({ body: 'unused' });
  const rejected = assert.rejects(fetch(gate.url));
  await delay(50);
  await responses.reset();
  await rejected;
  const next = await responses.create({ statusCode: 201, body: { next: true } });
  responses.release(next.id);
  const response = await fetch(next.url);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { next: true });
});
