import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMock } from '@golevelup/ts-jest';
import { DataSource } from 'typeorm';
import { TestResultsExportService } from './test-results-export.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { ResolvedWorkspaceExclusions } from '../workspace/workspace-exclusion-query.util';
import Persons from '../../entities/persons.entity';
import Workspace from '../../entities/workspace.entity';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Session } from '../../entities/session.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { UnitNote } from '../../entities/unitNote.entity';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};

const flattenPlan = (node: PlanNode): PlanNode[] => [node, ...(node.Plans || []).flatMap(flattenPlan)];

// Uses only synthetic, unlogged tables in a dedicated schema to limit test WAL.
// Never synchronizes application tables.
// GEOGEBRA_PERFORMANCE_ROWS=5660000 exercises the production issue's row count.
describePostgres('GeoGebra availability and partial index', () => {
  const schema = `geogebra_test_${process.pid}_${Date.now()}`;
  let source: DataSource;
  let service: TestResultsExportService;
  let exclusions: ResolvedWorkspaceExclusions;
  let queries: { sql: string; parameters: unknown[] }[];

  beforeAll(async () => {
    source = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      entities: [Workspace, Persons, Booklet, BookletInfo, Unit, ResponseEntity, Session,
        BookletLog, UnitLog, UnitLastState, ChunkEntity, UnitTag, UnitNote],
      synchronize: false
    });
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schema}"`);
    await source.query(`
      CREATE UNLOGGED TABLE "${schema}".persons (id INT PRIMARY KEY, workspace_id INT, consider BOOLEAN);
      CREATE INDEX ON "${schema}".persons (workspace_id, consider);
      CREATE UNLOGGED TABLE "${schema}".bookletinfo (id INT PRIMARY KEY, name TEXT);
      CREATE UNLOGGED TABLE "${schema}".booklet (id INT PRIMARY KEY, personid INT REFERENCES "${schema}".persons ON DELETE CASCADE, infoid INT REFERENCES "${schema}".bookletinfo);
      CREATE INDEX ON "${schema}".booklet (personid);
      CREATE UNLOGGED TABLE "${schema}".unit (id INT PRIMARY KEY, bookletid INT REFERENCES "${schema}".booklet ON DELETE CASCADE, name TEXT);
      CREATE INDEX ON "${schema}".unit (bookletid);
      CREATE UNLOGGED TABLE "${schema}".response (id SERIAL PRIMARY KEY, unitid INT REFERENCES "${schema}".unit ON DELETE CASCADE, value TEXT);
      CREATE INDEX ON "${schema}".response (unitid);
      INSERT INTO "${schema}".persons VALUES (1, 42, true), (2, 43, true), (3, 42, false);
      INSERT INTO "${schema}".bookletinfo VALUES (1, 'BOOKLET'), (2, 'IGNORED_BOOKLET');
      INSERT INTO "${schema}".booklet VALUES (1, 1, 1), (2, 2, 1), (3, 3, 1), (4, 1, 2);
      INSERT INTO "${schema}".unit VALUES (1, 1, 'UNIT'), (2, 2, 'OTHER_WORKSPACE'), (3, 3, 'NOT_CONSIDERED'),
        (4, 1, 'IGNORED_UNIT.xml'), (5, 4, 'UNIT'), (6, 1, 'TESTLET');
      INSERT INTO "${schema}".response (id, unitid, value) VALUES (1, 2, 'UEsD-existing');
      ALTER SEQUENCE "${schema}".response_id_seq RESTART WITH 2;
    `);
    const rows = Number(process.env.GEOGEBRA_PERFORMANCE_ROWS || 50000);
    await source.query(`
      INSERT INTO "${schema}".response (id, unitid, value)
      SELECT n + 100, 1, CASE WHEN n % 10 = 0 THEN repeat('x', 4096) || n ELSE 'ordinary-answer-' || n END
      FROM generate_series(1, $1::int) n
    `, [rows]);

    if (process.env.GEOGEBRA_PERFORMANCE_ROWS) {
      await source.query(`ANALYZE "${schema}".response`);
      const [baseline] = await source.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT COUNT(DISTINCT response.id) FROM "${schema}".response response
        INNER JOIN "${schema}".unit unit ON unit.id = response.unitid
        INNER JOIN "${schema}".booklet booklet ON booklet.id = unit.bookletid
        INNER JOIN "${schema}".bookletinfo bookletinfo ON bookletinfo.id = booklet.infoid
        INNER JOIN "${schema}".persons person ON person.id = booklet.personid
        WHERE person.workspace_id = 42 AND person.consider = true
          AND (response.value LIKE 'UEsD%' OR response.value ILIKE 'data:%;base64,UEsD%')`);
      const plan = baseline['QUERY PLAN'][0];
      process.stdout.write(`${JSON.stringify({
        baselineRows: rows,
        executionMs: plan['Execution Time'],
        responseNodes: flattenPlan(plan.Plan).filter(node => node['Relation Name'] === 'response')
      })}\n`);
    }

    // Apply the actual Liquibase SQL, with its schema redirected to this fixture.
    const migration = readFileSync(resolve(process.cwd(), 'database/changelog/coding-box.changelog-965-geogebra-existence.sql'), 'utf8')
      .replace(/^--.*$/gm, '').replace(/"public"\./g, `"${schema}".`);
    for (const statement of migration.split(/;\s*(?:\r?\n|$)/).filter(sql => sql.trim())) {
      await source.query(statement);
    }
    await source.query(`VACUUM ANALYZE "${schema}".response`);
    const exclusionService = createMock<WorkspaceExclusionService>({
      resolveExclusionsForQueries: jest.fn().mockImplementation(async () => exclusions)
    });
    const module = await Test.createTestingModule({ providers: [TestResultsExportService] })
      .useMocker(token => {
        if (token === getRepositoryToken(ResponseEntity)) return source.getRepository(ResponseEntity);
        if (token === WorkspaceExclusionService) return exclusionService;
        return createMock();
      }).compile();
    service = module.get(TestResultsExportService);
    jest.spyOn(source.logger, 'logQuery').mockImplementation((sql, parameters) => {
      queries.push({ sql, parameters: parameters || [] });
    });
  }, 240000);

  beforeEach(async () => {
    queries = [];
    exclusions = { globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] };
    await source.query(`DELETE FROM "${schema}".response WHERE id BETWEEN 2 AND 99`);
  });

  afterAll(async () => {
    if (source?.isInitialized) {
      await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await source.destroy();
    }
  });

  const insertResponse = (unitid: number, value: string | null) => source.query(
    `INSERT INTO "${schema}".response (unitid, value) VALUES ($1, $2) RETURNING id`, [unitid, value]
  );

  it('indexes existing data and isolates workspaces and unconsidered persons', async () => {
    await insertResponse(3, 'UEsD-unconsidered');
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
    await expect(service.hasGeogebraResponses(43)).resolves.toBe(true);
    await expect(service.hasGeogebraResponses(999)).resolves.toBe(false);
  });

  it('handles an empty GeoGebra index', async () => {
    try {
      await source.query(`DELETE FROM "${schema}".response WHERE id = 1`);
      await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
      await expect(service.hasGeogebraResponses(43)).resolves.toBe(false);
    } finally {
      await source.query(`INSERT INTO "${schema}".response (id, unitid, value) VALUES (1, 2, 'UEsD-existing')`);
    }
  });

  it.each([null, '', 'ordinary', 'uesD-raw-is-case-sensitive', 'prefix-UEsD', 'data:text/plain,UEsD'])('ignores non-GeoGebra value %s', async value => {
    await insertResponse(1, value);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
  });

  it.each(['UEsD-raw', 'data:application/vnd.geogebra.file;base64,UEsD-file', 'DATA:APPLICATION/OCTET-STREAM;BASE64,uesd-file'])('recognizes %s and tracks value updates and deletion', async value => {
    const [{ id }] = await insertResponse(1, value);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(true);
    await source.query(`UPDATE "${schema}".response SET value = 'ordinary' WHERE id = $1`, [id]);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
    await source.query(`UPDATE "${schema}".response SET value = $1 WHERE id = $2`, [value, id]);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(true);
    await source.query(`DELETE FROM "${schema}".response WHERE id = $1`, [id]);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
  });

  it.each([
    [4, { globalIgnoredUnits: ['ignored_unit.xml'] }],
    [5, { ignoredBooklets: ['ignored_booklet'] }],
    [6, { testletIgnoredUnits: [{ bookletId: 'booklet', unitId: 'testlet.xml' }] }]
  ] as const)('respects exclusions for unit %s', async (unitid, ignored) => {
    await insertResponse(unitid, 'UEsD-excluded');
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(true);
    Object.assign(exclusions, ignored);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
    await insertResponse(1, 'UEsD-eligible');
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(true);
  });

  it('tracks cascading unit deletion without cache invalidation', async () => {
    await source.query(`INSERT INTO "${schema}".unit VALUES (7, 1, 'DELETED_UNIT')`);
    await insertResponse(7, 'UEsD-deleted');
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(true);
    await source.query(`DELETE FROM "${schema}".unit WHERE id = 7`);
    await expect(service.hasGeogebraResponses(42)).resolves.toBe(false);
  });

  it('uses the partial index with a generic prepared plan', async () => {
    await service.hasGeogebraResponses(42);
    const query = queries[queries.length - 1];
    const runner = source.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SET plan_cache_mode = force_generic_plan');
      await runner.query(`PREPARE geogebra_exists AS ${query.sql}`);
      const [explain] = await runner.query('EXPLAIN (FORMAT JSON) EXECUTE geogebra_exists(42, true)');
      expect(flattenPlan(explain['QUERY PLAN'][0].Plan)).toEqual(expect.arrayContaining([
        expect.objectContaining({ 'Index Name': 'idx_response_geogebra_unit' })
      ]));
    } finally {
      await runner.query('DEALLOCATE ALL');
      await runner.query('RESET plan_cache_mode');
      await runner.release();
    }
  });

  it('uses the partial index for both missing and present values and concurrent requests', async () => {
    const request = () => service.hasGeogebraResponses(42);
    for (const expected of [false, true]) {
      if (expected) await insertResponse(1, 'UEsD-last');
      await expect(service.hasGeogebraResponses(42)).resolves.toBe(expected);
      const query = queries[queries.length - 1];
      const [explain] = await source.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, query.parameters);
      const plan = explain['QUERY PLAN'][0];
      const responseNodes = flattenPlan(plan.Plan).filter(node => node['Relation Name'] === 'response');
      expect(responseNodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ 'Index Name': 'idx_response_geogebra_unit' })
      ]));
      expect(responseNodes.some(node => node['Node Type'] === 'Seq Scan')).toBe(false);
      expect(JSON.stringify(responseNodes)).not.toMatch(/~~|value/);
      const start = performance.now();
      await expect(Promise.all(Array.from({ length: 8 }, request)))
        .resolves.toEqual(Array(8).fill(expected));
      process.stdout.write(`${JSON.stringify({
        rows: Number(process.env.GEOGEBRA_PERFORMANCE_ROWS || 50000),
        exists: expected,
        executionMs: plan['Execution Time'],
        concurrent8Ms: performance.now() - start,
        responseNodes
      })}\n`);
    }
  });
});
