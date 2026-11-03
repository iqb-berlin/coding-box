import { createMock } from '@golevelup/ts-jest';
import { DataSource } from 'typeorm';
import { TestResultsResponsesService } from './test-results-responses.service';
import { TestResultsAnomaliesService } from './test-results-anomalies.service';
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
});
