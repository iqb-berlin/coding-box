import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  flattenCatalog, parseCatalog, validateCatalogs, validateTranslationSource, validateWorkspaceTranslations
} from './translation-catalog.mjs';

const de = { 'ui-text': { jobs: { created: '{{count}} Jobs für {{person.name}} erstellt', empty: 'Keine Jobs' } } };

test('catalogs support legacy dotted IDs and reject ambiguous or non-text entries', () => {
  assert.equal(flattenCatalog({ 'job.created': 'Erstellt' }).get('job.created'), 'Erstellt');
  assert.throws(() => flattenCatalog({ 'job.created': 'Erstellt', job: { created: 'Duplikat' } }), /Duplicate translation ID/);
  assert.throws(() => flattenCatalog({ jobs: ['Erstellt'] }), /must be a string/);
  assert.throws(() => parseCatalog('{"jobs":{"created":"A","created":"B"}}', 'de.json'), /duplicate JSON property: created/);
  assert.deepEqual(parseCatalog('{"jobs":{"created":"A"},"notes":{"created":"B"}}', 'de.json'), {
    jobs: { created: 'A' }, notes: { created: 'B' }
  });
});

test('a new language must preserve IDs and placeholders while allowing different word order', () => {
  const en = { 'ui-text': { jobs: { created: 'Created {{count}} jobs for {{person.name}}', empty: 'No jobs' } } };
  assert.deepEqual(validateCatalogs({ de, en }), []);
  assert.deepEqual(validateCatalogs({ de }), []); // English is not required before it is offered.
  en['ui-text'].jobs.created = 'Created {{total}} jobs';
  delete en['ui-text'].jobs.empty;
  en['ui-text'].jobs.emtpy = 'No jobs';
  const issues = validateCatalogs({ de, en }).join('\n');
  assert.match(issues, /placeholders differ.*jobs.created/);
  assert.match(issues, /missing translation.*jobs.empty/);
  assert.match(issues, /unknown translation ID.*jobs.emtpy/);
});

test('managed IDs are short and contextual and messages contain no translation expressions', () => {
  const issues = validateCatalogs({ de: { 'ui-text': { jobs: {
    ['this-key-is-a-copied-sentence-that-keeps-changing-with-the-visible-label']: 'Label',
    'empty-a1b2c3': 'No jobs',
    embedded: "{{ 'ui-text.jobs.empty' | translate }}"
  } } } }).join('\n');
  assert.match(issues, /short contextual translation IDs.*this-key/);
  assert.match(issues, /short contextual translation IDs.*empty-a1b2c3/);
  assert.match(issues, /embedded translation expression/);
  assert.match(validateCatalogs({ de: { 'ui-text': { 'jobs.empty': 'No jobs' } } }).join('\n'), /use nested objects/);
});

test('TypeScript calls and message constants detect missing keys and known missing parameters', () => {
  const source = `
    const key = 'ui-text.jobs.emtpy';
    translate('ui-text.jobs.created', { total: 2 });
    this.uiTranslate('ui-text.jobs.created', { count: 2, person: { name: 'Ada' } });
    this.translate.instant('ui-text.jobs.empty');
    translate('ui-text.jobs.created', parameters);
  `;
  const issues = validateTranslationSource(source, 'probe.ts', de);
  assert.equal(issues.length, 3, issues.join('\n'));
  assert.match(issues[0], /probe.ts:2: unknown translation ID.*emtpy/);
  assert.match(issues[1], /missing parameter 'count'/);
  assert.match(issues[2], /missing parameter 'person.name'/);
});

test('external and inline Angular templates check nested pipes and parameter maps', () => {
  const template = `<p>{{ visible ? ('ui-text.jobs.created' | translate: { total: 2 }) : ('ui-text.jobs.empty' | translate) }}</p>`;
  for (const [source, file] of [[template, 'probe.html'], [`@Component({ template: \`${template}\` }) class Probe {}`, 'probe.ts']]) {
    const issues = validateTranslationSource(source, file, de);
    assert.equal(issues.length, 2, issues.join('\n'));
    assert.match(issues.join('\n'), /missing parameter 'count'/);
    assert.match(issues.join('\n'), /missing parameter 'person.name'/);
  }
  assert.deepEqual(validateTranslationSource(
    `<p>{{ 'ui-text.jobs.created' | translate: { count: 2, person: person } }}</p>`, 'probe.html', de
  ), []);
});

test('an unresolved parameter object is deferred to integration tests, not treated as empty', () => {
  assert.deepEqual(validateTranslationSource(
    `<p>{{ 'ui-text.jobs.created' | translate: parameters }}</p>`, 'probe.html', de
  ), []);
  assert.deepEqual(validateTranslationSource(
    `translate('ui-text.jobs.created', { ...parameters });`, 'probe.ts', de
  ), []);
  assert.match(validateTranslationSource(
    `translate('ui-text.jobs.created');`, 'probe.ts', de
  ).join('\n'), /missing parameter 'count'/);
});

test('application catalogs, managed IDs and statically known interpolation parameters are consistent', () => {
  const workspace = fileURLToPath(new URL('../..', import.meta.url));
  const issues = validateWorkspaceTranslations(workspace);
  assert.deepEqual(issues, [], issues.join('\n'));
});
