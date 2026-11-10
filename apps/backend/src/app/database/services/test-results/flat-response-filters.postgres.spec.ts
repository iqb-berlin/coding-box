import { createMock } from '@golevelup/ts-jest';
import { DataSource } from 'typeorm';
import { TestResultsResponsesService } from './test-results-responses.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
import { TestResultsFilterOptionsService } from './test-results-filter-options.service';
import { FlatResponseOptions } from './workspace-test-results.types';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import Workspace from '../../entities/workspace.entity';
import Persons from '../../entities/persons.entity';
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

describePostgres('Flat response IDs and totals against PostgreSQL', () => {
  const schema = `flat_response_filters_${process.pid}_${Date.now()}`;
  let db: DataSource;
  let service: TestResultsResponsesService;
  let filterOptionsService: TestResultsFilterOptionsService;

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      // Raw EXISTS fragments and ORM queries must see the same disposable schema.
      extra: { max: 2, options: `-c search_path=${schema},pg_catalog` },
      entities: [Workspace, Persons, Booklet, BookletInfo, Unit, ResponseEntity, Session,
        BookletLog, UnitLog, UnitLastState, ChunkEntity, UnitTag, UnitNote],
      synchronize: false
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`
      CREATE UNLOGGED TABLE "${schema}".persons (
        id INT PRIMARY KEY, workspace_id INT, consider BOOLEAN, code TEXT, login TEXT, "group" TEXT);
      CREATE UNLOGGED TABLE "${schema}".bookletinfo (id INT PRIMARY KEY, name TEXT);
      CREATE UNLOGGED TABLE "${schema}".booklet (id INT PRIMARY KEY, personid INT, infoid INT);
      CREATE UNLOGGED TABLE "${schema}".unit (id INT PRIMARY KEY, bookletid INT, name TEXT, alias TEXT);
      CREATE UNLOGGED TABLE "${schema}".response (
        id INT PRIMARY KEY, unitid INT, variableid TEXT, status SMALLINT, value TEXT,
        is_autocoder_generated BOOLEAN DEFAULT false);
      CREATE UNLOGGED TABLE "${schema}".unit_tag (id INT PRIMARY KEY, "unitId" INT, tag TEXT);
      CREATE UNLOGGED TABLE "${schema}".bookletlog (id INT PRIMARY KEY, bookletid INT, key TEXT, parameter TEXT, ts BIGINT);
      CREATE UNLOGGED TABLE "${schema}".session (
        id INT PRIMARY KEY, bookletid INT, browser TEXT, os TEXT, screen TEXT, loadcompletems BIGINT);
      CREATE UNLOGGED TABLE "${schema}".unitlog (id INT PRIMARY KEY, unitid INT, key TEXT, parameter TEXT, ts BIGINT);

      INSERT INTO "${schema}".persons VALUES
        (1, 42, true, 'A', 'person', 'group'), (2, 43, true, 'B', 'foreign', 'group'),
        (3, 42, false, 'C', 'excluded', 'group');
      INSERT INTO "${schema}".bookletinfo VALUES
        (1, 'BOOKLET_A'), (2, 'BOOKLET_B'), (3, 'BOOKLET_C'), (4, 'BOOKLET_D'),
        (5, 'BOOKLET_E'), (6, 'FOREIGN'), (7, 'NOT_CONSIDERED');
      INSERT INTO "${schema}".booklet VALUES
        (1, 1, 1), (2, 1, 2), (3, 1, 3), (4, 1, 4), (5, 1, 5), (6, 2, 6), (7, 3, 7);
      INSERT INTO "${schema}".unit VALUES
        (1, 1, 'UNIT_A', 'UNIT_A'), (2, 2, 'UNIT_B', 'UNIT_B'), (3, 3, 'UNIT_C', 'UNIT_C'),
        (4, 4, 'UNIT_D', 'UNIT_D'), (5, 5, 'UNIT_E', 'UNIT_E'), (6, 6, 'FOREIGN', 'FOREIGN'),
        (7, 7, 'NOT_CONSIDERED', 'NOT_CONSIDERED'), (8, 1, 'IGNORED', 'IGNORED');
      INSERT INTO "${schema}".response (id, unitid, variableid, status, value) VALUES
        (1, 1, 'A', 3, NULL), (2, 1, 'B', 3, '   '), (3, 1, 'C', 3, ' [] '), (4, 1, 'D', 3, 'answer A'),
        (5, 2, 'E', 3, 'answer B'), (6, 3, 'F', 3, 'answer C'), (7, 4, 'G', 3, '0'), (8, 5, 'H', 3, '[1]'),
        (10, 6, 'J', 3, 'foreign'), (11, 7, 'K', 3, 'not considered'), (12, 8, 'L', 3, 'ignored unit');
      INSERT INTO "${schema}".response VALUES (9, 1, 'I', 3, 'generated', true);
      INSERT INTO "${schema}".unit_tag VALUES
        (1, 1, 'review-alpha'), (2, 1, 'review-beta'), (3, 2, 'review-alpha'), (4, 3, 'other');
      INSERT INTO "${schema}".bookletlog VALUES
        (1, 1, 'CONTROLLER', 'RUNNING', 1000), (2, 1, 'CONTROLLER', 'TERMINATED', 61000),
        (3, 2, 'CONTROLLER', 'RUNNING', 1000), (4, 2, 'CONTROLLER', 'TERMINATED', 60000),
        (5, 3, 'CONTROLLER', 'RUNNING', 1000), (6, 3, 'CONTROLLER', 'TERMINATED', 62000),
        (7, 4, 'CONTROLLER', 'RUNNING', 1000), (8, 4, 'CONTROLLER', 'TERMINATED', 121000);
      INSERT INTO "${schema}".session VALUES
        (101, 1, 'Firefox', 'Linux', '1920x1080', 100), (102, 1, 'Chrome', 'Windows', '1280x720', 100),
        (201, 2, 'Firefox', 'Mac', '1920x1080', 100), (301, 3, 'Chrome', 'Linux', '1920x1080', 100),
        (401, 4, 'Firefox', 'Windows', '1920x1080', 100), (501, 5, 'Safari', 'Linux', '1920x1080', 100);
    `);
    const exclusions = createMock<WorkspaceExclusionService>({
      resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: ['IGNORED'], ignoredBooklets: [], testletIgnoredUnits: [] })
    });
    const anomalies = new TestResultsAnomaliesService(db.getRepository(Unit), db.getRepository(Booklet), db.getRepository(BookletLog), db.getRepository(Session), db.getRepository(UnitLog), exclusions);
    service = new TestResultsResponsesService(db.getRepository(ResponseEntity), db, exclusions, anomalies);
    filterOptionsService = new TestResultsFilterOptionsService(db.getRepository(ResponseEntity), db, exclusions);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.destroy(); }
    }
  });

  async function expectResponses(filters: Partial<FlatResponseOptions>, ids: number[], total = ids.length) {
    const [rows, actualTotal] = await service.findFlatResponses(42, { page: 1, limit: 50, ...filters });
    expect(rows.map(row => row.responseId)).toEqual(ids);
    expect(actualTotal).toBe(total);
    return rows;
  }

  it('isolates ORM and raw SQL in the fixture and excludes foreign, ignored and generated responses', async () => {
    const [{ current_schema: currentSchema }] = await db.query('SELECT current_schema()');
    expect(currentSchema).toBe(schema);
    await expectResponses({}, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('counts meaningful values while excluding NULL, whitespace and empty arrays', async () => {
    const rows = await expectResponses({ hasValue: 'yes' }, [4, 5, 6, 7, 8]);
    expect(rows.map(row => row.responseValue)).toContain('0');
  });

  it.each([
    [{ processingDurationMin: '01:00' }, [1, 2, 3, 4, 6, 7]],
    [{ processingDurationMax: '01:00' }, [1, 2, 3, 4, 5]],
    [{ processingDurationMin: '01:00', processingDurationMax: '01:00' }, [1, 2, 3, 4]],
    [{ processingDurationMin: '00:59', processingDurationMax: '01:01' }, [1, 2, 3, 4, 5, 6]]
  ])('applies inclusive duration bounds to IDs and total: %j', async (filters, ids) => {
    await expectResponses(filters, ids);
  });

  it('ignores invalid duration bounds consistently', async () => {
    await expectResponses({ processingDurationMin: '01:60', processingDurationMax: 'bad' }, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('filters selected session IDs and keeps a page-independent total', async () => {
    await expectResponses({ sessionIds: '201, invalid, -1, 501' }, [5, 8]);
    for (const [page, ids] of [[1, [1, 2]], [2, [3, 4]], [3, []]] as const) {
      await expectResponses({ sessionIds: '101', page, limit: 2 }, [...ids], 4);
    }
  });

  it('allows separate sessions to match different browser and OS dimensions', async () => {
    await expectResponses({ sessionBrowsers: 'Firefox', sessionOs: 'Windows' }, [1, 2, 3, 4, 7]);
  });

  it('counts each response once when its unit has multiple matching tags', async () => {
    const rows = await expectResponses({ tags: 'review' }, [1, 2, 3, 4, 5]);
    expect(rows[0].tags.sort()).toEqual(['review-alpha', 'review-beta']);
    await expectResponses({ tags: 'review', page: 3, limit: 2 }, [5], 5);
  });

  it('returns only the matching tags and preserves empty tags on other units', async () => {
    const matching = await expectResponses({ tags: 'review-alpha' }, [1, 2, 3, 4, 5]);
    expect(matching.every(row => row.tags.join(',') === 'review-alpha')).toBe(true);
    const rows = await expectResponses({}, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[0].tags).toEqual(['review-alpha', 'review-beta']);
    expect(rows.find(row => row.responseId === 7)?.tags).toEqual([]);
  });

  it('paginates equal display keys by response identity and retains the value prefix limit', async () => {
    await db.query(`INSERT INTO "${schema}".response (id,unitid,variableid,status,value)
      VALUES (20,1,'A',3,$1),(21,1,'A',3,'second')`, ['x'.repeat(2500)]);
    try {
      for (const [page, id] of [[1, 1], [2, 20], [3, 21]] as const) {
        const rows = await expectResponses({ response: '"A"', page, limit: 1 }, [id], 3);
        if (id === 20) expect(rows[0].responseValue).toBe('x'.repeat(2000));
      }
    } finally {
      await db.query(`DELETE FROM "${schema}".response WHERE id IN (20,21)`);
    }
  });

  it('combines value, duration, session and tag filters in the real queries', async () => {
    await expectResponses({
      hasValue: 'true',
      processingDurationMin: '00:59',
      processingDurationMax: '01:00',
      sessionIds: '101,201,501',
      tags: 'review'
    }, [4, 5]);
    await expectResponses({ hasValue: 'true', sessionIds: '101' }, [4]);
    await expectResponses({ sessionIds: '999' }, []);
  });

  it('keeps all equal sort prefixes across persons, booklets and units before response pagination', async () => {
    await db.query(`INSERT INTO persons VALUES (20,42,true,'A','tie-person','group');
      INSERT INTO bookletinfo VALUES (20,'BOOKLET_A'); INSERT INTO booklet VALUES (20,20,20);
      INSERT INTO unit SELECT i,CASE WHEN i % 2 = 0 THEN 1 ELSE 20 END,'tie-' || i,'UNIT_A'
        FROM generate_series(20,35) i;
      INSERT INTO response (id,unitid,variableid,status,value)
        SELECT 120-i,i,'A',3,'tie' FROM generate_series(20,35) i;`);
    try {
      for (const [page, id] of [[1, 1], [2, 85], [3, 86], [4, 87]] as const) {
        await expectResponses({ page, limit: 1 }, [id], 24);
      }
    } finally {
      await db.query('DELETE FROM response WHERE unitid BETWEEN 20 AND 35; DELETE FROM unit WHERE id BETWEEN 20 AND 35; DELETE FROM booklet WHERE id=20; DELETE FROM bookletinfo WHERE id=20; DELETE FROM persons WHERE id=20;');
    }
  });

  it('falls back to the full scope when empty and generated-only units consume the prefix', async () => {
    await db.query(`INSERT INTO unit VALUES (20,1,'EMPTY','000'),(21,1,'GENERATED','001');
      INSERT INTO response VALUES (30,21,'0',3,'generated',true);`);
    try {
      await expectResponses({ page: 1, limit: 1 }, [1], 8);
      await expectResponses({ page: 2, limit: 1 }, [2], 8);
    } finally {
      await db.query('DELETE FROM response WHERE id=30; DELETE FROM unit WHERE id IN (20,21);');
    }
  });

  it('retains NULL alias ordering and counts nullable legacy generation flags', async () => {
    await db.query(`INSERT INTO unit VALUES (20,1,'A',NULL);
      INSERT INTO response VALUES (30,20,'0',3,'legacy',NULL);`);
    try {
      await expectResponses({}, [1, 2, 3, 4, 30, 5, 6, 7, 8]);
      await expectResponses({ page: 5, limit: 1 }, [30], 9);
    } finally {
      await db.query('DELETE FROM response WHERE id=30; DELETE FROM unit WHERE id=20;');
    }
  });

  it.each([60000, 61001])('keeps all fourteen unfiltered facets equal to the complete filtered scope at threshold %i', async threshold => {
    await db.query(`INSERT INTO session VALUES (2,1,'Edge','Linux','small',100),(20,1,NULL,NULL,NULL,100);
      INSERT INTO bookletlog VALUES (40,2,'CURRENT_UNIT_ID','UNIT_B',1);
      UPDATE response SET is_autocoder_generated=NULL WHERE id=8;`);
    try {
      const options = { processingDurationThresholdMs: threshold };
      const actual = await filterOptionsService.findFlatResponseFilterOptions(42, options);
      // '%' matches every non-null code in this fixture and exercises the existing filtered path.
      const expected = await filterOptionsService.findFlatResponseFilterOptions(42, { ...options, code: '%' });
      expect(actual).toEqual(expected);
      expect(Object.keys(actual)).toHaveLength(14);
      expect(actual.sessionIds.slice(0, 2)).toEqual(['2', '20']);
      expect(actual.unitProgresses).toEqual(['Vollständig', 'Unvollständig']);
      expect(actual.units).not.toContain('IGNORED');
    } finally {
      await db.query('DELETE FROM session WHERE id IN (2,20); DELETE FROM bookletlog WHERE id=40; UPDATE response SET is_autocoder_generated=false WHERE id=8;');
    }
  });

  it('preserves the ordered 500-value facet cap at high cardinality', async () => {
    await db.query(`INSERT INTO persons SELECT i,42,true,'code-' || i,'login-' || i,'bulk' FROM generate_series(1000,1509) i;
      INSERT INTO booklet SELECT i,i,1 FROM generate_series(1000,1509) i;
      INSERT INTO unit SELECT i,i,'name-' || i,'unit-' || i FROM generate_series(1000,1509) i;
      INSERT INTO response (id,unitid,variableid,status,value) SELECT i,i,'variable-' || i,3,'value' FROM generate_series(1000,1509) i;`);
    try {
      const actual = await filterOptionsService.findFlatResponseFilterOptions(42, {});
      const expected = await filterOptionsService.findFlatResponseFilterOptions(42, { code: '%' });
      expect(actual).toEqual(expected);
      for (const values of [actual.codes, actual.logins, actual.units, actual.responses]) expect(values).toHaveLength(500);
    } finally {
      await db.query('DELETE FROM response WHERE unitid BETWEEN 1000 AND 1509; DELETE FROM unit WHERE id BETWEEN 1000 AND 1509; DELETE FROM booklet WHERE id BETWEEN 1000 AND 1509; DELETE FROM persons WHERE id BETWEEN 1000 AND 1509;');
    }
  });

  it('returns zero and empty facets for a workspace with no eligible units', async () => {
    await expect(service.findFlatResponses(44, { page: 1, limit: 50 })).resolves.toEqual([[], 0]);
    const options = await filterOptionsService.findFlatResponseFilterOptions(44, {});
    expect(Object.keys(options)).toHaveLength(14);
    expect(Object.values(options)).toEqual(Array(14).fill([]));
  });

  it('reads the array count and page through the supplied transaction connection', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("INSERT INTO response VALUES (30,1,'Z',3,'not committed',NULL)");
      const [rows, total] = await service.findFlatResponses(42, { page: 1, limit: 50 }, runner);
      expect(total).toBe(9);
      expect(rows.map(row => row.responseId)).toEqual([1, 2, 3, 4, 30, 5, 6, 7, 8]);
      const [outsideRows, outsideTotal] = await service.findFlatResponses(42, { page: 1, limit: 50 });
      expect(outsideTotal).toBe(8);
      expect(outsideRows.map(row => row.responseId)).not.toContain(30);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
