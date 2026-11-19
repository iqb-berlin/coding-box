import { createMock } from '@golevelup/ts-jest';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { DataSource } from 'typeorm';
import { PersonQueryService } from './person-query.service';
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
  let exclusionService: WorkspaceExclusionService;

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
      CREATE TABLE "${schema}".bookletinfo (id INT PRIMARY KEY, name TEXT);
      CREATE UNLOGGED TABLE "${schema}".booklet (id INT PRIMARY KEY, personid INT, infoid INT);
      CREATE UNLOGGED TABLE "${schema}".unit (id INT PRIMARY KEY, bookletid INT, name TEXT, alias TEXT);
      CREATE UNLOGGED TABLE "${schema}".response (
        id INT PRIMARY KEY, unitid INT REFERENCES "${schema}".unit(id) ON DELETE CASCADE, variableid TEXT, status SMALLINT, value TEXT,
        is_autocoder_generated BOOLEAN DEFAULT false, code_v2 BIGINT);
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
      UPDATE "${schema}".response SET is_autocoder_generated = NULL WHERE id = 4;
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
    exclusionService = createMock<WorkspaceExclusionService>({
      resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: ['IGNORED'], ignoredBooklets: [], testletIgnoredUnits: [] })
    });
    filterOptionsService = new TestResultsFilterOptionsService(db.getRepository(ResponseEntity), db, exclusionService);
  });

  beforeEach(() => {
    const anomalies = new TestResultsAnomaliesService(db.getRepository(Unit), db.getRepository(Booklet), db.getRepository(BookletLog), db.getRepository(Session), db.getRepository(UnitLog), exclusionService);
    service = new TestResultsResponsesService(db.getRepository(ResponseEntity), db, exclusionService, anomalies);
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

  const readChanges = (name: string) => readFileSync(resolvePath(`database/changelog/coding-box.changelog-${name}.sql`), 'utf8')
    .replace(/\bpublic\./g, `"${schema}".`)
    .split(/^-- changeset .*$/m).slice(1);

  const rollbackSql = (changeset: string) => [...changeset.matchAll(/^--rollback (.*)$/gm)]
    .map(match => match[1]).join('\n');

  describe('migrated response projections', () => {
    const [payloadChangeset] = readChanges('first-page-responses');
    const changes = [...readChanges('response-list-search'), payloadChangeset, ...readChanges('response-projection-recovery')];
    let original: Awaited<ReturnType<typeof service.findFlatResponses>>;
    const dictionary = 'SELECT value_prefix FROM flat_response_value_search_value WHERE value_prefix = $1';

    beforeEach(async () => {
      original = await service.findFlatResponses(42, { page: 1, limit: 50 });
      await db.transaction(async manager => {
        // Use the base changelog's operator class, or install it in the disposable fixture.
        await manager.query(`SET LOCAL search_path = "${schema}", pg_catalog, public`);
        await manager.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await manager.query('CREATE TABLE workspace (id int PRIMARY KEY)');
        await manager.query('INSERT INTO workspace VALUES (42), (43)');
        for (const sql of changes) await manager.query(sql);
      });
    });

    afterEach(async () => {
      await db.transaction(async manager => {
        for (const changeset of [...changes].reverse()) {
          await manager.query(rollbackSql(changeset));
        }
        await manager.query('DELETE FROM response WHERE id IN (999, 1000, 1001)');
        await manager.query('DELETE FROM unit WHERE id = 44');
        await manager.query('DELETE FROM booklet WHERE id = 44');
        await manager.query('DELETE FROM bookletinfo WHERE id = 44');
        await manager.query('DELETE FROM persons WHERE id = 44');
        await manager.query('UPDATE persons SET workspace_id = 42, consider = true WHERE id = 1');
        await manager.query('DROP TABLE workspace');
      });
      await expect(service.findFlatResponses(42, { page: 1, limit: 50 })).resolves.toEqual(original);
    });

    it('skips counter maintenance for coding updates and updates counts for eligibility and unit moves', async () => {
      const [plan] = await db.query('EXPLAIN (ANALYZE, FORMAT JSON) UPDATE response SET code_v2 = 42 WHERE id = 4');
      expect(plan['QUERY PLAN'][0].Triggers).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ 'Trigger Name': 'flat_response_unit_count_update' })
      ]));

      await db.transaction(async manager => {
        const counts = () => manager.query('SELECT total::int FROM flat_response_unit_count WHERE unitid IN (2, 3) ORDER BY unitid');
        await manager.query("INSERT INTO response VALUES (999, 2, 'MOVED', 3, 'move', NULL)");
        await manager.query('UPDATE response SET unitid = 3 WHERE id = 999');
        await expect(counts()).resolves.toEqual([{ total: 1 }, { total: 2 }]);
        await manager.query('UPDATE response SET is_autocoder_generated = true WHERE id = 999');
        await expect(counts()).resolves.toEqual([{ total: 1 }, { total: 1 }]);
        await manager.query('UPDATE response SET unitid = 2, is_autocoder_generated = false WHERE id = 999');
        await manager.query('UPDATE response SET is_autocoder_generated = NULL WHERE id = 999');
      });
      await expect(db.query('SELECT unitid, total::int FROM flat_response_unit_count WHERE unitid IN (2, 3) ORDER BY unitid'))
        .resolves.toEqual([{ unitid: 2, total: 2 }, { unitid: 3, total: 1 }]);
      await expectResponses({}, [1, 2, 3, 4, 5, 999, 6, 7, 8]);
    });

    it('repairs only the requested workspace before publishing rebuilt totals and payloads', async () => {
      await db.query(`
        DELETE FROM flat_response_first_page_response WHERE id = 4;
        UPDATE flat_response_first_page_response SET unitid = 1 WHERE id = 10;
        UPDATE flat_response_first_page_response SET status = 0, value_prefix = 'stale' WHERE id = 2;
        UPDATE flat_response_unit_count SET total = 99 WHERE unitid IN (1, 6);
        SELECT rebuild_flat_response_workspace(42)
      `);
      await expect(service.findFlatResponses(42, { page: 1, limit: 50 })).resolves.toEqual(original);
      await expect(db.query('SELECT total::int FROM flat_response_unit_count WHERE unitid = 6'))
        .resolves.toEqual([{ total: 99 }]);
      await expect(db.query('SELECT id FROM flat_response_first_page_response WHERE id = 10')).resolves.toEqual([]);
    });

    it('reads the complete first page when compact payloads are installed after the reader snapshot', async () => {
      await db.query(rollbackSql(payloadChangeset));
      const createRunner = db.createQueryRunner.bind(db);
      let installed = false;
      const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
        const runner = createRunner(...args);
        const query = runner.query.bind(runner);
        jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
          if (!installed && typeof sql === 'string' && sql.includes('pg_current_snapshot()')) {
            await query('SELECT pg_current_snapshot()');
            await db.transaction(installer => installer.query(payloadChangeset));
            installed = true;
          }
          return query(sql, parameters, structured);
        });
        return runner;
      });
      try {
        await expect(service.findFlatResponses(42, { page: 1, limit: 50 })).resolves.toEqual(original);
        expect(installed).toBe(true);
      } finally {
        runners.mockRestore();
      }
    });

    it('retries a delete whose snapshot predates the compact payload installation', async () => {
      await db.query(rollbackSql(payloadChangeset));
      await db.query("INSERT INTO response VALUES (999, 1, 'NEW', 3, 'before installation', false)");
      const remove = 'DELETE FROM response WHERE id = 999';
      await expect(db.transaction('REPEATABLE READ', async writer => {
        await writer.query('SELECT pg_current_snapshot()');
        await db.transaction(installer => installer.query(payloadChangeset));
        await writer.query(remove);
      })).rejects.toMatchObject({ code: '40001' });

      await db.transaction('REPEATABLE READ', writer => writer.query(remove));
      await expect(db.query('SELECT id FROM flat_response_first_page_response WHERE id = 999')).resolves.toEqual([]);
      await expect(service.findFlatResponses(42, { page: 1, limit: 50 })).resolves.toEqual(original);
    });

    it('retries a booklet rename when the first workspace association committed after its snapshot', async () => {
      await db.query("INSERT INTO bookletinfo VALUES (44, 'BEFORE_RENAME')");
      const rename = "UPDATE bookletinfo SET name = 'AFTER_RENAME' WHERE id = 44";
      await expect(db.transaction('REPEATABLE READ', async editor => {
        await editor.query('SELECT pg_current_snapshot()');
        await db.query(`
          INSERT INTO booklet VALUES (44, 1, 44);
          INSERT INTO unit VALUES (44, 44, 'NEW_UNIT', 'NEW_UNIT');
          INSERT INTO response VALUES (999, 44, 'NEW', 3, 'rename test', false);
        `);
        await editor.query(rename);
      })).rejects.toMatchObject({ code: '40001' });

      await db.transaction('REPEATABLE READ', editor => editor.query(rename));
      await expect(db.query('SELECT workspace_id, ready FROM flat_response_first_page_workspace ORDER BY workspace_id'))
        .resolves.toEqual([{ workspace_id: 42, ready: false }, { workspace_id: 43, ready: true }]);
      const rows = await expectResponses({ responseValue: 'rename test' }, [999]);
      expect(rows[0].booklet).toBe('AFTER_RENAME');
      await db.query('SELECT rebuild_flat_response_workspace(42)');
      for (const filters of [{}, { responseValue: 'rename test' }]) {
        jest.mocked(exclusionService.resolveExclusionsForQueries).mockResolvedValueOnce({
          globalIgnoredUnits: ['IGNORED'], ignoredBooklets: ['AFTER_RENAME'], testletIgnoredUnits: []
        });
        await expectResponses(filters, filters.responseValue ? [] : original[0].map(row => row.responseId));
      }
    });

    it('backfills the projections and reads through a workspace move and rebuild', async () => {
      await expect(service.findFlatResponses(42, { page: 1, limit: 50 })).resolves.toEqual(original);
      await expect(db.query('SELECT id FROM flat_response_first_page_response WHERE id IN (4, 9)'))
        .resolves.toEqual([{ id: 4 }]);
      await expectResponses({ responseValue: 'answer' }, [4, 5, 6]);
      await db.query(`
        INSERT INTO response VALUES (999, 2, 'NEW', 3, 'new answer', false);
        UPDATE response SET value = 'edited answer' WHERE id = 999;
      `);
      await expectResponses({ responseValue: 'edited answer' }, [999]);
      const cachedCounts = 'SELECT COALESCE(sum(total), 0)::int AS n FROM flat_response_first_page_total WHERE workspace_id = $1';
      await expect(db.query(cachedCounts, [42])).resolves.toEqual([{ n: 10 }]);
      await db.query('UPDATE response SET is_autocoder_generated = true WHERE id = 999');
      await expectResponses({}, [1, 2, 3, 4, 5, 6, 7, 8]);
      await db.query(`
        UPDATE response SET is_autocoder_generated = NULL, value = repeat('ö', 2001) WHERE id = 999
      `);
      const editedRows = await expectResponses({}, [1, 2, 3, 4, 5, 999, 6, 7, 8]);
      expect(editedRows.find(row => row.responseId === 999)?.responseValue).toBe('ö'.repeat(2000));
      await db.query("UPDATE response SET value = 'edited answer' WHERE id = 999");

      await db.query(`
        INSERT INTO workspace VALUES (44);
        WITH people AS (INSERT INTO persons VALUES (44, 44, true, 'CTE', 'cte', 'group') RETURNING id),
          booklets AS (INSERT INTO booklet SELECT 44, id, 1 FROM people RETURNING id),
          units AS (INSERT INTO unit SELECT 44, id, 'CTE_UNIT', 'CTE_UNIT' FROM booklets RETURNING id)
        INSERT INTO response SELECT 1000, id, 'NEW', 3, 'same statement', false FROM units
      `);
      const [cteRows, cteTotal] = await service.findFlatResponses(44, {
        page: 1, limit: 50, responseValue: 'same statement'
      });
      expect(cteRows.map(row => row.responseId)).toEqual([1000]);
      expect(cteTotal).toBe(1);
      await expect(service.findFlatResponses(44, { page: 1, limit: 50 }))
        .resolves.toEqual([cteRows, 1]);

      await db.query('UPDATE persons SET workspace_id = 43 WHERE id = 1');
      await expectResponses({ responseValue: 'answer' }, []);
      await db.query('SELECT rebuild_flat_response_workspace(43)');
      const [movedRows] = await service.findFlatResponses(43, { page: 1, limit: 50, responseValue: 'edited answer' });
      expect(movedRows.map(row => row.responseId)).toEqual([999]);
      await db.query('DELETE FROM response WHERE id = 999');
      const [deletedRows] = await service.findFlatResponses(43, { page: 1, limit: 50, responseValue: 'edited answer' });
      expect(deletedRows).toEqual([]);
      await expect(db.query(dictionary, ['edited answer'])).resolves.toEqual([]);
      await expect(db.query('SELECT id FROM flat_response_first_page_response WHERE id = 999'))
        .resolves.toEqual([]);
      await db.transaction(async manager => {
        await manager.query('SAVEPOINT before_truncate');
        await manager.query('TRUNCATE response');
        await expect(manager.query('SELECT id FROM flat_response_first_page_response')).resolves.toEqual([]);
        await manager.query('ROLLBACK TO SAVEPOINT before_truncate');
      });
    });

    it('counts a response inserted by a CTE before the outer unit insert', async () => {
      await db.query(`
        WITH answer AS (
          INSERT INTO response VALUES (999, 44, 'NEW', 3, 'response first', false) RETURNING unitid
        )
        INSERT INTO unit SELECT unitid, 1, 'NEW_UNIT', 'NEW_UNIT' FROM answer
      `);
      const [rows, total] = await service.findFlatResponses(42, { page: 1, limit: 50 });
      expect(rows.map(row => row.responseId)).toContain(999);
      expect(total).toBe(original[1] + 1);
      expect(total).toBe(rows.length);
      await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42'))
        .resolves.toEqual([{ ready: true }]);
    });

    it('removes the count when deleting a unit cascades to its last response', async () => {
      await db.query(`
        INSERT INTO unit VALUES (44, 1, 'NEW_UNIT', 'NEW_UNIT');
        INSERT INTO response VALUES (999, 44, 'NEW', 3, 'new answer', false);
        DELETE FROM unit WHERE id = 44
      `);
      await expect(db.query('SELECT total FROM flat_response_unit_count WHERE unitid = 44')).resolves.toEqual([]);
    });

    it.each(['rebuilt answer', null])('rejects a stale write of %p after rebuild and indexes its retry', async value => {
      await db.query("UPDATE persons SET login = login || 'x' WHERE id = 1");
      const insert = "INSERT INTO response VALUES (999, 2, 'NEW', 3, $1, false)";
      try {
        await expect(db.transaction('REPEATABLE READ', async writer => {
          const state = await writer.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42');
          expect(state).toEqual([{ ready: false }]);
          await db.query('SELECT rebuild_flat_response_workspace(42)');
          await writer.query(insert, [value]);
        })).rejects.toMatchObject({ code: '40001' });

        await db.transaction('REPEATABLE READ', writer => writer.query(insert, [value]));
        await expectResponses({}, [1, 2, 3, 4, 5, 999, 6, 7, 8]);
        await expectResponses({ responseValue: 'rebuilt answer' }, value ? [999] : []);
      } finally {
        await db.query('DELETE FROM response WHERE id = 999');
        await db.query("UPDATE persons SET login = 'person' WHERE id = 1");
      }
    });

    it('keeps the source query active when the rebuild itself has a pre-import snapshot', async () => {
      await db.query("UPDATE persons SET login = 'before rebuild' WHERE id = 1");
      try {
        await expect(db.transaction('REPEATABLE READ', async maintenance => {
          const state = await maintenance.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42');
          expect(state).toEqual([{ ready: false }]);
          await db.query("INSERT INTO response VALUES (999, 2, 'NEW', 3, 'before rebuild', false)");
          await maintenance.query('SELECT rebuild_flat_response_workspace(42)');
        })).rejects.toMatchObject({ code: '25000' });
        await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42'))
          .resolves.toEqual([{ ready: false }]);
        await db.query('SELECT rebuild_flat_response_workspace(42)');
        await expectResponses({ responseValue: 'before rebuild' }, [999]);
        await expectResponses({}, [1, 2, 3, 4, 5, 999, 6, 7, 8]);
      } finally {
        await db.query("UPDATE persons SET login = 'person' WHERE id = 1");
      }
    });

    it('finds an answer inserted before workspace registration in the same statement', async () => {
      await db.query(`
        WITH answer AS (INSERT INTO response VALUES (999, 44, 'NEW', 3, 'early answer', false) RETURNING unitid),
          units AS (INSERT INTO unit SELECT unitid, 44, 'NEW', 'NEW' FROM answer RETURNING bookletid),
          booklets AS (INSERT INTO booklet SELECT bookletid, 44, 1 FROM units RETURNING personid),
          people AS (INSERT INTO persons SELECT personid, 44, true, 'CTE', 'cte', 'group' FROM booklets RETURNING workspace_id)
        INSERT INTO workspace SELECT workspace_id FROM people
      `);
      const options = { page: 1, limit: 50 };
      const list = await service.findFlatResponses(44, options);
      expect(list[0].map(row => row.responseId)).toEqual([999]);
      expect(list[1]).toBe(1);
      await expect(service.findFlatResponses(44, { ...options, responseValue: 'early answer' })).resolves.toEqual(list);
      await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 44'))
        .resolves.toEqual([{ ready: false }]);
      await db.query('SELECT rebuild_flat_response_workspace(44)');
      await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 44'))
        .resolves.toEqual([{ ready: true }]);
      await expect(service.findFlatResponses(44, { ...options, responseValue: 'early answer' })).resolves.toEqual(list);
    });

    it('commits parallel replacements that swap the last links to two prefixes', async () => {
      await db.query(`
        INSERT INTO response VALUES (999, 1, 'A2', 3, 'left prefix', false),
          (1001, 2, 'B2', 3, 'right prefix', false)
      `);
      const replace = 'INSERT INTO response VALUES ($1, $2, $3, 3, $4, false)';
      // Hold both deletions open before either importer looks up the other prefix.
      await db.transaction(async left => {
        await left.query("SET LOCAL lock_timeout = '4s'");
        await left.query('DELETE FROM response WHERE id = 999');
        await db.transaction(async right => {
          await right.query("SET LOCAL lock_timeout = '4s'");
          await right.query('DELETE FROM response WHERE id = 1001');
          await Promise.all([
            left.query(replace, [999, 1, 'A2', 'right prefix']),
            right.query(replace, [1001, 2, 'B2', 'left prefix'])
          ]);
        });
      });
      await expectResponses({ responseValue: 'left prefix' }, [1001]);
      await expectResponses({ responseValue: 'right prefix' }, [999]);
      await expect(db.query(dictionary, ['left prefix'])).resolves.toHaveLength(1);
      await expect(db.query(dictionary, ['right prefix'])).resolves.toHaveLength(1);
    });

    it('keeps the projected page, count and value search current across a concurrent import and visibility change', async () => {
      await db.transaction(async importer => {
        await importer.query("INSERT INTO response VALUES (999, 2, 'NEW', 3, 'imported answer', false)");
        await db.query('UPDATE persons SET consider = false WHERE id = 1');
      });
      await expectResponses({}, []);
      await expectResponses({ responseValue: 'answer' }, []);
      await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42'))
        .resolves.toEqual([{ ready: true }]);
      await db.query('UPDATE persons SET consider = true WHERE id = 1');
      await expectResponses({}, [1, 2, 3, 4, 5, 999, 6, 7, 8]);
      await expectResponses({ responseValue: 'imported answer' }, [999]);
      await expect(db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = 42'))
        .resolves.toEqual([{ ready: true }]);
    });

    it('removes an obsolete prefix when concurrent writers release its last links', async () => {
      await db.query(`
        INSERT INTO response VALUES (999, 1, 'A2', 3, 'shared prefix', false),
          (1001, 2, 'B2', 3, 'shared prefix', false)
      `);
      await expect(db.query(dictionary, ['shared prefix'])).resolves.toHaveLength(1);
      let removal: Promise<unknown> | undefined;
      await db.transaction(async writer => {
        await writer.query("UPDATE response SET value = 'replacement' WHERE id = 999");
        // The second writer starts before the first commits. It must recheck the remaining links.
        removal = db.query('DELETE FROM response WHERE id = 1001');
      });
      await removal;
      await expect(db.query(dictionary, ['shared prefix'])).resolves.toEqual([]);
      await expectResponses({ responseValue: 'replacement' }, [999]);
    });
  });

  it('counts only in-scope answers in upload statistics, including legacy null autocoder flags', async () => {
    const importExclusions = createMock<WorkspaceExclusionService>({
      resolveExclusionsForQueries: async () => ({
        globalIgnoredUnits: ['ignored.xml'],
        ignoredBooklets: ['booklet_b'],
        testletIgnoredUnits: [{ bookletId: 'booklet_c', unitId: 'unit_c.xml' }]
      })
    });
    const personQuery = new PersonQueryService(
      db.getRepository(Persons),
      db.getRepository(Booklet),
      db.getRepository(Unit),
      db.getRepository(ResponseEntity),
      db.getRepository(BookletLog),
      importExclusions
    );
    await expect(personQuery.getWorkspaceUploadStats(42)).resolves.toEqual({
      testPersons: 1,
      testGroups: 1,
      uniqueBooklets: 4,
      uniqueUnits: 3,
      uniqueResponses: 6
    });
  });

  it('shares an overlapping unfiltered count for different page sizes in the same snapshot', async () => {
    let countQueries = 0;
    let snapshots = 0;
    let releaseCount!: () => void;
    const countReleased = new Promise<void>(resolve => { releaseCount = resolve; });
    const createRunner = db.createQueryRunner.bind(db);
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
        if (typeof sql === 'string' && sql.includes('pg_current_snapshot()')) {
          const snapshot = await query(sql, parameters, structured);
          snapshots += 1;
          if (snapshots === 2) setImmediate(releaseCount);
          return snapshot;
        }
        if (typeof sql === 'string' && sql.includes('"counted_response"')) {
          countQueries += 1;
          await countReleased;
        }
        return query(sql, parameters, structured);
      });
      return runner;
    });
    try {
      const [[first, firstTotal], [second, secondTotal]] = await Promise.all([
        service.findFlatResponses(42, { page: 1, limit: 2 }),
        service.findFlatResponses(42, { page: 2, limit: 3 })
      ]);
      expect(first.map(row => row.responseId)).toEqual([1, 2]);
      expect(second.map(row => row.responseId)).toEqual([4, 5, 6]);
      expect([firstTotal, secondTotal]).toEqual([8, 8]);
      expect(countQueries).toBe(1);
    } finally {
      releaseCount();
      runners.mockRestore();
    }
  });

  it('reads the source count when a repeatable-read snapshot predates the counter backfill', async () => {
    const [counterChangeset] = readChanges('response-list-search');
    const options = { page: 2, limit: 3 };
    const expected = await service.findFlatResponses(42, options);
    try {
      await db.transaction('REPEATABLE READ', async reader => {
        await reader.query('SELECT pg_current_snapshot()');
        await db.transaction(installer => installer.query(counterChangeset));
        await expect(service.findFlatResponses(42, options, reader.queryRunner)).resolves.toEqual(expected);
      });
      await expect(service.findFlatResponses(42, options)).resolves.toEqual(expected);
    } finally {
      await db.query(rollbackSql(counterChangeset));
    }
  });

  it('keeps exact page totals and ordering with provisioned per-unit counts', async () => {
    await db.query(`CREATE TABLE "${schema}".flat_response_unit_count AS
      SELECT unitid, COUNT(*) AS total FROM "${schema}".response
      WHERE is_autocoder_generated IS NOT TRUE GROUP BY unitid`);
    try {
      await expectResponses({ page: 1, limit: 3 }, [1, 2, 3], 8);
      await expectResponses({ page: 3, limit: 3 }, [7, 8], 8);
      await expectResponses({ page: 4, limit: 3 }, [], 8);
      jest.mocked(exclusionService.resolveExclusionsForQueries).mockResolvedValueOnce({
        globalIgnoredUnits: ['IGNORED', 'UNIT_E'], ignoredBooklets: [], testletIgnoredUnits: []
      });
      await expectResponses({ page: 3, limit: 3 }, [7], 7);
    } finally {
      await db.query(`DROP TABLE "${schema}".flat_response_unit_count`);
    }
  });

  async function installFirstPageProjection(compact = false) {
    await db.query(`
      CREATE TABLE flat_response_first_page_workspace (workspace_id int, ready boolean);
      INSERT INTO flat_response_first_page_workspace VALUES (42, true);
      CREATE TABLE flat_response_first_page_unit AS
        SELECT u.id AS unit_id, p.workspace_id, p.consider, p.id AS person_id,
          p.code AS person_code, p.login AS person_login, p."group" AS person_group,
          b.id AS booklet_id, bi.name AS booklet_name, u.name AS unit_name, u.alias AS unit_alias
        FROM unit u JOIN booklet b ON b.id=u.bookletid JOIN bookletinfo bi ON bi.id=b.infoid
        JOIN persons p ON p.id=b.personid WHERE p.workspace_id=42;
      CREATE TABLE flat_response_unit_count AS
        SELECT unitid, COUNT(*) AS total FROM response
        WHERE is_autocoder_generated IS NOT TRUE GROUP BY unitid;
    `);
    if (compact) {
      await db.query(`CREATE TABLE flat_response_first_page_response AS
        SELECT id, unitid, variableid, status, left(value, 2000) AS value_prefix
        FROM response WHERE is_autocoder_generated IS NOT TRUE`);
    }
  }

  it.each(['units', 'totals', 'compact'])('uses the projected first page with %s only while the workspace projection is ready', async projection => {
    const options = { page: 1, limit: 3 };
    const reference = await service.findFlatResponses(42, options);
    await installFirstPageProjection(projection === 'compact');
    if (projection !== 'units') {
      await db.query(`CREATE TABLE flat_response_first_page_total AS
        SELECT u.workspace_id, u.booklet_name, u.unit_name, SUM(n.total) AS total
        FROM flat_response_first_page_unit u JOIN flat_response_unit_count n ON n.unitid=u.unit_id
        WHERE u.consider IS TRUE GROUP BY 1, 2, 3`);
    }
    const createRunner = db.createQueryRunner.bind(db);
    const projectionRowCounts: number[] = [];
    const projectedTotalReads: boolean[] = [];
    const compactReads: boolean[] = [];
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
        const result = await query(sql, parameters, structured);
        if (typeof sql === 'string' && sql.includes('first_page_rows AS MATERIALIZED')) {
          projectionRowCounts.push(result.length);
          projectedTotalReads.push(sql.includes('flat_response_first_page_total'));
          compactReads.push(sql.includes('flat_response_first_page_response'));
        }
        return result;
      });
      return runner;
    });
    try {
      await expect(service.findFlatResponses(42, options)).resolves.toEqual(reference);
      jest.mocked(exclusionService.resolveExclusionsForQueries).mockResolvedValueOnce({
        globalIgnoredUnits: ['IGNORED', 'UNIT_A'], ignoredBooklets: [], testletIgnoredUnits: []
      });
      await expectResponses(options, [5, 6, 7], 4);
      expect(projectionRowCounts).toEqual([3, 3]);

      await db.query('UPDATE flat_response_first_page_workspace SET ready = false');
      await expect(service.findFlatResponses(42, options)).resolves.toEqual(reference);
      expect(projectionRowCounts).toEqual([3, 3, 0]);
      expect(projectedTotalReads).toEqual(Array(3).fill(projection !== 'units'));
      expect(compactReads).toEqual(Array(3).fill(projection === 'compact'));
    } finally {
      runners.mockRestore();
      await db.query('DROP TABLE IF EXISTS flat_response_first_page_total, flat_response_first_page_response');
      await db.query(`DROP TABLE flat_response_first_page_workspace, flat_response_first_page_unit,
        flat_response_unit_count`);
    }
  });

  it('reuses completed unfiltered results only while the workspace snapshot and exclusions match', async () => {
    let countQueries = 0;
    let unitQueries = 0;
    let pageQueries = 0;
    const createRunner = db.createQueryRunner.bind(db);
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation((sql, parameters, structured) => {
        if (typeof sql === 'string' && sql.includes('"counted_response"')) countQueries += 1;
        if (typeof sql === 'string' && sql.includes('ROWS WITH TIES')) unitQueries += 1;
        if (typeof sql === 'string' && sql.includes('AS "responseId"')) pageQueries += 1;
        return query(sql, parameters, structured);
      });
      return runner;
    });

    try {
      await expectResponses({ page: 1, limit: 2 }, [1, 2], 8);
      await expectResponses({ page: 2, limit: 3 }, [4, 5, 6], 8);
      await expectResponses({ page: 1, limit: 2 }, [1, 2], 8);
      expect(countQueries).toBe(1);
      expect(unitQueries).toBe(2);
      expect(pageQueries).toBe(2);

      jest.mocked(exclusionService.resolveExclusionsForQueries).mockResolvedValueOnce({
        globalIgnoredUnits: ['IGNORED', 'UNIT_E'], ignoredBooklets: [], testletIgnoredUnits: []
      });
      await expectResponses({ page: 1, limit: 2 }, [1, 2], 7);
      expect(countQueries).toBe(2);
      expect(unitQueries).toBe(3);
      expect(pageQueries).toBe(3);

      await db.query(`INSERT INTO "${schema}".response (id, unitid, variableid, status, value)
        VALUES (99, 1, 'NEW', 3, 'committed after the cached count')`);
      await expectResponses({ page: 1, limit: 2 }, [1, 2], 9);
      expect(countQueries).toBe(3);
      expect(unitQueries).toBe(4);
      expect(pageQueries).toBe(4);
    } finally {
      runners.mockRestore();
      await db.query(`DELETE FROM "${schema}".response WHERE id = 99`);
    }
  });

  it.each(['unfiltered', 'value search'] as const)('releases the pool connection while an identical %s page is loading', async kind => {
    const valueSearch = kind === 'value search';
    const pageStatement = valueSearch ? '"flat_response_value_matches"' : 'AS "responseId"';
    let pageQueries = 0;
    let startRead!: () => void;
    let finishRead!: () => void;
    const readStarted = new Promise<void>(resolve => { startRead = resolve; });
    const readCanFinish = new Promise<void>(resolve => { finishRead = resolve; });
    const createRunner = db.createQueryRunner.bind(db);
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
        if (typeof sql === 'string' && sql.includes(pageStatement)) {
          pageQueries += 1;
          if (pageQueries === 1) {
            startRead();
            await readCanFinish;
          }
        }
        const result = await query(sql, parameters, structured);
        if (sql === 'COMMIT') finishRead();
        return result;
      });
      return runner;
    });
    const options = { ...(valueSearch ? { responseValue: 'answer' } : {}), page: 1, limit: 1 };
    const ids = valueSearch ? [4] : [1];
    const total = valueSearch ? 3 : 8;
    const changedId = valueSearch ? 4 : 1;
    const first = expectResponses(options, ids, total);
    try {
      await readStarted;
      await Promise.all([first, expectResponses(options, ids, total)]);
      await expectResponses(options, ids, total);
      expect(pageQueries).toBe(1);

      await expectResponses({ ...options, page: 2 }, valueSearch ? [5] : [2], total);
      await expectResponses({ ...options, responseValue: 'answer B' }, [5]);
      expect(pageQueries).toBe(3);

      await db.query('UPDATE response SET value = $1 WHERE id = $2', ['changed', changedId]);
      if (valueSearch) {
        await expectResponses(options, [5], 2);
      } else {
        const rows = await expectResponses(options, [1], 8);
        expect(rows[0].responseValue).toBe('changed');
      }
      expect(pageQueries).toBe(4);
    } finally {
      finishRead();
      runners.mockRestore();
      await first;
      await db.query('UPDATE response SET value = $1 WHERE id = $2', [valueSearch ? 'answer A' : null, changedId]);
    }
  });

  it('maps a value search timeout and retries the same page on the same snapshot', async () => {
    let firstRead = true;
    const createRunner = db.createQueryRunner.bind(db);
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
        if (firstRead && typeof sql === 'string' && sql.includes('"flat_response_value_matches"')) {
          firstRead = false;
          await query("SET LOCAL statement_timeout = '5ms'");
          await query('SELECT pg_sleep(0.05)');
        }
        return query(sql, parameters, structured);
      });
      return runner;
    });
    try {
      const options = { responseValue: 'answer', page: 1, limit: 1 };
      await expect(service.findFlatResponses(42, options)).rejects.toMatchObject({
        response: { code: 'SEARCH_TIMEOUT', field: 'responseValue' }
      });
      await expectResponses(options, [4], 3);
    } finally {
      runners.mockRestore();
    }
  });

  it.each(['insertion', 'deletion', 'exclusion'] as const)('counts the new scope after %s while an older read is still counting', async change => {
    let releaseCount!: () => void;
    let startedCount!: () => void;
    const countReleased = new Promise<void>(resolve => { releaseCount = resolve; });
    const countStarted = new Promise<void>(resolve => { startedCount = resolve; });
    const createRunner = db.createQueryRunner.bind(db);
    let snapshots = 0;
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation(async (sql, parameters, structured) => {
        if (typeof sql === 'string' && sql.includes('pg_current_snapshot()')) {
          const snapshot = await query(sql, parameters, structured);
          snapshots += 1;
          if (snapshots === 2) setImmediate(releaseCount);
          return snapshot;
        }
        if (typeof sql === 'string' && sql.includes('"counted_response"') && snapshots === 1) {
          startedCount();
          await countReleased;
        }
        return query(sql, parameters, structured);
      });
      return runner;
    });
    const oldPage = service.findFlatResponses(42, { page: 1, limit: 50 });
    try {
      await Promise.race([countStarted, oldPage.then(() => { throw new Error('Old snapshot did not start counting'); })]);
      if (change === 'insertion') {
        await db.query(`INSERT INTO "${schema}".response (id, unitid, variableid, status, value)
          VALUES (99, 1, 'NEW', 3, 'committed after the old snapshot')`);
        await expectResponses({}, [1, 2, 3, 4, 99, 5, 6, 7, 8]);
      } else if (change === 'deletion') {
        await db.query(`DELETE FROM "${schema}".response WHERE id = 8`);
        await expectResponses({}, [1, 2, 3, 4, 5, 6, 7]);
      } else {
        jest.mocked(exclusionService.resolveExclusionsForQueries).mockResolvedValueOnce({
          globalIgnoredUnits: ['IGNORED', 'UNIT_E'], ignoredBooklets: [], testletIgnoredUnits: []
        });
        await expectResponses({}, [1, 2, 3, 4, 5, 6, 7]);
      }
    } finally {
      releaseCount();
      runners.mockRestore();
      await oldPage;
      if (change === 'insertion') await db.query(`DELETE FROM "${schema}".response WHERE id = 99`);
      if (change === 'deletion') {
        await db.query(`INSERT INTO "${schema}".response (id, unitid, variableid, status, value)
          VALUES (8, 5, 'H', 3, '[1]') ON CONFLICT DO NOTHING`);
      }
    }
    const [oldRows, oldTotal] = await oldPage;
    expect(oldRows.map(row => row.responseId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(oldTotal).toBe(8);
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

  it('shares the exact value-search total across pages, including an empty page', async () => {
    await expectResponses({ responseValue: 'ANSWER', page: 1, limit: 2 }, [4, 5], 3);
    await expectResponses({ responseValue: 'answer', page: 2, limit: 2 }, [6], 3);
    await expectResponses({ responseValue: 'answer', page: 3, limit: 2 }, [], 3);
    await expectResponses({ responseValue: 'no-such-value' }, []);
    await expectResponses({ responseValue: '%' }, [2, 3, 4, 5, 6, 7, 8]);
  });

  it('uses the value index only for ready workspaces and preserves the complete source results', async () => {
    const queries = [
      { responseValue: 'answer', page: 2, limit: 2 },
      {
        responseValue: '%', tags: 'review', page: 2, limit: 1
      },
      { responseValue: 'answer', regexSearch: true, unit: '^UNIT_[AB]$' },
      { responseValue: 'no-such-value' },
      { responseValue: 'answer', hasValue: 'yes' }
    ];
    const options = queries.map(query => ({ page: 1, limit: 50, ...query }));
    const reference: Awaited<ReturnType<typeof service.findFlatResponses>>[] = [];
    for (const query of options) {
      reference.push(await service.findFlatResponses(42, query));
    }
    const foreign = await service.findFlatResponses(43, { page: 1, limit: 50, responseValue: 'foreign' });
    const searchStatements: string[] = [];
    const projectedStatements: string[] = [];
    const createRunner = db.createQueryRunner.bind(db);
    const runners = jest.spyOn(db, 'createQueryRunner').mockImplementation((...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      jest.spyOn(runner, 'query').mockImplementation((sql, parameters, structured) => {
        if (typeof sql === 'string' && sql.includes('"flat_response_value_matches"')) searchStatements.push(sql);
        if (typeof sql === 'string' && sql.includes('projected_value_matches AS MATERIALIZED')) projectedStatements.push(sql);
        return query(sql, parameters, structured);
      });
      return runner;
    });

    try {
      await db.query(`
        CREATE TABLE flat_response_value_search_workspace (workspace_id int PRIMARY KEY);
        CREATE TABLE flat_response_value_search_value (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id int, value_prefix text);
        CREATE TABLE flat_response_value_search_link (
          id int PRIMARY KEY, workspace_id int, unitid int, variableid text, value_id bigint);
        CREATE TEMP TABLE indexed_responses ON COMMIT DROP AS
          SELECT r.id, r.unitid, r.variableid, p.workspace_id, LEFT(r.value, 2000) AS value_prefix
          FROM response r JOIN unit u ON u.id = r.unitid
          JOIN booklet b ON b.id = u.bookletid JOIN persons p ON p.id = b.personid
          WHERE p.workspace_id = 42 AND r.value IS NOT NULL AND r.is_autocoder_generated IS NOT TRUE;
        INSERT INTO flat_response_value_search_value (workspace_id, value_prefix)
          SELECT DISTINCT workspace_id, value_prefix FROM indexed_responses;
        INSERT INTO flat_response_value_search_link
          SELECT r.id, r.workspace_id, r.unitid, r.variableid, v.id
          FROM indexed_responses r JOIN flat_response_value_search_value v USING (workspace_id, value_prefix);
        INSERT INTO flat_response_value_search_workspace VALUES (42);
      `);
      for (const [index, query] of options.entries()) {
        await expect(service.findFlatResponses(42, query)).resolves.toEqual(reference[index]);
        expect(searchStatements[index]?.includes('flat_response_value_search_link')).toBe(index < 4 && !query.regexSearch);
      }
      await expect(service.findFlatResponses(43, { page: 1, limit: 50, responseValue: 'foreign' })).resolves.toEqual(foreign);
      expect(searchStatements).toHaveLength(6);
      expect(searchStatements[5]).not.toContain('flat_response_value_search_link');

      const laterPage = { responseValue: 'answer', page: 2, limit: 2 };
      const emptyPage = { responseValue: 'answer', page: 100, limit: 2 };
      const expectedLater = await service.findFlatResponses(42, laterPage);
      const expectedEmpty = await service.findFlatResponses(42, emptyPage);
      expect(expectedLater[0].length).toBeGreaterThan(0);
      await installFirstPageProjection();

      await expect(service.findFlatResponses(42, laterPage)).resolves.toEqual(expectedLater);
      await expect(service.findFlatResponses(42, emptyPage)).resolves.toEqual(expectedEmpty);
      await expect(service.findFlatResponses(42, options[1])).resolves.toEqual(reference[1]);
      expect(projectedStatements).toHaveLength(2);

      await db.query('UPDATE flat_response_first_page_workspace SET ready = false');
      await expect(service.findFlatResponses(42, laterPage)).resolves.toEqual(expectedLater);
      expect(searchStatements[searchStatements.length - 1]).toContain('flat_response_value_search_link');
    } finally {
      runners.mockRestore();
      await db.query(`DROP TABLE IF EXISTS flat_response_first_page_workspace, flat_response_first_page_unit,
        flat_response_first_page_response, flat_response_unit_count`);
      await db.query(`DROP TABLE IF EXISTS flat_response_value_search_link,
        flat_response_value_search_value, flat_response_value_search_workspace`);
    }
  });

  it('combines value search with regex, tags and log-derived filters without duplicating rows', async () => {
    const rows = await expectResponses({
      responseValue: 'answer',
      regexSearch: true,
      unit: '^UNIT_[AB]$',
      tags: 'review',
      processingDurationMax: '01:00'
    }, [4, 5]);
    expect(rows[0].tags.sort()).toEqual(['review-alpha', 'review-beta']);
    expect(rows[1].tags).toEqual(['review-alpha']);
  });

  it('searches and returns the same value prefix while ordering tied rows by response ID', async () => {
    const prefix = `${'x'.repeat(1994)}needle`;
    await db.query(`INSERT INTO response (id,unitid,variableid,status,value)
      VALUES (20,1,'A',3,$1),(21,1,'A',3,$2),(22,1,'A',3,$3)`, [
      `${prefix}tail`, 'needle second', `${'x'.repeat(2000)}needle`
    ]);
    try {
      const rows = await expectResponses({ responseValue: 'needle', limit: 1 }, [20], 2);
      expect(rows[0].responseValue).toBe(prefix);
      await expectResponses({ responseValue: 'needle', page: 2, limit: 1 }, [21], 2);
      await expectResponses({ responseValue: 'needle', page: 3, limit: 1 }, [], 2);
    } finally {
      await db.query('DELETE FROM response WHERE id IN (20,21,22)');
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

  it('returns partial and full pages from the end in forward order across tied and null sort keys', async () => {
    await db.query(`INSERT INTO unit VALUES (20,5,'NULL_ALIAS',NULL),(21,5,'TIED','UNIT_E'),(22,5,'EMPTY',NULL);
      INSERT INTO response VALUES
        (30,20,'0',3,'legacy',NULL),(31,20,NULL,3,'null variable',false),
        (32,21,'H',3,'tie',false),(33,22,'0',3,'generated',true);`);
    try {
      await expectResponses({ page: 3, limit: 3 }, [7, 8, 32], 11);
      await expectResponses({ page: 4, limit: 3 }, [30, 31], 11);
      await expectResponses({ page: 4, limit: 2 }, [7, 8], 11);
      await expectResponses({ page: 5, limit: 3 }, [], 11);
    } finally {
      await db.query('DELETE FROM response WHERE id BETWEEN 30 AND 33; DELETE FROM unit WHERE id BETWEEN 20 AND 22;');
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

  it('uses the first controller entries by ID when several running and termination events exist', async () => {
    await db.query(`
      INSERT INTO persons VALUES (70,44,true,'F','facet-person','fixture');
      INSERT INTO booklet VALUES (70,70,1);
      INSERT INTO unit VALUES (70,70,'FACET_UNIT','FACET_UNIT');
      INSERT INTO response (id,unitid,variableid,status,value) VALUES (70,70,'Z',3,'value');
      INSERT INTO bookletlog VALUES
        (90,70,'CONTROLLER','RUNNING',1000),
        (91,70,'CONTROLLER','TERMINATED',61000),
        (92,70,'CONTROLLER','RUNNING',2000),
        (93,70,'CONTROLLER','TERMINATED',3000);
    `);
    try {
      const options = { processingDurationThresholdMs: 60000 };
      const facets = await filterOptionsService.findFlatResponseFilterOptions(44, options);
      expect(facets.processingDurations).toEqual(['Lang']);
      await expect(filterOptionsService.findFlatResponseFilterOptions(44, { ...options, code: '%' }))
        .resolves.toEqual(facets);
      await db.query("DELETE FROM bookletlog WHERE bookletid = 70 AND parameter = 'TERMINATED'");
      const incomplete = await filterOptionsService.findFlatResponseFilterOptions(44, options);
      expect(incomplete.processingDurations).toEqual(['Unbekannt']);
    } finally {
      await db.query(`
        DELETE FROM bookletlog WHERE bookletid = 70;
        DELETE FROM response WHERE id = 70;
        DELETE FROM unit WHERE id = 70;
        DELETE FROM booklet WHERE id = 70;
        DELETE FROM persons WHERE id = 70;
      `);
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
      const [valueRows, valueTotal] = await service.findFlatResponses(42, {
        page: 1, limit: 50, responseValue: 'not committed'
      }, runner);
      expect(valueTotal).toBe(1);
      expect(valueRows.map(row => row.responseId)).toEqual([30]);
      await expectResponses({ responseValue: 'not committed' }, []);
      const [outsideRows, outsideTotal] = await service.findFlatResponses(42, { page: 1, limit: 50 });
      expect(outsideTotal).toBe(8);
      expect(outsideRows.map(row => row.responseId)).not.toContain(30);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
