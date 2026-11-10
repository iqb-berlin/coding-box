import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { parseString } from 'fast-csv';
import { JobDefinition } from './entities/job-definition.entity';
import { CodingJob } from './entities/coding-job.entity';
import { MissingsProfile } from './entities/missings-profile.entity';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';
import { PersonPersistenceService } from './services/test-results/person-persistence.service';
import { TestResultsExportService } from './services/test-results/test-results-export.service';
import { TestResultsReplayService } from './services/test-results/test-results-replay.service';
import { TestResultsFilterOptionsService } from './services/test-results/test-results-filter-options.service';
import { queryFlatResponseFacets } from './services/test-results/flat-response-facets.util';
import { WorkspaceExclusionService } from './services/workspace/workspace-exclusion.service';
import { Unit } from './entities/unit.entity';
import { UnitLastState } from './entities/unitLastState.entity';
import { ChunkEntity } from './entities/chunk.entity';
import { ResponseEntity } from './entities/response.entity';
import { Booklet } from './entities/booklet.entity';
import { BookletInfo } from './entities/bookletInfo.entity';
import { BookletLog } from './entities/bookletLog.entity';
import { UnitLog } from './entities/unitLog.entity';
import { Session } from './entities/session.entity';
import Persons from './entities/persons.entity';
import Workspace from './entities/workspace.entity';
import FileUpload from './entities/file_upload.entity';
import { Person } from './services/shared';
import { readPostgresQueryBatches } from './services/shared/postgres-query-batches.util';
import { MissingsProfilesService, SnapshotMissingResolver } from './services/coding/missings-profiles.service';
import { updateResponseCodingBatch } from './services/coding/response-coding-batch.util';

