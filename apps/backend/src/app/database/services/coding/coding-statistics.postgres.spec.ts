import { createMock } from '@golevelup/ts-jest';
import { DataSource, Repository } from 'typeorm';
import { CodingStatisticsService } from './coding-statistics.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CacheService } from '../../../cache/cache.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { WorkspaceExclusionService, ResolvedWorkspaceExclusions } from '../workspace/workspace-exclusion.service';
import type { WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Coding statistics unit scope against PostgreSQL', () => {
  const schema = `coding_statistics_${process.pid}_${Date.now()}`;
  let db: DataSource;
  const variables = new Map([
    ['Case.Unit.xml', new Set(['A'])],
    ['OTHER', new Set(['B'])]
  ]);

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      extra: { max: 2, options: `-c search_path=${schema},pg_catalog` },
      synchronize: false
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`
      CREATE UNLOGGED TABLE "${schema}".persons (id INT PRIMARY KEY, workspace_id INT, consider BOOLEAN);
      CREATE UNLOGGED TABLE "${schema}".bookletinfo (id INT PRIMARY KEY, name TEXT);
      CREATE UNLOGGED TABLE "${schema}".booklet (id INT PRIMARY KEY, personid INT, infoid INT);
      CREATE UNLOGGED TABLE "${schema}".unit (id INT PRIMARY KEY, bookletid INT, name TEXT);
      CREATE UNLOGGED TABLE "${schema}".response (
        id INT PRIMARY KEY, unitid INT, variableid TEXT, status SMALLINT,
        status_v1 SMALLINT, status_v2 SMALLINT, status_v3 SMALLINT,
        code_v2 INT, score_v2 INT, autocoder_invalidated_version TEXT,
        is_autocoder_generated BOOLEAN);
      CREATE UNLOGGED TABLE "${schema}".coding_job (id INT PRIMARY KEY, status TEXT);
      CREATE UNLOGGED TABLE "${schema}".coding_job_unit (response_id INT, coding_job_id INT);
      INSERT INTO "${schema}".persons VALUES (1,42,true),(2,43,true),(3,42,false);
      INSERT INTO "${schema}".bookletinfo VALUES (1,'BOOKLET_A'),(2,'BOOKLET_B');
      INSERT INTO "${schema}".booklet VALUES (1,1,1),(2,1,2),(3,2,1),(4,3,1);
      INSERT INTO "${schema}".unit VALUES
        (1,1,'Case.Unit.xml'),(2,2,'OTHER'),(3,3,'Case.Unit.xml'),
        (4,4,'Case.Unit.xml'),(5,1,'CASE.UNIT.XML');
      INSERT INTO "${schema}".response (id,unitid,variableid,status,status_v1,status_v2,status_v3,is_autocoder_generated) VALUES
        (1,1,'A',3,5,6,7,false),(2,2,'B',3,8,7,6,true),
        (3,1,'B',3,5,6,7,false),(4,2,'A',3,5,6,7,false),
        (5,3,'A',3,5,6,7,false),(6,4,'A',3,5,6,7,false),
        (7,5,'A',3,5,6,7,false),(8,1,'A',0,5,6,7,false),
        (9,1,'A',3,NULL,NULL,NULL,false),(10,1,'A',3,0,0,0,false);
    `);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.destroy(); }
    }
  });

  function service(
    exclusions: ResolvedWorkspaceExclusions = { globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] },
    unitVariables = variables
  ) {
    return new CodingStatisticsService(
      createMock<Repository<ResponseEntity>>({ query: (sql, parameters) => db.query(sql, parameters) }),
      createMock<CacheService>({ get: async () => null, set: async () => true }),
      createMock<JobQueueService>(),
      createMock<WorkspaceExclusionService>({ resolveExclusionsForQueries: async () => exclusions }),
      createMock<WorkspaceFileMetadataReader>({
        getUnitVariableMap: async () => unitVariables,
        getDerivedVariableMap: async () => new Map([['OTHER', new Set(['B'])]])
      })
    );
  }

  it.each([
    ['v1', { 5: 1, 8: 1 }], ['v2', { 6: 1, 7: 1 }], ['v3', { 6: 1, 7: 1 }]
  ] as const)('preserves %s status, exact pairs, case, workspace and derived-response boundaries', async (version, statusCounts) => {
    const result = await service().getCodingStatistics(42, version, true);
    expect(result).toMatchObject({
      totalResponses: 2, baseResponseCount: 1, derivedResponseCount: 1, derivedVariableCount: 1, statusCounts
    });
  });

  it.each([
    { globalIgnoredUnits: ['OTHER'], ignoredBooklets: [], testletIgnoredUnits: [] },
    { globalIgnoredUnits: [], ignoredBooklets: ['booklet_b'], testletIgnoredUnits: [] },
    { globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [{ bookletId: 'booklet_b', unitId: 'other.xml' }] }
  ])('preserves global and contextual exclusions: %j', async exclusions => {
    const result = await service(exclusions).getCodingStatistics(42, 'v1', true);
    expect(result).toMatchObject({
      totalResponses: 1, baseResponseCount: 1, derivedResponseCount: 0, statusCounts: { 5: 1 }
    });
  });

  it.each(['v2', 'v3'] as const)('preserves the open manual-coding placeholder fallback in %s', async version => {
    await db.query('UPDATE response SET status_v2=8,status_v3=NULL WHERE id=1');
    await db.query("INSERT INTO coding_job VALUES (1,'open'); INSERT INTO coding_job_unit VALUES (1,1)");
    try {
      const result = await service().getCodingStatistics(42, version, true);
      expect(result.statusCounts).toEqual(version === 'v2' ? { 5: 1, 7: 1 } : { 5: 1, 6: 1 });
    } finally {
      await db.query('DELETE FROM coding_job_unit; DELETE FROM coding_job; UPDATE response SET status_v2=6,status_v3=7 WHERE id=1');
    }
  });

  it.each([
    ['UNIT\u001FPART', 'V'], ['UNIT', 'PART\u001FV']
  ])('keeps legacy separator collisions when metadata contains %s / %s', async (unitName, variableId) => {
    await db.query('INSERT INTO unit VALUES (20,1,$1),(21,1,$2)', ['UNIT\u001FPART', 'UNIT']);
    await db.query('INSERT INTO response (id,unitid,variableid,status,status_v1) VALUES (20,20,$1,3,5),(21,21,$2,3,5)', ['V', 'PART\u001FV']);
    try {
      const result = await service(undefined, new Map([[unitName, new Set([variableId])]])).getCodingStatistics(42, 'v1', true);
      expect(result).toMatchObject({ totalResponses: 2, statusCounts: { 5: 2 } });
    } finally {
      await db.query('DELETE FROM response WHERE id IN (20,21); DELETE FROM unit WHERE id IN (20,21)');
    }
  });
});
