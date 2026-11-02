const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Linter } = require('eslint');
const parser = require('@typescript-eslint/parser');
const { createPlugin, options } = require('../../config/quality/structure-rules.cjs');
const { measureSource, tightenBaseline } = require('../../config/quality/structure-baseline-utils.cjs');

const file = 'apps/backend/src/app/structure-fixture.ts';
const branchBody = count => `${Array.from({ length: count }, (_, i) => `if (value === ${i}) return ${i};`).join('\n')}\nreturn -1;`;
const longBody = count => `const rows: number[] = [];\n${Array.from({ length: count }, (_, i) => `rows.push(${i});`).join('\n')}\nreturn rows;`;
const legacySource = `export class Legacy {\nexisting(value: number): number {\n${branchBody(25)}\n}\n}`;
const snapshot = source => ({ schemaVersion: 2, files: { [file]: measureSource(source, file) } });

function lint(source, baseline, filename = file) {
  return new Linter().verify(source, [{
    files: ['**/*.ts'], languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { structure: createPlugin(baseline) },
    rules: Object.fromEntries(Object.entries(options).map(([name, option]) => [`structure/${name}`, ['error', option]]))
  }], { filename });
}

test('an existing function keeps only its own measured complexity', () => {
  const baseline = snapshot(legacySource);
  assert.deepEqual(lint(legacySource, baseline), []);
  const changed = legacySource.replace('value === 0', 'value === 0 || value === 99');
  assert.ok(lint(changed, baseline).some(message => message.ruleId === 'structure/complexity' && /Maximum allowed is 26/.test(message.message)));
});

test('new methods and classes cannot inherit a neighboring function budget', () => {
  const baseline = snapshot(legacySource);
  for (const added of [
    legacySource.replace('export class Legacy {', `export class Legacy { added(value: number): number { ${branchBody(21)} }`),
    `${legacySource}\nexport class NewClass { existing(value: number): number { ${branchBody(21)} } }`,
    `${legacySource}\nexport function added(value: number): number { ${branchBody(21)} }`
  ]) assert.ok(lint(added, baseline).some(message => message.ruleId === 'structure/complexity'));
});

test('a new 154-line method fails in a file with an existing longer method', () => {
  const old = `export class Legacy { existing(): number[] {\n${longBody(200)}\n} }`;
  const baseline = snapshot(old);
  assert.deepEqual(lint(old, baseline), []);
  const added = old.replace('export class Legacy {', `export class Legacy { added(): number[] {\n${longBody(150)}\n}\n`);
  assert.ok(lint(added, baseline).some(message => message.ruleId === 'structure/max-lines-per-function' && /Maximum allowed is 100/.test(message.message)));
});

test('new deeply nested functions cannot inherit a neighboring depth allowance', () => {
  const nested = count => `${'if (value) { '.repeat(count)}return;${' }'.repeat(count)}`;
  const old = `export function existing(value: boolean): void { ${nested(6)} }`;
  const baseline = snapshot(old);
  assert.deepEqual(lint(old, baseline), []);
  assert.ok(lint(`${old}\nexport function added(value: boolean): void { ${nested(5)} }`, baseline)
    .some(message => message.ruleId === 'structure/max-depth'));
});

test('scope identities survive comments, whitespace and insertion of unrelated methods', () => {
  const baseline = snapshot(legacySource);
  const reformatted = legacySource.replace('export class Legacy {', 'export class Legacy {\n// a comment\nsmall(): number { return 1; }\n');
  assert.deepEqual(lint(reformatted, baseline), []);
});

