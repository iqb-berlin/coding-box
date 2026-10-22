import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Queue } from 'bullmq';
import { parseString } from 'fast-csv';
import AdmZip from 'adm-zip';

// Only the disposable, loopback-only scripts/e2e/codebook Compose fixture.
assert.equal(process.env.ITEM_MATRIX_DISPOSABLE_FIXTURE, 'true');
const api = 'http://127.0.0.1:3333/api';
const issuer = 'http://127.0.0.1:18441/realms/codebook-proof';
const output = path.resolve(process.env.ITEM_MATRIX_PROOF_DIR || 'dist/item-matrix-proof');
const database = new pg.Client({ host: '127.0.0.1', port: 15441,
  user: 'codebook_test', password: 'disposable_test_only', database: 'codebook_test' });
const queue = new Queue('data-export', { connection: { host: '127.0.0.1', port: 16441 }, prefix: 'item-matrix-proof:bullmq' });
const authentication = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'codebook-proof',
    username: 'codebook-proof-admin', password: 'disposable_test_only' })
});
assert(authentication.ok, `Fixture authentication: ${authentication.status}`);
const { access_token: token } = await authentication.json();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(route, body, method = body ? 'POST' : 'GET', expected = 200) {
  const response = await fetch(`${api}${route}`, { method, signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, expected, `${method} ${route}: ${await response.clone().text()}`);
  return response;
}
const json = async (route, body, method, expected) => (await request(route, body, method, expected)).json();
async function insert(table, data) {
  const keys = Object.keys(data);
  const result = await database.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')})
    VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(data));
  return result.rows[0].id;
}
async function responseFingerprint(workspace) {
  return (await database.query(`SELECT md5(string_agg(row_to_json(r)::text, '' ORDER BY r.id)) AS fingerprint
    FROM response r JOIN unit u ON u.id=r.unitid JOIN booklet b ON b.id=u.bookletid
    JOIN persons p ON p.id=b.personid WHERE p.workspace_id=$1`, [workspace])).rows[0].fingerprint;
}
async function csvRows(bytes) {
  return new Promise((resolve, reject) => {
    const rows = [];
    parseString(bytes.toString('utf8').replace(/^\uFEFF/, ''), { headers: true, delimiter: ';' })
      .on('data', row => rows.push(row)).on('error', reject).on('end', () => resolve(rows));
  });
}
async function archivedBytes(workspace, archiveId) {
  return Buffer.from(await (await request(`/admin/workspace/${workspace}/coding/export/item-matrix-diagnostics/${archiveId}/download`)).arrayBuffer());
}
async function assertJobAndCacheRemoved(jobId) {
  assert.equal(await queue.getJob(jobId), undefined);
  for (const key of ['item-matrix-diagnostics', 'item-matrix-incomplete-result', 'export-result']) {
    assert.equal(await (await queue.getBackend().client).runCommand('get', [`item-matrix-proof:cache:${key}:${jobId}`]), null);
  }
}
await database.connect();
await mkdir(output, { recursive: true });
try {
  if (process.argv.includes('--after-restart')) {
    const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
    const entries = await json(`/admin/workspace/${report.workspaceId}/coding/export/item-matrix-diagnostics`);
    for (const proof of report.exports) {
      assert(entries.some(entry => entry.archiveId === proof.archiveId));
      await assertJobAndCacheRemoved(proof.jobId);
      assert.equal(hash(await archivedBytes(report.workspaceId, proof.archiveId)), proof.csvSha256);
      assert.equal((await fetch(`${api}/admin/workspace/${report.workspaceId}/coding/export/item-matrix-diagnostics/${proof.archiveId}/download`)).status, 401);
    }
    assert.equal(await responseFingerprint(report.workspaceId), report.responseFingerprint);
    report.afterApiAndWorkerRestart = true;
    report.unauthenticatedDownloadDenied = true;
    report.verificationRunnerSha256 = hash(await readFile(new URL(import.meta.url)));
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ workspaceId: report.workspaceId, afterApiAndWorkerRestart: true, archives: entries.length }));
  } else {
    const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      createdAt: new Date().toISOString(), synthetic: true, persons: 2740, expectedCells: 5480,
      backendSha256: hash(await readFile('dist/apps/backend/main.js')), exports: [] };
    const workspace = Number(await json('/admin/workspace', { name: `Item matrix proof ${Date.now()}`, settings: {} }, 'POST', 201));
    report.workspaceId = workspace;
    let nextFile = Number((await database.query('SELECT coalesce(max(id),104100) AS id FROM file_upload')).rows[0].id);
    async function file(name, type, data) {
      return insert('file_upload', { id: ++nextFile, filename: name, file_type: type, file_id: name.toUpperCase(),
        file_id_normalized: name.toUpperCase(), coding_scheme_ref_normalized: type === 'Unit' ? 'DIAG.VOCS' : null,
        workspace_id: workspace, file_size: Buffer.byteLength(data), data, created_at: new Date() });
    }
    const base = id => ({ id, alias: id, sourceType: 'BASE', sourceParameters: {}, deriveSources: [], processing: [], codes: [] });
    await file('DIAG.VOCS', 'Resource', JSON.stringify({ version: '3.4', variableCodings: [
      base('valid'), base('invalid'),
      { ...base('missing'), sourceType: 'SUM_SCORE', deriveSources: ['valid'] },
      { ...base('unresolved'), sourceType: 'SUM_SCORE', deriveSources: ['invalid'] }
    ] }));
    await file('DIAG', 'Unit', '<Unit><Metadata><Id>DIAG</Id></Metadata><CodingSchemeRef>DIAG.VOCS</CodingSchemeRef><BaseVariables><Variable id="valid" alias="valid" type="number" multiple="false" nullable="false"/><Variable id="invalid" alias="invalid" type="number" multiple="false" nullable="false"/></BaseVariables></Unit>');
    await file('DIAG.VOMD', 'Resource', JSON.stringify({ items: [
      { id: 'MISSING', variableId: 'missing' }, { id: 'UNRESOLVED', variableId: 'unresolved' }
    ] }));
    await file('DIAG-BOOKLET', 'Booklet', '<Booklet><Units><Unit id="DIAG"/></Units></Booklet>');
    const profile = await insert('missings_profile', { workspace_id: workspace, label: 'Matrix proof',
      missings: JSON.stringify(['mir','mbi_mbo','mnr','mci','mbd'].map((id, i) => ({ id, label: id, code: -90 - i, score: null }))) });
    const info = await insert('bookletinfo', { name: 'DIAG-BOOKLET', size: 0 });
    await database.query(`WITH people AS (
      INSERT INTO persons (login,code,"group",workspace_id,uploaded_at,booklets,source,consider)
      SELECT 'diag-' || lpad(i::text,4,'0'),'proof','synthetic',$1,now(),'[]','synthetic',true
      FROM generate_series(1,2740) i RETURNING id
    ), booklets AS (
      INSERT INTO booklet (infoid,personid) SELECT $2,id FROM people RETURNING id
    ), units AS (
      INSERT INTO unit (bookletid,name,alias) SELECT id,'DIAG','DIAG' FROM booklets RETURNING id
    ) INSERT INTO response (unitid,variableid,status,value,subform,status_v2,code_v2,score_v2)
      SELECT u.id,v.variable,3,'1','',v.status,v.code,v.score FROM units u CROSS JOIN
      (VALUES ('valid',5,1,1),('invalid',64,NULL::integer,NULL::integer)) v(variable,status,code,score)`, [workspace, info]);
    report.responseFingerprint = await responseFingerprint(workspace);
    const selection = await json(`/admin/workspace/${workspace}/coding/export/item-dataset-options`);
    assert.deepEqual(selection.mappingIssues, []);
    assert.equal(selection.items.length, 2);
    for (const [format, matrixValue] of [['csv','score'],['excel','code']]) {
      const started = await json(`/admin/workspace/${workspace}/coding/export/start`, {
        exportType: 'item-matrix', version: 'v2', format, matrixValue, missingsProfileId: profile,
        items: selection.items.map(({ unitId, itemId }) => ({ unitId, itemId }))
      }, 'POST', 201);
      let status;
      const deadline = Date.now() + 120000;
      do {
        status = await json(`/admin/workspace/${workspace}/coding/export/job/${started.jobId}`);
        if (['completed','failed'].includes(status.status)) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      } while (Date.now() < deadline);
      assert.equal(status.status, 'failed', JSON.stringify(status));
      assert.equal(status.errorCode, 'ITEM_MATRIX_UNRESOLVED_CELLS');
      assert.equal(status.errorDetails.total, 5480);
      const job = await queue.getJob(started.jobId);
      assert.equal(await job.getState(), 'failed');
      assert(job.processedOn && job.finishedOn);
      const entries = await json(`/admin/workspace/${workspace}/coding/export/item-matrix-diagnostics`);
      const entry = entries.find(value => value.jobId === started.jobId);
      assert(entry, 'Real worker published the archive');
      const csv = await archivedBytes(workspace, entry.archiveId);
      const rows = await csvRows(csv);
      assert.equal(rows.length, 5480);
      const reasons = rows.reduce((counts, row) => ({ ...counts, [row.reason_code]: (counts[row.reason_code] || 0) + 1 }), {});
      assert.deepEqual(reasons, { 'derived-result-missing': 2740, 'derived-source-unresolved': 2740 });
      assert(rows.every(row => /^diag-\d{4}$/.test(row.person_login) && Number(row.zeile) >= 2 && [5,6].includes(Number(row.spaltennummer))));
      const zip = new AdmZip(Buffer.from(await (await request(`/admin/workspace/${workspace}/coding/export/job/${started.jobId}/download-incomplete`)).arrayBuffer()));
      assert.equal(hash(zip.readFile('diagnose.csv')), hash(csv));
      assert(zip.getEntry('diagnose-gruppiert.csv') && zip.getEntry('README.txt'));
      await writeFile(path.join(output, `${format}-${matrixValue}.csv`), csv);
      assert.equal((await json(`/admin/workspace/${workspace}/coding/export/job/${started.jobId}`, undefined, 'DELETE')).success, true);
      await assertJobAndCacheRemoved(started.jobId);
      assert.equal(hash(await archivedBytes(workspace, entry.archiveId)), hash(csv));
      assert.equal((await fetch(`${api}/admin/workspace/${workspace}/coding/export/item-matrix-diagnostics/${entry.archiveId}/download`)).status, 401);
      const other = Number(await json('/admin/workspace', { name: 'Matrix isolation proof', settings: {} }, 'POST', 201));
      await request(`/admin/workspace/${other}/coding/export/item-matrix-diagnostics/${entry.archiveId}/download`, undefined, 'GET', 404);
      report.exports.push({ format, matrixValue, jobId: started.jobId, archiveId: entry.archiveId,
        cells: rows.length, reasons, csvSha256: hash(csv), workerProcessedOn: job.processedOn,
        workerFinishedOn: job.finishedOn, queueAndCacheRemoved: true, crossWorkspaceDenied: true });
    }
    assert.equal(report.exports[0].csvSha256, report.exports[1].csvSha256, 'Deterministic cell coordinates across CSV/Excel and score/code');
    assert.equal(await responseFingerprint(workspace), report.responseFingerprint, 'Export did not mutate responses');
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  await queue.close();
  await database.end();
}
