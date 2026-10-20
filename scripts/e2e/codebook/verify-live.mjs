import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import Bull from 'bull';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { CodingSchemeFactory as Reference } from '@iqb/responses-legacy-reference';
import { hashFrontendArtifact } from '../../qa/hash-frontend-artifact.mjs';
import { loadStudioReference, normalizedDocx } from './studio-reference.mjs';

// This fixture only supports the dedicated local Compose database and queue.
// Data is synthetic; seeding is direct SQL, all jobs and downloads use HTTP.
const api = 'http://127.0.0.1:3333/api';
const output = process.env.CODEBOOK_PROOF_DIR || '/tmp/codebook-1041-evidence/live';
const db = new pg.Client({ host: '127.0.0.1', port: 15441, user: 'codebook_test', password: 'disposable_test_only', database: 'codebook_test' });
const queues = new Map();
const report = { createdAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), seeding: 'synthetic direct SQL in dedicated Compose database', exports: [], autocoder: [] };
const issuer = 'http://127.0.0.1:18441/realms/codebook-proof';
const authentication = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: 'POST',
  signal: AbortSignal.timeout(10000),
  body: new URLSearchParams({
    grant_type: 'password', client_id: 'codebook-proof',
    username: 'codebook-proof-admin', password: 'disposable_test_only'
  })
});
assert(authentication.ok, `Disposable Keycloak authentication: HTTP ${authentication.status}`);
const { access_token: token } = await authentication.json();
assert(typeof token === 'string' && token.length > 0, 'Keycloak returned an access token');
report.authentication = { protocol: 'OIDC', issuer, clientId: 'codebook-proof', tokenSource: 'dedicated local Keycloak realm' };
async function request(path, body) {
  const res = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert(res.ok, `${path}: HTTP ${res.status}: ${res.ok ? '' : await res.text()}`);
  return res;
}
async function json(path, body) { return (await request(path, body)).json(); }
async function insert(table, data) {
  const keys = Object.keys(data);
  const result = await db.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(data));
  return result.rows[0].id;
}
function queue(name) {
  if (!queues.has(name)) queues.set(name, new Bull(name, { redis: { host: '127.0.0.1', port: 16441 }, prefix: 'codebook-proof' }));
  return queues.get(name);
}
async function finishJob(name, id, statusPath, expected = 'completed') {
  const history = [];
  const deadline = Date.now() + 60000;
  let status;
  do {
    status = await json(statusPath);
    history.push(status);
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(status.status, expected, JSON.stringify(status));
  const job = await queue(name).getJob(id);
  assert(job, 'Job exists in real Redis');
  assert.equal(await job.getState(), expected);
  assert(job.processedOn && job.finishedOn, 'Worker actually processed the queued job');
  return { id, history, queue: { name, state: await job.getState(), processedOn: job.processedOn, finishedOn: job.finishedOn, attemptsMade: job.attemptsMade, failedReason: job.failedReason, data: job.data, result: job.returnvalue } };
}
const baseCoding = (id, alias) => ({ id, alias, label: alias, sourceType: 'BASE', sourceParameters: {}, deriveSources: [], processing: [], manualInstruction: `<p>GENERAL-${id}</p>`, codes: [{ id: 0, type: 'FULL_CREDIT', label: 'Richtig', score: 0, manualInstruction: `<p>Bewerten ${id}</p>`, ruleSets: [], ruleSetOperatorAnd: true }] });
const options = { exportFormat: 'json', missingsProfile: '', hasOnlyManualCoding: true, hasGeneralInstructions: true, hasDerivedVars: true, hasOnlyVarsWithCodes: true, hasClosedVars: false, codeLabelToUpper: false, showScore: true, hideItemVarRelation: false, trainingRequirement: 'all' };
const statuses = ['UNSET','NOT_REACHED','DISPLAYED','VALUE_CHANGED','DERIVE_ERROR','CODING_COMPLETE','NO_CODING','INVALID','CODING_INCOMPLETE','CODING_ERROR','PARTLY_DISPLAYED','DERIVE_PENDING','INTENDED_INCOMPLETE','CODE_SELECTION_PENDING'];
await mkdir(output, { recursive: true });
await db.connect();
try {
  const schema = await db.query('SELECT count(*)::int AS n FROM databasechangelog');
  assert.equal(schema.rows[0].n, 163);
  report.migrations = schema.rows[0].n;
  report.backendArtifactSha256 = createHash('sha256').update(await readFile('dist/apps/backend/main.js')).digest('hex');
  report.frontendArtifactSha256 = await hashFrontendArtifact('dist/apps/frontend');
  report.runnerSha256 = createHash('sha256').update(await readFile('scripts/e2e/codebook/verify-live.mjs')).digest('hex');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const codebookPackage = lock.packages['node_modules/@iqb/ngx-coding-components'];
  report.packageVersion = codebookPackage.version;
  report.packageIntegrity = codebookPackage.integrity;
  assert.match(report.packageIntegrity, /^sha512-/);
  const studio = process.env.STUDIO_REFERENCE_ROOT ? await loadStudioReference(process.env.STUDIO_REFERENCE_ROOT) : null;
  if (studio) {
    assert.equal(studio.metadata.packageVersion, report.packageVersion);
    assert.equal(studio.metadata.packageIntegrity, report.packageIntegrity);
    report.studio = studio.metadata;
  }
  const workspace = Number(await json('/admin/workspace', { name: `Codebook proof ${Date.now()}`, settings: {} }));
  assert(Number.isSafeInteger(workspace) && workspace > 0);
  report.workspaceId = workspace;
  let fileId = Number((await db.query('SELECT coalesce(max(id),104100) AS id FROM file_upload')).rows[0].id);
  async function file(name, type, data, metadata = null) {
    return insert('file_upload', { id: ++fileId, filename: name, workspace_id: workspace, file_size: Buffer.byteLength(data), file_type: type, file_id: name.toUpperCase(), file_id_normalized: name.toUpperCase(), coding_scheme_ref_normalized: type === 'Unit' ? name.toUpperCase() + '.VOCS' : null, created_at: new Date(), data, structured_data: metadata });
  }
  const variables = [baseCoding('idA', 'idB'), baseCoding('idB', 'idA')];
  const unitId = await file('UNIT.VOCS', 'Resource', JSON.stringify({ version: '3.4', variableCodings: variables }), { metadata: { items: [{ id: 'ITEM-A', variableId: 'idA' }, { id: 'ITEM-B', variableId: 'idB' }, { key: 'LEGACY-A', idB: 0 }, { key: 'LEGACY-B', idA: false }] } });
  const missing = [{ code: -99, label: 'PROOF-MISSING', description: 'Synthetic missing description' }];
  const profileId = await insert('missings_profile', { workspace_id: workspace, label: 'Proof profile', missings: JSON.stringify(missing) });
  const jobId = await insert('job_definitions', { workspace_id: workspace, name: 'Proof filter', distribution_seed: 'proof', assigned_variables: JSON.stringify([{ unitName: 'UNIT', variableId: 'idB' }]) });
  const bundleId = await insert('variable_bundle', { workspace_id: workspace, name: 'Proof bundle', variables: JSON.stringify([{ unitName: 'UNIT', variableId: 'idB' }]) });
  const reverseBundleId = await insert('variable_bundle', { workspace_id: workspace, name: 'Other bundle', variables: JSON.stringify([{ unitName: 'UNIT', variableId: 'idA' }]) });
  const partialVariables = [...variables, baseCoding('third', 'C')];
  const partialUnitId = await file('INTERSECTION.VOCS', 'Resource', JSON.stringify({ version: '3.4', variableCodings: partialVariables }), { metadata: { items: [{ id: 'ITEM-A', variableId: 'idA' }, { id: 'ITEM-B', variableId: 'idB' }, { id: 'ITEM-C', variableId: 'third' }] } });
  const partialJobId = await insert('job_definitions', { workspace_id: workspace, name: 'Partial filter', distribution_seed: 'proof', assigned_variables: JSON.stringify([{ unitName: 'INTERSECTION', variableId: 'idB' }, { unitName: 'INTERSECTION', variableId: 'C' }]) });
  const partialBundleId = await insert('variable_bundle', { workspace_id: workspace, name: 'Partial bundle', variables: JSON.stringify([{ unitName: 'INTERSECTION', variableId: 'idA' }, { unitName: 'INTERSECTION', variableId: 'C' }]) });
  for (const scope of [
    { name: 'all', filter: {}, aliases: ['idA','idB'], items: [['ITEM-B','LEGACY-B'],['ITEM-A','LEGACY-A']] },
    { name: 'job', filter: { jobDefinitionId: jobId }, aliases: ['idB'], items: [['ITEM-A','LEGACY-A']] },
    { name: 'bundle', filter: { variableBundleIds: [bundleId] }, aliases: ['idB'], items: [['ITEM-A','LEGACY-A']] },
    { name: 'intersection', filter: { jobDefinitionId: jobId, variableBundleIds: [bundleId] }, aliases: ['idB'], items: [['ITEM-A','LEGACY-A']] },
    { name: 'partial-intersection', unitId: partialUnitId, unitKey: 'INTERSECTION', variables: partialVariables, filter: { jobDefinitionId: partialJobId, variableBundleIds: [partialBundleId] }, aliases: ['C'], items: [['ITEM-C']] },
    { name: 'reverse', filter: { variableBundleIds: [reverseBundleId] }, aliases: ['idA'], items: [['ITEM-B','LEGACY-B']] }
  ]) {
    for (const show of [true, false]) {
      for (const format of ['json','docx']) {
        const contentOptions = { ...options, ...scope.filter, showScore: show, hasGeneralInstructions: show, exportFormat: format, missingsProfile: String(profileId) };
        const started = await json(`/admin/workspace/${workspace}/coding/codebook/job`, { missingsProfile: profileId, contentOptions, unitList: [scope.unitId ?? unitId] });
        const proof = await finishJob('codebook-generation', started.jobId, `/admin/workspace/${workspace}/coding/codebook/job/${started.jobId}`);
        const response = await request(`/admin/workspace/${workspace}/coding/codebook/job/${started.jobId}/download`);
        assert.match(response.headers.get('content-disposition'), new RegExp(`codebook\\.${format}`));
        const bytes = Buffer.from(await response.arrayBuffer());
        const filename = `${scope.name}-${show ? 'instructions-score' : 'plain'}.${format}`;
        await writeFile(`${output}/${filename}`, bytes);
        if (format === 'json') {
          const [unit] = JSON.parse(bytes.toString());
          assert.deepEqual(unit.variables.map(v => v.id), scope.aliases);
          assert.deepEqual(unit.missings, missing);
          for (const v of unit.variables) {
            assert.equal(Boolean(v.generalInstruction), show);
            assert.equal(Object.hasOwn(v.codes[0], 'score'), show);
            assert.match(v.codes[0].description, /Bewerten/);
          }
        } else {
          const xml = new AdmZip(bytes).readAsText('word/document.xml');
          const $ = load(xml, { xml: true });
          const paragraphs = $('w\\:body').children('w\\:p').toArray().map(p => $(p).find('w\\:t').text());
          assert.deepEqual(paragraphs.filter(p => p.startsWith('Item(s):')).map(p => p.slice('Item(s):'.length).trim().split(/\s+/)), scope.items);
          assert.equal(xml.includes('GENERAL-'), show);
          assert.equal($('w\\:tbl').first().find('w\\:tr').first().children('w\\:tc').length, show ? 4 : 3, 'Score column follows the selected option');
          assert(xml.includes('PROOF-MISSING'));
        }
        if (studio) {
          const selected = (scope.variables ?? variables).filter(v => scope.aliases.includes(v.alias));
          const items = selected.flatMap(v => scope.items[scope.aliases.indexOf(v.alias)].map(id => ({ id, variableId: v.id })));
          const reference = await studio.generate({ id: 1, key: scope.unitKey ?? 'UNIT', name: scope.unitKey ?? 'UNIT', scheme: JSON.stringify({ version: '3.4', variableCodings: selected }), metadata: { items } }, contentOptions, missing);
          if (format === 'json') assert.deepEqual(JSON.parse(bytes.toString()), JSON.parse(reference.toString()));
          else assert.deepEqual(normalizedDocx(bytes), normalizedDocx(reference));
        }
        report.exports.push({ studioEqual: Boolean(studio), filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, expectedAliases: scope.aliases, expectedItems: scope.items, options: contentOptions, ...proof });
      }
    }
  }
  const invalidScope = await json(`/admin/workspace/${workspace}/coding/codebook/job`, { missingsProfile: profileId, contentOptions: { ...options, jobDefinitionId: jobId, variableBundleIds: [reverseBundleId] }, unitList: [unitId] });
  report.failedExport = await finishJob('codebook-generation', invalidScope.jobId, `/admin/workspace/${workspace}/coding/codebook/job/${invalidScope.jobId}`, 'failed');
  assert.match(report.failedExport.queue.failedReason, /keine passenden Variablen/);
  const rejectedDownload = await fetch(`${api}/admin/workspace/${workspace}/coding/codebook/job/${invalidScope.jobId}/download`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(rejectedDownload.status, 404);
  const person = await insert('persons', { login: 'synthetic', code: 'proof', group: 'solver', workspace_id: workspace, uploaded_at: new Date(), booklets: '[]', source: 'synthetic', consider: true });
  const info = await insert('bookletinfo', { name: `Proof ${workspace}`, size: 0 });
  const booklet = await insert('booklet', { infoid: info, personid: person });
  const cases = [
    ['ceil', '0.000000000000001', 'ceil(${A})', 'CODING_COMPLETE', 1],
    ['equality', '0.000000000000001', '${A} == 0 ? 1 : 0', 'CODING_COMPLETE', 0],
    ['null', '1', '${A} > 0 ? null : ${A}', 'DERIVE_ERROR', null],
    ['infinity', '1', '${A}/0', 'DERIVE_ERROR', null],
    ['config', '1', 'config({epsilon: 1})', 'DERIVE_ERROR', null],
    ['exponent-string', '1e-15', 'ceil(${A})', 'DERIVE_ERROR', null]
  ];
  const expectedRows = [];
  for (const [name, value, expression, status, code] of cases) {
    const unitName = `SOLVER-${name.toUpperCase()}`;
    const codes = [{ id: 9, type: 'FULL_CREDIT', score: 9, ruleSets: [{ rules: [{ method: 'IS_NULL' }] }] }, ...[0,1].map(id => ({ id, type: 'FULL_CREDIT', score: id, ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH', parameters: [String(id)] }] }] })), { id: 3, type: 'RESIDUAL_AUTO', score: 3, ruleSets: [] }];
    const variableCodings = [
      { ...baseCoding('source', 'A'), codes: [] },
      { ...baseCoding('derived', 'D'), sourceType: 'SOLVER', deriveSources: ['source'], sourceParameters: { processing: [], solverExpression: expression }, codes },
      { ...baseCoding('sum', 'T'), sourceType: 'SUM_SCORE', deriveSources: ['derived'], sourceParameters: { processing: [] }, codes }
    ];
    await file(unitName + '.VOCS', 'Resource', JSON.stringify({ version: '3.4', variableCodings }));
    await file(unitName, 'Unit', `<Unit><Metadata><Id>${unitName}</Id></Metadata><CodingSchemeRef>${unitName}.VOCS</CodingSchemeRef><BaseVariables><Variable id="source" alias="A" type="number" multiple="false" nullable="false" /></BaseVariables></Unit>`);
    const unit = await insert('unit', { bookletid: booklet, name: unitName, alias: unitName });
    await insert('response', { unitid: unit, variableid: 'A', status: 3, value: String(value), subform: 'part-a' });
    const reference = Reference.code([{ id: 'A', value, status: 'VALUE_CHANGED', subform: 'part-a' }], structuredClone(variableCodings));
    const derived = reference.find(r => r.id === 'D');
    assert.equal(derived.status, status, name);
    assert.equal(derived.code ?? null, code, name);
    expectedRows.push({ unit, name, reference });
  }
  const badName = 'SOLVER-INVALID-NAMESPACE';
  const badCodings = [baseCoding('source', 'A'), { ...baseCoding('duplicate', 'A'), sourceType: 'COPY_VALUE', deriveSources: ['source'] }];
  await file(badName + '.VOCS', 'Resource', JSON.stringify({ version: '3.4', variableCodings: badCodings }));
  await file(badName, 'Unit', `<Unit><Metadata><Id>${badName}</Id></Metadata><CodingSchemeRef>${badName}.VOCS</CodingSchemeRef><BaseVariables><Variable id="source" alias="A" type="number" multiple="false" nullable="false" /></BaseVariables></Unit>`);
  const badPerson = await insert('persons', { login: 'synthetic-invalid', code: 'proof', group: 'invalid', workspace_id: workspace, uploaded_at: new Date(), booklets: '[]', source: 'synthetic', consider: true });
  const badBooklet = await insert('booklet', { infoid: info, personid: badPerson });
  const badUnit = await insert('unit', { bookletid: badBooklet, name: badName, alias: badName });
  await insert('response', { unitid: badUnit, variableid: 'A', status: 3, value: '1', subform: 'part-a' });
  const started = await json(`/admin/workspace/${workspace}/coding?testPersons=${person}&autoCoderRun=1`);
  const proof = await finishJob('test-person-coding', started.jobId, `/admin/workspace/${workspace}/coding/job/${started.jobId}`);
  for (const { unit, name, reference } of expectedRows) {
    const { rows } = await db.query('SELECT variableid,value,subform,status_v1,code_v1,score_v1,is_autocoder_generated FROM response WHERE unitid=$1 ORDER BY variableid', [unit]);
    assert.equal(rows.length, reference.length, name);
    for (const expected of reference) {
      const actual = rows.find(r => r.variableid === expected.id);
      assert(actual, `${name}: ${expected.id}`);
      assert.equal(actual.status_v1, statuses.indexOf(expected.status), `${name}/${expected.id}: status`);
      assert.equal(actual.code_v1 === null ? null : Number(actual.code_v1), expected.code ?? null, `${name}/${expected.id}: code`);
      assert.equal(actual.score_v1 === null ? null : Number(actual.score_v1), expected.score ?? null, `${name}/${expected.id}: score`);
      assert.equal(actual.subform, expected.subform);
      if (expected.id !== 'A') assert(actual.is_autocoder_generated);
    }
    report.autocoder.push({ name, unit, reference, persisted: rows });
  }
  report.autocoderJob = proof;
  const snapshotSql = 'SELECT response.* FROM response JOIN unit ON unit.id=response.unitid JOIN booklet ON booklet.id=unit.bookletid WHERE booklet.personid=ANY($1::int[]) ORDER BY response.id';
  const beforeFailure = (await db.query(snapshotSql, [[person, badPerson]])).rows;
  const failedStart = await json(`/admin/workspace/${workspace}/coding?testPersons=${badPerson}&autoCoderRun=1`);
  report.failedAutocoder = await finishJob('test-person-coding', failedStart.jobId, `/admin/workspace/${workspace}/coding/job/${failedStart.jobId}`, 'failed');
  assert.match(report.failedAutocoder.queue.failedReason, /duplicate output alias/);
  assert.deepEqual((await db.query(snapshotSql, [[person, badPerson]])).rows, beforeFailure, 'Failed whole-job preflight must not alter persisted responses');
  report.failedAutocoder.persistenceUnchanged = true;
  report.passed = true;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, exports: report.exports.length, solverCases: report.autocoder.length, output }));
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally {
  await Promise.all([...queues.values()].map(q => q.close()));
  await db.end();
}