const describePostgres = process.env.KAPPA_QUERY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('ORM contract against the complete migrated PostgreSQL schema', () => {
  const fixture = new KappaPostgresFixture();
  let legacyUnitId: number;
  beforeAll(async () => fixture.open(process.env.KAPPA_QUERY_TEST_DATABASE_URL!, {
    file: 'coding-box.changelog-orm-query-hardening.sql',
    seed: async db => {
      const [workspace] = await db.query("INSERT INTO workspace(name) VALUES ('Legacy identity') RETURNING id");
      const [person] = await db.query(`INSERT INTO persons(workspace_id,"group",login,code)
        VALUES($1,'legacy','legacy','legacy') RETURNING id`, [workspace.id]);
      const [info] = await db.query("INSERT INTO bookletinfo(name,size) VALUES('LEGACY',0) RETURNING id");
      const [booklet] = await db.query('INSERT INTO booklet(infoid,personid) VALUES($1,$2) RETURNING id', [info.id, person.id]);
      const [unit] = await db.query("INSERT INTO unit(bookletid,name) VALUES($1,'LEGACY') RETURNING id", [booklet.id]);
      legacyUnitId = unit.id;
      // Identical chunks are intentionally retained; the migration must not invent deduplication rules.
      await db.query("INSERT INTO chunk(unitid,key) VALUES($1,'same'),($1,'same')", [legacyUnitId]);
      await db.query("INSERT INTO unitlaststate(unitid,key,value) VALUES($1,'a','A'),($1,'b','B')", [legacyUnitId]);
    }
  }), 60000);
  afterAll(async () => fixture.close());

  it('migrates populated legacy units without discarding duplicate chunks or state keys', async () => {
    const chunks = await fixture.db.getRepository(ChunkEntity).findBy({ unitid: legacyUnitId });
    const states = await fixture.db.getRepository(UnitLastState).findBy({ unitid: legacyUnitId });
    expect(chunks).toHaveLength(2);
    expect(new Set(chunks.map(row => row.id)).size).toBe(2);
    expect(states.map(row => row.key).sort()).toEqual(['a', 'b']);
  });

  it('backs every active entity identity with a matching physical primary key', async () => {
    const rows: { table: string; columns: string[] }[] = await fixture.db.query(`
      SELECT t.relname AS table, ARRAY(
        SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.num ORDER BY k.ord
      ) AS columns
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'p' AND n.nspname = 'public'
    `);
    // These historical entities have no table and are no longer registered by DatabaseModule.
    const legacy = new Set(['logs', 'workspace_admin']);
    for (const entity of fixture.db.entityMetadatas.filter(e => !legacy.has(e.tableName))) {
      expect(rows.find(row => row.table === entity.tableName)?.columns)
        .toEqual(entity.primaryColumns.map(column => column.databaseName));
    }
    const invalid = await fixture.db.query('SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid');
    expect(invalid).toEqual([]);
  });

  it('keeps one copy of old lookup indexes and indexes cascade keys independently of workspace', async () => {
    const indexes: { indexname: string; indexdef: string }[] = await fixture.db.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'"
    );
    const names = indexes.map(index => index.indexname);
    expect(names).not.toEqual(expect.arrayContaining(['person_unique_idx']));
    for (const obsolete of ['idx_responses_unitid', 'idx_responses_codedstatus', 'response_id_idx',
      'idx_response_statistics_covering', 'idx_response_status_codedstatus_unitid']) {
      expect(names).not.toContain(obsolete);
    }
    expect(names).not.toContain('idx_response_full_value_search_trgm');
    for (const name of ['idx_review_decision_response', 'idx_training_discussion_response',
      'idx_coding_freshness_unit', 'idx_bookletlog_booklet_id']) {
      expect(names).toContain(name);
    }
    const responseCover = indexes.find(index => index.indexname === 'idx_response_manual_unit_variable');
    expect(responseCover?.indexdef).toContain('(unitid, variableid, id) INCLUDE (status)');
    expect(responseCover?.indexdef).toContain('is_autocoder_generated IS NOT TRUE');
    const controllerCover = indexes.find(index => index.indexname === 'idx_bookletlog_controller_covering');
    expect(controllerCover?.indexdef).toContain('(bookletid, parameter, id) INCLUDE (ts)');
    expect(controllerCover?.indexdef).toContain("key = 'CONTROLLER'");
    expect(names).not.toContain('idx_bookletlog_controller_booklet_parameter_id');
  });

  it('restores prerequisite indexes on partial primary-key rollback and can reapply it', async () => {
    const changelog = readFileSync('database/changelog/coding-box.changelog-orm-query-hardening.sql', 'utf8');
    const changeset = changelog.split(/^-- changeset /m).find(chunk => chunk.startsWith('iqb:orm-log-primary-keys\n'))!;
    const forward = changeset.slice(changeset.indexOf('\n') + 1);
    const rollback = [...changeset.matchAll(/^-- rollback (.+)$/gm)].map(match => match[1]).join('\n');
    const names = ['orm_bookletlog_id_unique', 'orm_unitlog_id_unique', 'orm_session_id_unique', 'orm_unitlaststate_id_unique'];
    await fixture.db.transaction(async manager => {
      await manager.query(rollback);
      const indexes = await manager.query('SELECT indexname FROM pg_indexes WHERE schemaname=\'public\' AND indexname=ANY($1::text[])', [names]);
      expect(indexes.map((row: { indexname: string }) => row.indexname).sort()).toEqual([...names].sort());
      await manager.query(forward);
    });
  });

  it('rejects new nullability drift while documenting existing optional legacy columns', async () => {
    const columns: { table_name: string; column_name: string; is_nullable: string }[] = await fixture.db.query(`
      SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public'
    `);
    const differences: object[] = [];
    for (const metadata of fixture.db.entityMetadatas) {
      for (const column of metadata.columns) {
        const physical = columns.find(c => c.table_name === metadata.tableName && c.column_name === column.databaseName);
        if (physical && column.isNullable !== (physical.is_nullable === 'YES')) {
          differences.push({
            table: metadata.tableName,
            column: column.databaseName,
            entityNullable: column.isNullable,
            databaseNullable: physical.is_nullable === 'YES'
          });
        }
      }
    }
    const legacy = JSON.parse(readFileSync('database/legacy-nullability.json', 'utf8')).differences;
    expect(differences).toHaveLength(legacy.length);
    expect(differences).toEqual(expect.arrayContaining(legacy));
  });

  it('keeps cursor batches on one snapshot and releases the connection after early termination', async () => {
    const { workspaceId, profileId } = await fixture.workspace('Cursor snapshot');
    const first = await fixture.response(workspaceId, 'CURSOR', 'FIRST', 'cursor-1');
    const second = await fixture.response(workspaceId, 'CURSOR', 'SECOND', 'cursor-2');
    const query = fixture.db.getRepository(ResponseEntity).createQueryBuilder('response')
      .select('response.id', 'id').addSelect('response.value', 'value')
      .where('response.id IN (:...ids)', { ids: [first, second] })
      .orderBy('response.id');
    const profiles = new MissingsProfilesService(fixture.db.getRepository(MissingsProfile), fixture.db.getRepository(CodingJob), fixture.db.getRepository(JobDefinition), {} as never);
    let resolveMissing: SnapshotMissingResolver | undefined;
    const iterator = readPostgresQueryBatches<{ id: number; value: string | null }>(query, 1, async manager => {
      resolveMissing = await profiles.getMissingResolverForSnapshot(workspaceId, manager);
    });
    expect((await iterator.next()).value).toEqual([{ id: first, value: null }]);
    await fixture.db.getRepository(ResponseEntity).update(second, { value: 'changed concurrently' });
    await fixture.db.query('UPDATE missings_profile SET missings=$1 WHERE id=$2', [JSON.stringify([
      {
        id: 'mir', label: 'Changed concurrently', code: -88, score: 1
      }
    ]), profileId]);
    expect(resolveMissing!(profileId, { id: 'mir' }).code).toBe(-98);
    expect((await iterator.next()).value).toEqual([{ id: second, value: null }]);
    await iterator.return(undefined);
    const [state] = await fixture.db.query(`SELECT count(*)::int AS active FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'idle in transaction'`);
    expect(state.active).toBe(0);
  });

  it('writes multiple result batches atomically and preserves null/zero scores in PostgreSQL', async () => {
    const { workspaceId } = await fixture.workspace('Batch updates');
    const responseId = await fixture.response(workspaceId, 'BATCH', 'SEED', 'batch-person');
    const rows: { id: number }[] = await fixture.db.query(`
      INSERT INTO response(unitid, variableid, status)
      SELECT unitid, 'BATCH-' || i, 3 FROM response CROSS JOIN generate_series(1, 501) i
      WHERE id = $1 RETURNING id
    `, [responseId]);
    const updates = rows.map((row, index) => ({ responseId: row.id, code: -98, score: index === 500 ? 0 : null }));
    await expect(fixture.db.transaction(async manager => {
      await updateResponseCodingBatch(manager, updates, 5);
      throw new Error('rollback both batches');
    })).rejects.toThrow('rollback both batches');
    const afterRollback = await fixture.db.getRepository(ResponseEntity).findOneByOrFail({ id: rows[0].id });
    expect(afterRollback.code_v2).toBeNull();
    await fixture.db.transaction(manager => updateResponseCodingBatch(manager, updates, 5));
    const result = await fixture.db.query(`SELECT code_v2::int, score_v2::int, status_v2 FROM response
      WHERE id = ANY($1::int[]) ORDER BY id`, [rows.map(row => row.id)]);
    expect(result).toHaveLength(501);
    expect(result[0]).toEqual({ code_v2: -98, score_v2: null, status_v2: 5 });
    expect(result[500]).toEqual({ code_v2: -98, score_v2: 0, status_v2: 5 });
  });

  it('imports, reads, exports and replays every chunk and laststate row for one unit', async () => {
    const { db } = fixture;
    const repo = <T extends object>(target: { new(): T }) => db.getRepository(target);
    const workspace = await fixture.workspace('Multirow identity');
    const person = await repo(Persons).save({
      workspace_id: workspace.workspaceId, group: 'g', login: 'l', code: 'c', booklets: []
    });
    const persistence = new PersonPersistenceService(repo(Persons), repo(Booklet), repo(Unit), repo(UnitLastState), repo(BookletInfo), repo(ResponseEntity), repo(ChunkEntity), repo(BookletLog), repo(Session), repo(UnitLog));
    const booklet = {
      id: 'MULTIROW',
      units: [{
        id: 'UNIT',
        alias: 'UNIT',
        laststate: [{ key: 'PAGE', value: 'p1' }, { key: 'STATUS', value: 'done' }],
        chunks: [
          {
            id: 'a', type: 'state', ts: 10, variables: ['V1']
          },
          {
            id: 'b', type: 'state', ts: 20, variables: ['V2']
          }
        ],
        subforms: [{
          id: '',
          responses: [
            { id: 'V1', status: 'VALUE_CHANGED', value: 'one' },
            { id: 'V2', status: 'VALUE_CHANGED', value: 'two' }
          ]
        }]
      }]
    } as Person['booklets'][number];
    await persistence.processBookletWithTransaction(booklet, person, 'merge');
    const unit = await repo(Unit).findOneByOrFail({ name: 'UNIT' });
    expect(await repo(ChunkEntity).find({ where: { unitid: unit.id } })).toHaveLength(2);
    expect(await repo(UnitLastState).find({ where: { unitid: unit.id } })).toHaveLength(2);
    // Reimport remains idempotent even though chunk ids change.
    await persistence.processBookletWithTransaction(booklet, person, 'merge');
    expect(await repo(ChunkEntity).count({ where: { unitid: unit.id } })).toBe(2);
    const cache = {
      get: async (key: string) => (key.endsWith(':v6') ? { responses: [{ id: 'old-incomplete-result' }] } : null),
      set: async () => undefined,
      generateUnitResponseCacheKey: () => 'test'
    };
    const exclusions = new WorkspaceExclusionService(repo(Workspace), repo(FileUpload), cache as never);
    const exporter = new TestResultsExportService(repo(Persons), repo(Unit), repo(Booklet), repo(ResponseEntity), repo(BookletLog), repo(Session), repo(UnitLog), repo(ChunkEntity), db, exclusions, {} as never);
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', data => chunks.push(Buffer.from(data)));
    await exporter.exportTestResultsToStream(workspace.workspaceId, stream);
    const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
      const output: Record<string, string>[] = [];
      parseString(Buffer.concat(chunks).toString('utf8'), { headers: true, delimiter: ';' })
        .on('data', row => output.push(row)).on('error', reject).on('end', () => resolve(output));
    });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].laststate)).toEqual({ PAGE: 'p1', STATUS: 'done' });
    expect(JSON.parse(rows[0].responses).map((chunk: { id: string }) => chunk.id).sort()).toEqual(['a', 'b']);
    const replay = new TestResultsReplayService(repo(Persons), repo(Unit), repo(Booklet), repo(ResponseEntity), repo(BookletInfo), repo(ChunkEntity), cache as never, exclusions);
    const result = await replay.findUnitResponse(workspace.workspaceId, 'l@c@g@MULTIROW', 'UNIT');
    expect(result.responses.map(chunk => chunk.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves full-value matches beyond 2000 characters and computes scoped facets in PostgreSQL', async () => {
    const { workspaceId } = await fixture.workspace('Search facets');
    const id = await fixture.response(workspaceId, 'SEARCH', 'LONG', 'facet-login');
    await fixture.db.getRepository(ResponseEntity).update(id, { value: `${'x'.repeat(2100)}needle`, status: 3 });
    const [counts] = await fixture.db.query(`SELECT
      COUNT(*) FILTER (WHERE value ILIKE $1) AS full,
      COUNT(*) FILTER (WHERE LEFT(value, 2000) ILIKE $1) AS prefix
      FROM response WHERE id = $2`, ['%needle%', id]);
    expect(counts).toEqual({ full: '1', prefix: '0' });
    const cache = { get: async () => null, set: async () => undefined };
    const exclusions = new WorkspaceExclusionService(fixture.db.getRepository(Workspace), fixture.db.getRepository(FileUpload), cache as never);
    const service = new TestResultsFilterOptionsService(fixture.db.getRepository(ResponseEntity), fixture.db, exclusions);
    const result = await service.findFlatResponseFilterOptions(workspaceId, {});
    expect(result.responses).toEqual(['LONG']);
    expect(result.logins).toEqual(['facet-login']);
    expect(result.units).toEqual(['SEARCH']);
    expect(result.responseStatuses).toEqual(['VALUE_CHANGED']);
  });

  it('limits facet arrays after numeric sorting and omits null session fields', async () => {
    const { workspaceId } = await fixture.workspace('Numeric facets');
    const id = await fixture.response(workspaceId, 'NUMERIC', 'FIRST', 'numeric-login');
    const [unit] = await fixture.db.query('SELECT u.bookletid FROM response r JOIN unit u ON u.id=r.unitid WHERE r.id=$1', [id]);
    const sessions: { id: number }[] = await fixture.db.query(`INSERT INTO session(bookletid, browser)
      SELECT $1, CASE WHEN i=1 THEN NULL ELSE 'Chrome' END FROM generate_series(1, 12) i RETURNING id`, [unit.bookletid]);
    const query = fixture.db.getRepository(ResponseEntity).createQueryBuilder('response')
      .innerJoin('response.unit', 'unit').innerJoin('unit.booklet', 'bookletEntity')
      .innerJoin('bookletEntity.person', 'person')
      .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
      .leftJoin('unit.tags', 'unitTag')
      .where('person.workspace_id=:workspaceId', { workspaceId });
    const facets = await queryFlatResponseFacets(query, fixture.db, 3);
    expect(facets.sessionIdRows.map(row => row.v)).toEqual(sessions.slice(0, 3).map(row => String(row.id)));
    expect(facets.sessionBrowserRows).toEqual([{ v: 'Chrome' }]);
    expect(facets.sessionOsRows).toEqual([]);
    expect(facets.tagRows).toEqual([]);
  });
});
