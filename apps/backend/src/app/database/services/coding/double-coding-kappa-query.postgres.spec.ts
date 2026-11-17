import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import * as ExcelJS from 'exceljs';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { DoubleCodingReviewQueryService } from './double-coding-review-query.service';
import { CohensKappaStatisticsService } from './cohens-kappa-statistics.service';
import { CohensKappaExportService } from './cohens-kappa-export.service';
import { KappaStatisticsOptions } from './cohens-kappa.types';
import { KappaPostgresFixture } from './kappa-query.postgres.test.factory';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;
type Filters = { unitName?: string; variableId?: string };
type Items = Awaited<ReturnType<DoubleCodingReviewQueryService['getCodedVariablesForKappa']>>;
const formerFilter = (items: Items, filters: Filters): Items => items.filter(item => (
  (!filters.unitName || item.unitName === filters.unitName) && (!filters.variableId || item.variableId === filters.variableId)
));

describePostgres('Kappa SQL filters against PostgreSQL and the complete Liquibase schema', () => {
  const fixture = new KappaPostgresFixture();
  let workspaceId: number;
  let profileId: number;
  let definitionId: number;
  let trainingId: number;
  let firstCoder: number;
  let secondCoder: number;
  let jobs: number[];
  let missingResponse: number;
  let duplicateResponse: number;
  let foreignResponse: number;
  const options: KappaStatisticsOptions = {
    excludeTrainings: false,
    weightedMean: true,
    calculationLevel: 'code',
    jobDefinitionIds: [],
    coderTrainingIds: [],
    coderIds: []
  };

  const load = (filters: Filters = {}, scope: Partial<KappaStatisticsOptions> = {}) => {
    const o = { ...options, ...scope };
    return fixture.query.getCodedVariablesForKappa(workspaceId, o.excludeTrainings, o.jobDefinitionIds, o.coderTrainingIds, o.coderIds, o.calculationLevel, filters);
  };

  beforeAll(async () => {
    await fixture.open(serverUrl!);
    ({ workspaceId, profileId } = await fixture.workspace('Kappa semantics'));
    firstCoder = await fixture.insert('user', { username: 'Coder A', identity: 'a', issuer: 'test' });
    secondCoder = await fixture.insert('user', { username: 'Coder B', identity: 'b', issuer: 'test' });
    const thirdCoder = await fixture.insert('user', { username: 'Coder C', identity: 'c', issuer: 'test' });
    const bundleId = await fixture.insert('variable_bundle', {
      workspace_id: workspaceId, name: 'Legacy bundle', variables: JSON.stringify([{ unitName: 'UNIT', variableId: 'VAR' }])
    });
    definitionId = await fixture.insert('job_definitions', {
      workspace_id: workspaceId,
      name: 'Definition',
      distribution_seed: 'test',
      missings_profile_id: profileId,
      assigned_variable_bundles: JSON.stringify([{ id: bundleId }])
    });
    trainingId = await fixture.insert('coder_training', { workspace_id: workspaceId, label: 'Training' });
    jobs = [
      await fixture.job(workspaceId, profileId, firstCoder, { job_definition_id: definitionId }),
      await fixture.job(workspaceId, profileId, secondCoder, { job_definition_id: definitionId }),
      await fixture.job(workspaceId, profileId, thirdCoder, { training_id: trainingId }),
      await fixture.job(workspaceId, profileId, thirdCoder),
      await fixture.job(workspaceId, profileId, firstCoder, { job_type: 'coding_issue_review' }),
      await fixture.job(workspaceId, profileId, firstCoder)
    ];
    await fixture.insert('coding_job_variable_bundle', { coding_job_id: jobs[3], variable_bundle_id: bundleId });
    await fixture.insert('coding_job_coder', { coding_job_id: jobs[5], user_id: secondCoder });
    // Repeated assignment of the same coder is valid and must still be deduplicated.
    await fixture.insert('coding_job_coder', { coding_job_id: jobs[0], user_id: firstCoder });
    const keys = [
      ['UNIT', 'VAR'], ['UNIT', 'OTHER'], ['OTHER', 'VAR'], ['unit', 'VAR'], [' UNIT ', 'VAR'],
      ['UNIT', 'var'], ["U'%_", "V'%_"], ['IGNORED.xml', 'VAR'], ['TESTLET_UNIT', 'VAR'], ['UNIT', 'BOOKLET_VAR']
    ];
    for (const [index, [unit, variable]] of keys.entries()) {
      const responseId = await fixture.response(workspaceId, unit, variable, `person-${index}`);
      for (const [jobIndex, job] of jobs.entries()) {
        await fixture.result(job, responseId, unit, variable, {
          code: jobIndex % 2,
          score: jobIndex % 2,
          ...(variable === 'BOOKLET_VAR' ? { booklet_name: 'IGNORED_BOOKLET.xml' } : {})
        });
      }
    }
    missingResponse = await fixture.response(workspaceId, 'UNIT', 'VAR', 'missing');
    await fixture.result(jobs[0], missingResponse, 'UNIT', 'VAR', { code: null, score: null, coding_issue_option: -3 });
    await fixture.result(jobs[1], missingResponse, 'UNIT', 'VAR', { code: -99, score: null });
    const invalid = await fixture.response(workspaceId, 'UNIT', 'VAR', 'invalid');
    await fixture.result(jobs[0], invalid, 'UNIT', 'VAR', { code: -4, score: null });
    await fixture.result(jobs[1], invalid, 'UNIT', 'VAR', { code: -1, score: 1 });
    const scoreOnly = await fixture.response(workspaceId, 'UNIT', 'VAR', 'score-only');
    await fixture.result(jobs[0], scoreOnly, 'UNIT', 'VAR', { code: null, score: 0 });
    await fixture.result(jobs[1], scoreOnly, 'UNIT', 'VAR', { code: 1, score: 0 });
    const other = await fixture.workspace('Other workspace');
    const otherJob = await fixture.job(other.workspaceId, other.profileId, firstCoder);
    foreignResponse = await fixture.response(other.workspaceId, 'UNIT', 'VAR', 'foreign');
    await fixture.result(otherJob, foreignResponse, 'UNIT', 'VAR');
    await fixture.db.query('UPDATE workspace SET settings=$1 WHERE id=$2', [{
      ignoredUnits: ['ignored'],
      ignoredBooklets: ['ignored_booklet.xml'],
      ignoredTestlets: [{ bookletId: 'booklet', testletId: 'hidden' }]
    }, workspaceId]);
    await fixture.insert('file_upload', {
      workspace_id: workspaceId,
      file_id: 'BOOKLET',
      file_type: 'Booklet',
      data: '<Booklet><Testlet id="hidden"><Unit id="TESTLET_UNIT"/></Testlet></Booklet>'
    });
    duplicateResponse = await fixture.response(workspaceId, 'PAGE', 'VAR', 'paging');
    // 6,001 physical duplicates, doubled by duplicate assignments, span several batches.
    await fixture.db.query(`INSERT INTO coding_job_unit
      (coding_job_id,response_id,unit_name,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group,code,score,supervisor_comment,updated_at)
      SELECT $1,$2,'PAGE','VAR','anchor','BOOKLET','paging','code','group',0,0,
      CASE WHEN i=6001 THEN 'preferred after boundary' ELSE NULL END, '2026-01-01'::timestamp
      FROM generate_series(1,6001) i`, [jobs[0], duplicateResponse]);
    await fixture.result(jobs[1], duplicateResponse, 'PAGE', 'VAR', { code: 1, score: 1 });
  }, 60000);

  afterAll(async () => fixture.close());

  it.each([
    {}, { unitName: '' }, { variableId: '' }, { unitName: 'UNIT' }, { variableId: 'VAR' },
    { unitName: 'UNIT', variableId: 'VAR' }, { unitName: 'unit' }, { unitName: ' UNIT ' },
    { variableId: 'var' }, { unitName: 'UNKNOWN' }, { unitName: "U'%_", variableId: "V'%_" },
    { unitName: 'UNIT\0' }, { variableId: ['VAR'] as unknown as string }
  ])('equals the former strict JS filter for %j', async filters => {
    const expected = formerFilter(await load(), filters);
    expect(await load(filters)).toEqual(expected);
  });

  it.each([
    { excludeTrainings: true }, { jobDefinitionIds: 'definition' }, { coderTrainingIds: 'training' },
    { jobDefinitionIds: 'definition', coderTrainingIds: 'training' }, { coderIds: 'first' },
    { coderIds: 'both' }, { calculationLevel: 'score' }
  ])('preserves scopes, exclusions and missing handling for %j', async scope => {
    const selected = {
      ...scope,
      jobDefinitionIds: scope.jobDefinitionIds ? [definitionId] : [],
      coderTrainingIds: scope.coderTrainingIds ? [trainingId] : [],
      coderIds: scope.coderIds === 'first' ? [firstCoder] : [],
      ...(scope.coderIds === 'both' ? { coderIds: [firstCoder, secondCoder] } : {})
    } as Partial<KappaStatisticsOptions>;
    const filters = { unitName: 'UNIT', variableId: 'VAR' };
    expect(await load(filters, selected)).toEqual(formerFilter(await load({}, selected), filters));
  });

  it('has non-empty independent oracles for missing values, exclusions, legacy scope and batch deduplication', async () => {
    const code = await load({ unitName: 'UNIT', variableId: 'VAR' });
    expect(code.find(item => item.responseId === missingResponse)?.coderResults.map(r => [r.code, r.score]))
      .toEqual([[-98, 0], [-99, 0]]);
    expect(code.flatMap(item => item.coderResults).some(r => r.jobId === jobs[4] || r.jobId === jobs[5])).toBe(false);
    const all = await load();
    expect(all.some(item => item.responseId === foreignResponse)).toBe(false);
    expect(all.some(item => ['IGNORED.xml', 'TESTLET_UNIT'].includes(item.unitName) || item.variableId === 'BOOKLET_VAR')).toBe(false);
    const scoped = await load({ unitName: 'UNIT', variableId: 'VAR' }, { jobDefinitionIds: [definitionId] });
    expect(scoped.flatMap(item => item.coderResults).some(r => r.jobId === jobs[3])).toBe(true);
    expect((await load({ unitName: 'UNIT', variableId: 'OTHER' }, { jobDefinitionIds: [definitionId] }))
      .flatMap(item => item.coderResults).some(r => r.jobId === jobs[3])).toBe(false);
    const paged = await load({ unitName: 'PAGE' });
    expect(paged).toEqual(formerFilter(all, { unitName: 'PAGE' }));
    expect(paged).toHaveLength(1);
    expect(paged[0].coderResults).toHaveLength(2);
    const winner = await fixture.db.query("SELECT max(id) AS id FROM coding_job_unit WHERE supervisor_comment='preferred after boundary'");
    // Notes identify the last-row winner without depending on an internal supervisor field in the public result.
    await fixture.db.query("UPDATE coding_job_unit SET notes='boundary winner' WHERE id=$1", [winner[0].id]);
    expect((await load({ unitName: 'PAGE' }))[0].coderResults[0].notes).toBe('boundary winner');
  });

  it.each(['code', 'score'] as const)('preserves statistics, weighting, CSV and Excel cells on %s level', async calculationLevel => {
    const exportWorkspaceId = workspaceId;
    for (const weightedMean of [false, true]) {
      const filters = { unitName: 'UNIT', variableId: 'VAR' };
      const scoped = {
        ...options, ...filters, calculationLevel, weightedMean
      };
      const formerItems = formerFilter(await load({}, scoped), filters);
      const previous = new CohensKappaStatisticsService({ getCodedVariablesForKappa: async () => formerItems } as never, fixture.calculator);
      const expected = await previous.buildStatistics(workspaceId, scoped);
      const actual = await fixture.statistics.buildStatistics(workspaceId, scoped);
      expect(actual).toEqual(expected);
      expect(actual.workspaceSummary.totalCoderPairs).toBeGreaterThan(0);
      const exporter = new CohensKappaExportService({ generateReplayUrlsForItemsBulk: async () => [] } as never);
      expect(await exporter.createSummaryCsv(actual)).toEqual(await exporter.createSummaryCsv(expected));
      const clock = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-26T00:00:00.000Z');
      try {
        expect(await exporter.createDetailsCsv(actual, scoped)).toEqual(await exporter.createDetailsCsv(expected, scoped));
      } finally { clock.mockRestore(); }
      const cells = async (result: typeof actual) => {
        const workbook = new ExcelJS.Workbook();
        const buffer = await exporter.createWorkbook(exportWorkspaceId, result, result.sourceItems, { serverUrl: 'https://example.test', authToken: 'test' });
        await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
        return workbook.worksheets.map(sheet => ({ name: sheet.name, rows: sheet.getSheetValues() }));
      };
      expect(await cells(actual)).toEqual(await cells(expected));
    }
  }, 30000);

  (process.env.KAPPA_QUERY_BENCHMARK === '1' ? it : it.skip)('measures the former and filtered retrieval on identical synthetic data', async () => {
    const bench = await fixture.workspace('Kappa benchmark');
    const benchJobs = [await fixture.job(bench.workspaceId, bench.profileId, firstCoder), await fixture.job(bench.workspaceId, bench.profileId, secondCoder)];
    await fixture.db.query(`INSERT INTO persons(workspace_id,"group",login,code)
      SELECT $1,'benchmark','bench-'||i,'code' FROM generate_series(1,25000) i`, [bench.workspaceId]);
    const bookletInfo = await fixture.insert('bookletinfo', { name: 'BENCH' });
    await fixture.db.query('INSERT INTO booklet(personid,infoid) SELECT id,$1 FROM persons WHERE workspace_id=$2', [bookletInfo, bench.workspaceId]);
    await fixture.db.query(`INSERT INTO unit(bookletid,name)
      SELECT b.id,'UNIT-'||((substring(p.login from 7)::int-1)%20) FROM booklet b JOIN persons p ON p.id=b.personid WHERE p.workspace_id=$1`, [bench.workspaceId]);
    await fixture.db.query(`INSERT INTO response(unitid,variableid,status)
      SELECT u.id,'VAR-'||(((substring(p.login from 7)::int-1)/20)%10),1 FROM unit u JOIN booklet b ON b.id=u.bookletid JOIN persons p ON p.id=b.personid WHERE p.workspace_id=$1`, [bench.workspaceId]);
    await fixture.db.query(`INSERT INTO coding_job_unit(coding_job_id,response_id,unit_name,variable_id,variable_anchor,booklet_name,person_login,person_code,person_group,code,score)
      SELECT j.id,r.id,u.name,r.variableid,r.variableid,'BENCH',p.login,p.code,p."group",(r.id%2),r.id%2
      FROM response r JOIN unit u ON u.id=r.unitid JOIN booklet b ON b.id=u.bookletid JOIN persons p ON p.id=b.personid
      CROSS JOIN unnest($2::int[]) j(id) WHERE p.workspace_id=$1`, [bench.workspaceId, benchJobs]);
    await fixture.db.query('ANALYZE');
    const repository = fixture.db.getRepository(CodingJobUnit);
    const original = repository.createQueryBuilder.bind(repository);
    let rawRows = 0;
    let batches = 0;
    let firstSql: [string, unknown[]];
    const spy = jest.spyOn(repository, 'createQueryBuilder').mockImplementation((...args) => {
      const builder = original(...args);
      const getRawMany = builder.getRawMany.bind(builder);
      builder.getRawMany = async () => {
        if (batches === 0) firstSql = builder.getQueryAndParameters();
        const rows = await getRawMany();
        rawRows += rows.length;
        batches += 1;
        return rows;
      };
      return builder;
    });
    const results: unknown[] = [];
    try {
      for (const filters of [{}, { unitName: 'UNIT-0' }, { variableId: 'VAR-0' }, { unitName: 'UNIT-0', variableId: 'VAR-0' }]) {
        const samples: Record<string, number[]> = { before: [], after: [] };
        const evidence: Record<string, unknown> = {};
        for (let round = 0; round < 6; round++) {
          let before: Items = [];
          let after: Items = [];
          for (const mode of (round % 2 ? ['after', 'before'] : ['before', 'after'])) {
            rawRows = 0;
            batches = 0;
            const start = performance.now();
            const loaded = await fixture.query.getCodedVariablesForKappa(bench.workspaceId, true, [], [], [], 'code', mode === 'after' ? filters : {});
            const items = mode === 'before' ? formerFilter(loaded, filters) : loaded;
            const ms = performance.now() - start;
            if (mode === 'before') before = items; else after = items;
            if (round > 0) samples[mode].push(ms);
            if (round === 5) {
              const plan = await fixture.db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${firstSql![0]}`, firstSql![1]);
              evidence[mode] = {
                rawRows, batches, items: items.length, firstBatchPlan: plan[0]['QUERY PLAN']
              };
            }
          }
          expect(after).toEqual(before);
        }
        results.push({ filters, samplesMs: samples, ...evidence });
      }
    } finally { spy.mockRestore(); }
    const report = {
      measuredAt: new Date().toISOString(),
      postgres: (await fixture.db.query('SHOW server_version'))[0].server_version,
      node: process.version,
      responses: 25000,
      codingJobUnits: 50000,
      warmupRounds: 1,
      measuredRounds: 5,
      measurement: 'Retrieval, grouping and former JS filter; no HTTP or export timing. Alternating order, warm local database.',
      results
    };
    if (process.env.KAPPA_QUERY_BENCHMARK_OUTPUT) writeFileSync(process.env.KAPPA_QUERY_BENCHMARK_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  }, 180000);
});
