import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './http-dependency-patches.test.mjs';

const require = createRequire(new URL('../../package.json', import.meta.url));
const braces = require('braces');
const micromatch = require('micromatch');
const picomatch = require('picomatch');
const lock = require('./package-lock.json');

test('picomatch consumers resolve the local security patch', () => {
  const expected = realpathSync(require.resolve('picomatch'));
  assert.equal(require('picomatch/package.json').name, '@coding-box/picomatch-patched');
  assert.equal(expected, fileURLToPath(new URL('../../vendor/picomatch/index.js', import.meta.url)));
  const consumers = Object.entries(lock.packages).filter(([location, entry]) =>
    location && (entry.dependencies?.picomatch || entry.peerDependencies?.picomatch));
  assert.ok(consumers.length > 0);
  for (const [location] of consumers) {
    const consumer = createRequire(new URL(`../../${location}/package.json`, import.meta.url));
    assert.equal(realpathSync(consumer.resolve('picomatch')), expected, location);
  }
});

test('picomatch unescapes the base and preserves escapes inside bracket expressions', () => {
  const { base, glob } = picomatch.scan(String.raw`dir/a\*/[x\-y]/*.ts`, { unescape: true });
  assert.equal(base, 'dir/a*');
  assert.equal(glob, String.raw`[x\-y]/*.ts`);

  const { removeBackslashes } = require('picomatch/lib/utils');
  assert.equal(removeBackslashes(String.raw`[a\]b]\*`), String.raw`[a\]b]*`);
  assert.equal(removeBackslashes(String.raw`[]\*`), '[]*');
  assert.equal(removeBackslashes('path\\'), 'path\\');
  for (const newline of ['\r', '\n', '\u2028', '\u2029']) {
    assert.equal(removeBackslashes(`[a\\b${newline}]\\c`), `[a\\b${newline}]c`);
    assert.equal(removeBackslashes(`[a\\b\\${newline}x]\\c`), `[ab\\${newline}x]c`);
  }
});

test('picomatch falls back to literal matching for wildcards inside repeated extglobs', () => {
  for (const operator of ['+', '*']) {
    const pattern = `src/${operator}(part-*).ts`;
    const matches = picomatch(pattern);
    assert.equal(matches(pattern), true);
    assert.equal(matches('src/part-example.ts'), false);
  }
});

test('picomatch preserves ordinary globs and repeated literal extglobs', () => {
  for (const [pattern, matching, nonmatching] of [
    ['src/**/[a-z]*.{ts,tsx}', 'src/app/page.tsx', 'src/app/page.js'],
    ['src/+(unit|integration).spec.ts', 'src/unitintegration.spec.ts', 'src/unit.integration.spec.ts'],
    ['src/+(*(a)|*(b)).ts', 'src/abba.ts', 'src/abc.ts'],
    ['src/+([*]).ts', 'src/**.ts', 'src/xx.ts'],
    [String.raw`src/+(\*).ts`, 'src/**.ts', 'src/xx.ts'],
    ['src/+("*").ts', 'src/**.ts', 'src/xx.ts']
  ]) {
    const matches = picomatch(pattern);
    assert.equal(matches(matching), true, pattern);
    assert.equal(matches(nonmatching), false, pattern);
  }
});

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

for (const [name, version] of Object.entries({
  compression: '1.8.2',
  'proxy-addr': '2.0.8',
  'source-map-js': '1.2.2',
  handlebars: '4.7.10'
})) {
  test(`all ${name} installations use the corrected release`, () => {
    const installations = Object.entries(lock.packages).filter(([location]) => location.endsWith(`/${name}`));
    assert.ok(installations.length > 0);
    for (const [location, entry] of installations) {
      assert.equal(entry.version, version, location);
      const metadata = JSON.parse(readFileSync(new URL(`../../${location}/package.json`, import.meta.url), 'utf8'));
      assert.equal(metadata.version, version, location);
    }
  });
}