test('getter, setter, static and instance methods cannot share exceptions', () => {
  const getter = `declare const input: number; export class Legacy { get value(): number { ${branchBody(25).replaceAll('value', 'input')} } }`;
  const setter = `set value(value: number) { ${Array.from({ length: 21 }, (_, i) => `if (value === ${i}) return;`).join(' ')} }`;
  const withSetter = getter.replace('get value()', `${setter} get value()`);
  assert.ok(lint(withSetter, snapshot(getter)).some(message => message.ruleId === 'structure/complexity'));
  const staticMethod = legacySource.replace('existing(value:', 'static existing(value:');
  const withInstance = staticMethod.replace('export class Legacy {', `export class Legacy { existing(value: number): number { ${branchBody(21)} }`);
  assert.ok(lint(withInstance, snapshot(staticMethod)).some(message => message.ruleId === 'structure/complexity'));
});

test('anonymous callback exceptions do not transfer to a changed callback', () => {
  const old = `export const result = (() => {\n${longBody(110)}\n})();`;
  const baseline = snapshot(old);
  assert.deepEqual(lint(old, baseline), []);
  assert.deepEqual(lint(old.replace('rows.push(0);', '// comment\nrows.push(0);'), baseline), []);
  const changed = old.replace('rows.push(0);', 'rows.push(999);');
  assert.ok(lint(changed, baseline).some(message => message.ruleId === 'structure/max-lines-per-function' && message.messageId === 'exceed'));
});

test('class field initializers and static blocks have distinct owners', () => {
  const condition = Array.from({ length: 22 }, (_, i) => `value === ${i} ? ${i} :`).join(' ') + ' -1';
  const old = `const value = 1; export class Legacy { static field = ${condition}; static { let value = 1; ${branchBody(22).replaceAll('return ', 'value = ')} } }`;
  const baseline = snapshot(old);
  assert.deepEqual(lint(old, baseline), []);
  const added = `${old}\nexport class Other { static field = ${condition}; }`;
  assert.ok(lint(added, baseline).some(message => message.ruleId === 'structure/complexity'));
});

test('improvements and deleted functions require removal or tightening of stale budgets', () => {
  const baseline = snapshot(legacySource);
  const improved = legacySource.replace('if (value === 0) return 0;', '');
  assert.ok(lint(improved, baseline).some(message => message.messageId === 'outdatedBudget'));
  assert.ok(lint('export const removed = true;', baseline).some(message => message.messageId === 'outdatedBudget'));
});

test('file-size debt remains file-specific and cannot exempt functions', () => {
  const old = Array.from({ length: 810 }, (_, i) => `export const value${i} = ${i};`).join('\n');
  const baseline = snapshot(old);
  assert.deepEqual(lint(old, baseline), []);
  assert.ok(lint(`${old}\nexport const added = 811;`, baseline).some(message => message.ruleId === 'structure/max-lines'));
  assert.ok(lint(old.slice(0, old.lastIndexOf('\n')), baseline).some(message => message.messageId === 'outdatedBudget'));
  assert.ok(lint(old, baseline, 'apps/backend/src/app/new-file.ts').some(message => message.ruleId === 'structure/max-lines'));
});

test('pruning lowers or removes allowances and never adds or increases them', () => {
  const baseline = snapshot(legacySource);
  const scope = Object.keys(baseline.files[file].functions)[0];
  const frontend = 'apps/frontend/src/app/unchanged.ts';
  baseline.files[frontend] = structuredClone(baseline.files[file]);
  const improved = measureSource(legacySource.replace('if (value === 0) return 0;', ''), file);
  const next = tightenBaseline(baseline, { [file]: improved }, 'backend');
  assert.equal(next.files[file].functions[scope].complexity, 25);
  assert.deepEqual(next.files[frontend], baseline.files[frontend]);
  const worse = measureSource(legacySource.replace('value === 0', 'value === 0 || value === 99'), file);
  assert.deepEqual(tightenBaseline(baseline, { [file]: worse }, 'backend'), baseline);
  const removed = tightenBaseline(baseline, { [file]: measureSource('export const empty = true;', file) }, 'backend');
  assert.equal(removed.files[file], undefined);
  assert.deepEqual(baseline.files[file].functions[scope], { complexity: 26 });
});
