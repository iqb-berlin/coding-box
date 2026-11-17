import { writeFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { CodingResetPreviewService } from './coding-reset-preview.service';
import { ResetCodingScope } from '../../../../../../../api-dto/coding/reset-coding-preview.dto';

const describePostgres = process.env.RESET_PREVIEW_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('Reset preview against isolated PostgreSQL data', () => {
  let db: DataSource;
  let service: CodingResetPreviewService;
  const schema = `reset_preview_${process.pid}`;
  const codingColumns = ['v1', 'v2', 'v3'].flatMap(v => ['status', 'code', 'score'].map(field => `${field}_${v} bigint`));

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url: process.env.RESET_PREVIEW_TEST_DATABASE_URL,
      schema,
      entities: [`${__dirname}/../../entities/*.entity.ts`],
      synchronize: false,
      extra: { options: `-c search_path=${schema}`, max: 3 }
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`
      CREATE TABLE persons (id int PRIMARY KEY, workspace_id int, consider boolean);
      CREATE TABLE booklet (id int PRIMARY KEY, personid int);
      CREATE TABLE unit (id int PRIMARY KEY, bookletid int, name varchar(100));
      CREATE TABLE response (id int PRIMARY KEY, unitid int, variableid varchar(255), status smallint,
        is_autocoder_generated boolean DEFAULT FALSE, ${codingColumns.join(', ')});
      CREATE INDEX ON unit (bookletid);
      CREATE INDEX ON booklet (personid);
      CREATE INDEX ON persons (workspace_id, consider, id);
      CREATE INDEX ON response (unitid, variableid);
      CREATE INDEX ON response (variableid);
      INSERT INTO persons VALUES (1,1,TRUE),(2,1,FALSE),(3,2,TRUE);
      INSERT INTO booklet VALUES (1,1),(2,2),(3,3);
      INSERT INTO unit VALUES (1,1,'U1'),(2,1,'U2'),(3,2,'Excluded'),(4,3,'Foreign');
      INSERT INTO response (id,unitid,variableid,status,status_v1) VALUES (1,1,'V1',3,8),(6,3,'V1',3,8),(7,4,'V1',3,8),(8,1,'V1',0,8);
      INSERT INTO response (id,unitid,variableid,status,status_v2,code_v2) VALUES (2,1,'V2',3,8,-111),(5,2,'V1',3,8,NULL);
      INSERT INTO response (id,unitid,variableid,status,is_autocoder_generated) VALUES (3,1,'V3',3,TRUE),(10,1,'V6',3,FALSE);
      INSERT INTO response (id,unitid,variableid,status,is_autocoder_generated,status_v3) VALUES (4,1,'V4',3,TRUE,8);
      INSERT INTO response (id,unitid,variableid,status,is_autocoder_generated,status_v1) VALUES (9,1,'V5',3,TRUE,8);
    `);
    service = new CodingResetPreviewService(db);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.destroy();
    }
  });

  it.each([
    ['v1', 6, 5, 3], ['v2', 3, 2, 2], ['v3', 2, 1, 2]
  ] as const)('counts the exact %s reset and cleanup scope once per response', async (version, total, reset, deleted) => {
    const before = await db.query('SELECT * FROM response ORDER BY id');
    await expect(service.preview(1, { version, unitFilters: [], variableFilters: [] })).resolves.toMatchObject({
      status: 'valid', affectedResponseCount: total, resetResponseCount: reset, deletedGeneratedResponseCount: deleted
    });
    expect(await db.query('SELECT * FROM response ORDER BY id')).toEqual(before);
  });

  it('checks exact case, workspace ownership, and variables within the selected units', async () => {
    await expect(service.preview(1, { version: 'v1', unitFilters: ['u1', 'Foreign'], variableFilters: [] }))
      .resolves.toMatchObject({ status: 'invalid-filters', unknownUnits: ['u1', 'Foreign'], affectedResponseCount: null });
    await expect(service.preview(1, { version: 'v1', unitFilters: ['U2'], variableFilters: ['V3'] }))
      .resolves.toMatchObject({ status: 'invalid-filters', unknownVariables: ['V3'] });
    await expect(service.preview(1, { version: 'v1', unitFilters: [], variableFilters: ['V1'] }))
      .resolves.toMatchObject({ status: 'valid', affectedResponseCount: 2 });
  });

  it('distinguishes existing filters with zero eligible results from unknown filters', async () => {
    await expect(service.preview(1, { version: 'v3', unitFilters: ['Excluded'], variableFilters: ['V1'] }))
      .resolves.toMatchObject({ status: 'valid', affectedResponseCount: 0 });
    await expect(service.preview(1, { version: 'v1', unitFilters: ["U1' OR TRUE --"], variableFilters: [] }))
      .resolves.toMatchObject({ status: 'invalid-filters', affectedResponseCount: null });
  });

  const benchmark = process.env.RESET_PREVIEW_BENCHMARK === 'true' ? it : it.skip;
  benchmark('measures global and selective previews with one million responses', async () => {
    await db.query(`
      INSERT INTO persons VALUES (10,10,TRUE);
      INSERT INTO booklet VALUES (10,10);
      INSERT INTO unit SELECT g+10,10,'BENCH'||lpad((g%100)::text,3,'0') FROM generate_series(0,999) g;
      INSERT INTO response (id,unitid,variableid,status,status_v1)
        SELECT g+1000000,(g%1000)+10,'V'||((g/1000)%20)::text,3,8 FROM generate_series(0,999999) g;
      ANALYZE persons; ANALYZE booklet; ANALYZE unit; ANALYZE response;
    `);
    const scopes: Array<{ name: string; expected: number; scope: ResetCodingScope }> = [
      { name: 'global', expected: 1000000, scope: { version: 'v1', unitFilters: [], variableFilters: [] } },
      { name: 'unit', expected: 10000, scope: { version: 'v1', unitFilters: ['BENCH003'], variableFilters: [] } },
      { name: 'unit-and-variable', expected: 500, scope: { version: 'v1', unitFilters: ['BENCH003'], variableFilters: ['V3'] } }
    ];
    const timings: Array<{ scope: string; affectedResponses: number; durationMs: number[] }> = [];
    for (const sample of scopes) {
      const durationMs: number[] = [];
      for (let run = 0; run < 2; run++) {
        const start = performance.now();
        const result = await service.preview(10, sample.scope);
        durationMs.push(Math.round(performance.now() - start));
        expect(result.affectedResponseCount).toBe(sample.expected);
      }
      timings.push({ scope: sample.name, affectedResponses: sample.expected, durationMs });
    }
    writeFileSync(process.env.RESET_PREVIEW_BENCHMARK_OUTPUT || 'output/playwright/preview-benchmark.json', JSON.stringify({
      postgres: (await db.query('SELECT version() AS version'))[0].version, responseRows: 1000000, timings
    }, null, 2));
  }, 120_000);
});
