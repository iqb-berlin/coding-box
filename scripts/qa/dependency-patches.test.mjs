import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const require = createRequire(new URL('../../package.json', import.meta.url));
const braces = require('braces');
const micromatch = require('micromatch');
const lock = require('./package-lock.json');

test('all installed brace consumers resolve the security patch', () => {
  const expected = realpathSync(require.resolve('braces'));
  assert.equal(require('braces/package.json').name, '@coding-box/braces-patched');
  const consumers = Object.entries(lock.packages).filter(([, entry]) => entry.dependencies?.braces);
  assert.ok(consumers.length >= 4);
  for (const [location] of consumers) {
    const consumer = createRequire(new URL(`../../${location}/package.json`, import.meta.url));
    assert.equal(realpathSync(consumer.resolve('braces')), expected, location);
    assert.throws(() => consumer('braces')('{'.repeat(4000) + 'x' + '}'.repeat(4000)), /exceeds max depth/);
  }
});

for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    test(`${method} bounds ${open}${close} nesting, including a raised or fractional maxDepth`, () => {
      const nested = depth => open.repeat(depth) + 'x' + close.repeat(depth);
      assert.doesNotThrow(() => braces[method](nested(100)));
      assert.throws(() => braces[method](nested(101)), /exceeds max depth/);
      assert.throws(() => braces[method](nested(4000), { maxDepth: 10000 }), /exceeds max depth/);
      assert.doesNotThrow(() => braces[method](nested(1), { maxDepth: 1.5 }));
      assert.throws(() => braces[method](nested(2), { maxDepth: 1.5 }), /exceeds max depth/);
    });
  }
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method} rejects a deeply nested or cyclic caller-supplied AST`, () => {
    const root = { type: 'root', nodes: [] };
    let parent = root;
    for (let depth = 0; depth < 102; depth++) {
      const child = { type: 'brace', nodes: [], parent };
      parent.nodes.push(child);
      parent = child;
    }
    assert.throws(() => braces[method](root), /exceeds max depth/);
    const cycle = { type: 'root', nodes: [] };
    cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), /exceeds max depth/);
  });
}

test('expand rejects a cyclic parent chain instead of hanging', { timeout: 1000 }, () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const braces = require('braces');
    const parent = { type: 'paren', nodes: [], queue: [] };
    parent.parent = parent;
    const child = { type: 'paren', nodes: [], parent };
    assert.throws(() => braces.expand(child), /parent chain contains a cycle/);
  `], { cwd: new URL('../..', import.meta.url), timeout: 800, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('normal build and test globs preserve alternations, ranges and escaped braces', () => {
  assert.equal(braces.compile('src/{app,shared}/**/*.{ts,html}'), 'src/(app|shared)/**/*.(ts|html)');
  assert.deepEqual(braces.expand('file-{01..03}.{ts,html}'), [
    'file-01.ts', 'file-01.html', 'file-02.ts', 'file-02.html', 'file-03.ts', 'file-03.html'
  ]);
  assert.equal(braces.stringify('a{b}c', { escapeInvalid: true }), 'a{b}c');
  assert.deepEqual(micromatch(['src/app/a.ts', 'src/shared/b.html', 'src/a.js'], 'src/{app,shared}/**/*.{ts,html}'),
    ['src/app/a.ts', 'src/shared/b.html']);
  assert.deepEqual(braces.expand('a\\{b,c\\}'), ['a{b,c}']);
});

test('every http-cache-semantics installation uses the corrected release', () => {
  const installations = Object.entries(lock.packages).filter(([location]) => location.endsWith('/http-cache-semantics'));
  assert.ok(installations.length > 0);
  for (const [location, entry] of installations) {
    assert.equal(entry.version, '4.3.0', location);
    const metadata = JSON.parse(readFileSync(new URL(`../../${location}/package.json`, import.meta.url), 'utf8'));
    assert.equal(metadata.version, '4.3.0', location);
  }
});
