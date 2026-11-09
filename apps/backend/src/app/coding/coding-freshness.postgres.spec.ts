import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { CodingUnitFreshness } from '../database/entities/coding-unit-freshness.entity';
import { CodingFreshnessService } from '../database/services/coding/coding-freshness.service';
import { CodingFreshnessModule } from './coding-freshness.module';
import { NO_CODING_SCHEME_REF_NORMALIZED } from '../database/entities/file_upload.entity';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Standalone coding freshness module with PostgreSQL', () => {
  const databaseName = `freshness_${process.pid}_${Date.now()}`;
  const connection = {
    type: 'postgres' as const,
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    username: process.env.POSTGRES_USER || 'root',
    password: process.env.POSTGRES_PASSWORD || 'root-password',
    database: process.env.POSTGRES_DB || 'coding-box',
    extra: { max: 2 }
  };
  let admin: DataSource;
  let db: DataSource;
  let module: TestingModule;
  let service: CodingFreshnessService;
  let created = false;

  beforeAll(async () => {
    admin = await new DataSource(connection).initialize();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const changelogRoot = path.resolve('database/changelog');
    const changelog = readFileSync(path.join(changelogRoot, 'coding-box.changelog-root.xml'), 'utf8');
    for (const [, file] of changelog.matchAll(/<include file="([^"]+)"/g)) {
      const input = readFileSync(path.join(changelogRoot, file), 'utf8').split(/^-- changeset /m).slice(1).map(chunk => {
        const end = chunk.indexOf('\n');
        const sql = chunk.slice(end + 1);
        return chunk.slice(0, end).includes('runInTransaction:false') ? sql : `BEGIN;\n${sql}\nCOMMIT;`;
      })
        .join('\n');
      execFileSync(process.env.PSQL_BIN || 'psql', [
        '-h', connection.host, '-p', String(connection.port), '-U', connection.username,
        '-d', databaseName, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'
      ], { input, stdio: 'pipe', env: { ...process.env, PGPASSWORD: connection.password } });
    }
    // Real module, repositories and exclusions; only the external cache socket is replaced.
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          ...connection,
          database: databaseName,
          synchronize: false,
          entities: [path.resolve(__dirname, '../database/entities/*.entity.ts')]
        }),
        CodingFreshnessModule
      ]
    })
      .overrideProvider(getRedisConnectionToken()).useValue({ disconnect: jest.fn() })
      .overrideProvider(CacheService)
      .useValue({ get: async () => null, set: async () => undefined })
      .compile();
    db = module.get(DataSource);
    service = module.get(CodingFreshnessService);
  }, 60000);

  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      if (admin?.isInitialized) {
        try {
          if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        } finally { await admin.destroy(); }
      }
    }
  });

  const insert = async (table: string, values: Record<string, unknown>): Promise<number> => {
    const columns = Object.keys(values);
    const [row] = await db.query(
      `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(values)
    );
    return row.id;
  };

  const fixture = async () => {
    const workspace = await insert('workspace', { name: 'Freshness fixture' });
    const person = await insert('persons', {
      workspace_id: workspace, group: 'group', login: `person-${workspace}`, code: 'code', consider: true
    });
    const info = await insert('bookletinfo', { name: `BOOKLET-${workspace}` });
    const booklet = await insert('booklet', { personid: person, infoid: info });
    const unit = await insert('unit', { bookletid: booklet, name: 'UNIT' });
    const response = await insert('response', {
      unitid: unit, variableid: 'VAR', status: 3, value: 'answer', status_v1: null, code_v1: null, score_v1: null
    });
    const job = await insert('coding_job', { workspace_id: workspace, name: 'Manual job', status: 'results_applied' });
    await insert('coding_job_unit', {
      coding_job_id: job,
      workspace_id: workspace,
      response_id: response,
      unit_name: 'UNIT',
      variable_id: 'VAR',
      variable_anchor: 'VAR',
      booklet_name: `BOOKLET-${workspace}`,
      person_login: `person-${workspace}`,
      person_code: 'code',
      person_group: 'group',
      code: 1,
      score: 1
    });
    return {
      workspace, booklet, unit, response, job
    };
  };

  const jobState = async (id: number) => {
    const [row] = await db.query('SELECT * FROM coding_job WHERE id=$1', [id]);
    return row;
  };

  it('imports only included units and exposes revision, summary and grouped scope through the module API', async () => {
    const f = await fixture();
    const hidden = await insert('unit', { bookletid: f.booklet, name: 'HIDDEN' });
    await insert('response', { unitid: hidden, variableid: 'VAR', status: 3 });
    await db.query('UPDATE workspace SET settings=$1 WHERE id=$2', [{ ignoredUnits: ['hidden'] }, f.workspace]);

    await service.markUnitsPendingAfterImport(f.workspace, [f.unit, hidden]);
    expect(await service.getSummary(f.workspace)).toEqual({
      workspaceId: f.workspace,
      currentRevision: 1,
      items: [{
        version: 'v1', state: 'PENDING', unitCount: 1, affectedResponseCount: 1
      }]
    });
    expect(await service.getScope(f.workspace, ['v1'], ['PENDING'])).toMatchObject({
      unitIds: [f.unit],
      groupNames: ['group'],
      groups: [{
        groupName: 'group', personCount: 1, unitCount: 1, affectedResponseCount: 1
      }]
    });
    expect(await db.getRepository(CodingUnitFreshness).countBy({ unit_id: hidden })).toBe(0);
    expect(await jobState(f.job)).toMatchObject({ freshness_status: 'stale_source', freshness_reason: 'RESULT_ADDED' });
  });

  it('preserves stale-source priority and leaves foreign, training and coding-issue review jobs untouched', async () => {
    const f = await fixture();
    const other = await fixture();
    const training = await insert('coder_training', { workspace_id: f.workspace, label: 'Training' });
    const excluded = [
      await insert('coding_job', { workspace_id: f.workspace, name: 'Training job', training_id: training }),
      await insert('coding_job', { workspace_id: f.workspace, name: 'Issue review', job_type: 'coding_issue_review' })
    ];
    for (const job of excluded) {
      await db.query(`INSERT INTO coding_job_unit
        (coding_job_id,response_id,workspace_id,unit_name,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group)
        SELECT $1,response_id,workspace_id,unit_name,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group
        FROM coding_job_unit WHERE coding_job_id=$2`, [job, f.job]);
    }
    await service.markCodingJobsStaleForUnitIds(f.workspace, [f.unit], 'CODING_SCHEME_CHANGED', 'review_required');
    await service.markCodingJobsStaleForUnitIds(f.workspace, [f.unit], 'RESULT_UPDATED');
    await service.markCodingJobsStaleForUnitIds(f.workspace, [f.unit], 'CODING_SCHEME_CHANGED', 'review_required');
    expect(await jobState(f.job)).toMatchObject({
      freshness_status: 'stale_source', freshness_affected_units: 1, freshness_affected_responses: 1
    });
    for (const job of [...excluded, other.job]) expect(await jobState(job)).toMatchObject({ freshness_status: 'current' });
  });

  it('rolls unit transitions and applied-job changes back together on the supplied transaction', async () => {
    const f = await fixture();
    await expect(db.transaction(async manager => {
      await service.markVersionsPendingAfterReset(f.workspace, { v1: [f.unit] }, manager);
      await service.markAppliedCodingJobsResultsClearedForResponseIds(f.workspace, [f.response], 'RESET', 'current', manager);
      expect(await manager.getRepository(CodingUnitFreshness).countBy({ workspace_id: f.workspace })).toBe(1);
      throw new Error('rollback fixture');
    })).rejects.toThrow('rollback fixture');
    expect(await db.getRepository(CodingUnitFreshness).countBy({ workspace_id: f.workspace })).toBe(0);
    expect(await jobState(f.job)).toMatchObject({ status: 'results_applied', freshness_status: 'current' });
  });

  it('keeps v2 blocked by stale jobs while invalidating current v3 after manual results are applied', async () => {
    const f = await fixture();
    await db.query("UPDATE coding_job SET freshness_status='stale_source' WHERE id=$1", [f.job]);
    await db.getRepository(CodingUnitFreshness).save({
      workspace_id: f.workspace,
      unit_id: f.unit,
      version: 'v3',
      state: 'CURRENT',
      reason: 'AUTOCODE_RUN',
      affected_response_count: 1,
      source_revision: 0,
      coded_revision: 0
    });
    await service.markManualCodingCurrent(f.workspace, [f.response], { clearCoveredReviewJobs: true });
    expect(await db.getRepository(CodingUnitFreshness).findBy({ workspace_id: f.workspace }))
      .toEqual([expect.objectContaining({ version: 'v3', state: 'STALE', reason: 'MANUAL_CODING_APPLIED' })]);
    expect(await jobState(f.job)).toMatchObject({ freshness_status: 'stale_source' });
  });

  it('marks a matching variable-bundle job stale for new responses even without an assigned job case', async () => {
    const f = await fixture();
    const bundle = await insert('variable_bundle', {
      workspace_id: f.workspace, name: 'Bundle', variables: JSON.stringify([{ unitName: 'unit', variableId: 'NEW' }])
    });
    await insert('coding_job_variable_bundle', { coding_job_id: f.job, variable_bundle_id: bundle });
    const added = await insert('response', { unitid: f.unit, variableid: 'NEW', status: 3 });
    await service.markResponsesPendingAfterImport(f.workspace, [added]);
    expect(await jobState(f.job)).toMatchObject({
      freshness_status: 'stale_source', freshness_reason: 'RESULT_ADDED', freshness_affected_responses: 1
    });
  });

  it.each([
    { normalizedRef: NO_CODING_SCHEME_REF_NORMALIZED, reference: '', alias: ' \t\n' },
    { normalizedRef: null, reference: '<CodingSchemeRef> \n\t </CodingSchemeRef>', alias: ' \tno_schema\n' }
  ])('allows run 2 after run 1 while preserving skipped tasks ($normalizedRef)', async ({ normalizedRef, reference, alias }) => {
    const f = await fixture();
    const skipped = await insert('unit', { bookletid: f.booklet, name: 'NO_SCHEMA', alias });
    const response = await insert('response', {
      unitid: skipped, variableid: 'VAR', status: 3, value: 'untouched', status_v2: 4, code_v2: 7, score_v2: 2
    });
    const file = await insert('file_upload', {
      workspace_id: f.workspace,
      file_id: 'NO_SCHEMA',
      file_type: 'Unit',
      filename: 'NO_SCHEMA.xml',
      data: `<Unit>${reference}</Unit>`,
      coding_scheme_ref_normalized: normalizedRef
    });
    await service.markUnitsPendingAfterImport(f.workspace, [f.unit, skipped]);
    const originalResponse = await db.query('SELECT * FROM response WHERE id=$1', [response]);
    expect((await service.getScope(f.workspace, ['v1'], ['PENDING'])).unitIds).toEqual([f.unit]);

    // The executor persists only the first task's plan; the schema-free task is deliberately skipped.
    await db.query('UPDATE response SET status_v1=4,code_v1=1,score_v1=1 WHERE id=$1', [f.response]);
    await service.markVersionCurrent(f.workspace, [f.unit], 'v1');
    await db.query("UPDATE coding_job SET freshness_status='current' WHERE id=$1", [f.job]);
    await db.getRepository(CodingUnitFreshness).insert([
      {
        workspace_id: f.workspace, unit_id: skipped, version: 'v3', state: 'PENDING', reason: 'RESULT_ADDED'
      },
      {
        workspace_id: f.workspace, unit_id: skipped, version: 'v2', state: 'MANUAL_REVIEW_REQUIRED', reason: 'RESULT_ADDED'
      }
    ]);

    const summary = await service.getSummary(f.workspace);
    expect(summary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 'v1', state: 'CURRENT', unitCount: 1 }),
      expect.objectContaining({ version: 'v2', state: 'MANUAL_REVIEW_REQUIRED', unitCount: 1 })
    ]));
    expect(summary.items.some(item => item.version !== 'v2' && item.state === 'PENDING')).toBe(false);
    expect((await service.getScope(f.workspace, ['v1', 'v3'], ['PENDING'])).unitIds).toEqual([]);
    expect((await service.getScope(f.workspace, ['v2'], ['MANUAL_REVIEW_REQUIRED'])).unitIds).toEqual([skipped]);
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).resolves.toBeUndefined();
    expect(await db.getRepository(CodingUnitFreshness).findOneBy({ unit_id: skipped, version: 'v1' }))
      .toMatchObject({ state: 'PENDING', coded_revision: null });
    expect(await db.query('SELECT * FROM response WHERE id=$1', [response])).toEqual(originalResponse);

    // Introducing a real reference makes the existing pending row relevant again, even with stale metadata.
    await db.query('UPDATE file_upload SET data=$1 WHERE id=$2', ['<Unit><CodingSchemeRef>MISSING.VOCS</CodingSchemeRef></Unit>', file]);
    expect((await service.getScope(f.workspace, ['v1'], ['PENDING'])).unitIds).toEqual([skipped]);
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).rejects.toThrow('Auto-Coding 1');
  });

  it('keeps missing files and preferred aliases with declared references pending', async () => {
    const f = await fixture();
    await insert('file_upload', {
      workspace_id: f.workspace,
      file_id: 'UNIT',
      file_type: 'Unit',
      filename: 'UNIT.xml',
      data: '<Unit/>',
      coding_scheme_ref_normalized: NO_CODING_SCHEME_REF_NORMALIZED
    });
    await insert('file_upload', {
      workspace_id: f.workspace,
      file_id: 'DECLARED',
      file_type: 'Unit',
      filename: 'DECLARED.xml',
      data: '<Unit><CodingSchemeRef>MISSING.VOCS</CodingSchemeRef></Unit>',
      coding_scheme_ref_normalized: null
    });
    const preferred = await insert('unit', { bookletid: f.booklet, name: 'UNIT', alias: ' declared ' });
    const missing = await insert('unit', { bookletid: f.booklet, name: 'UNIT', alias: 'MISSING_FILE' });
    for (const unitid of [preferred, missing]) await insert('response', { unitid, variableid: 'VAR', status: 3 });
    await service.markUnitsPendingAfterImport(f.workspace, [f.unit, preferred, missing]);

    expect((await service.getScope(f.workspace, ['v1'], ['PENDING'])).unitIds.sort()).toEqual([preferred, missing].sort());
    expect((await service.getSummary(f.workspace)).items).toEqual([
      expect.objectContaining({ version: 'v1', state: 'PENDING', unitCount: 2 })
    ]);
  });

  it('gates the second autocoder run on source coding, job freshness and pending result application', async () => {
    const f = await fixture();
    expect(await db.query('SELECT status_v1,code_v1,score_v1 FROM response WHERE id=$1', [f.response]))
      .toEqual([{ status_v1: null, code_v1: null, score_v1: null }]);
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).rejects.toThrow('noch nicht ausgeführt');
    await db.query('UPDATE response SET status_v1=4,code_v1=1,score_v1=1 WHERE id=$1', [f.response]);
    await db.query("UPDATE coding_job SET status='completed' WHERE id=$1", [f.job]);
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).rejects.toThrow('manuelle Kodierung');
    await db.query("UPDATE coding_job SET status='results_applied' WHERE id=$1", [f.job]);
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).resolves.toBeUndefined();
    await service.markCodingJobsStaleForResponseIds(f.workspace, [f.response], 'RESULT_UPDATED');
    await expect(service.assertAutoCodingRunCanStart(f.workspace, 2)).rejects.toThrow('manuelle Kodierung');
  });
});
