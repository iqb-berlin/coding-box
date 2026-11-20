import { readFileSync } from 'node:fs';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';
import { JobDefinition } from './entities/job-definition.entity';
import { CodingJob } from './entities/coding-job.entity';
import { MissingsProfile } from './entities/missings-profile.entity';
import { ResponseEntity } from './entities/response.entity';
import { readPostgresQueryBatches } from './services/shared/postgres-query-batches.util';
import { MissingsProfilesService, SnapshotMissingResolver } from './services/coding/missings-profiles.service';
import { updateResponseCodingBatch } from './services/coding/response-coding-batch.util';

const describePostgres = process.env.KAPPA_QUERY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('ORM contract against the complete migrated PostgreSQL schema', () => {
  const fixture = new KappaPostgresFixture();

  beforeAll(async () => fixture.open(process.env.KAPPA_QUERY_TEST_DATABASE_URL!), 60000);
  afterAll(async () => fixture.close());

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
  });

  it('adopts only a matching index when Liquibase retries a concurrent build', async () => {
    const changelog = readFileSync('database/changelog/coding-box.changelog-orm-query-hardening.sql', 'utf8');
    const changesets = changelog.split(/^-- changeset /m).filter(chunk => /^CREATE (?:UNIQUE )?INDEX CONCURRENTLY /m.test(chunk));
    expect(changesets).toHaveLength(8);
    for (const changeset of changesets) {
      expect(changeset).toContain('-- preconditions onFail:MARK_RAN onError:HALT');
      const check = changeset.match(/^-- precondition-sql-check expectedResult:0 (SELECT .+)$/m)![1];
      const ddl = changeset.match(/^CREATE (?:UNIQUE )?INDEX CONCURRENTLY (\w+) .+;$/m)!;
      // The three identity indexes are renamed when PostgreSQL attaches the primary keys.
      // Use disposable copies of the indexes inside a transaction and undo the DDL afterwards.
      const runner = fixture.db.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        await runner.query(`DROP INDEX IF EXISTS public.${ddl[1]}`);
        expect(await runner.query(check)).toEqual([{ count: '0' }]);
        await runner.query(ddl[0].replace(' CONCURRENTLY', ''));
        expect(await runner.query(check)).toEqual([{ count: '1' }]);
        await runner.query(`DROP INDEX public.${ddl[1]}`);
        await runner.query(`CREATE INDEX ${ddl[1]} ON public.bookletlog(id) WHERE false`);
        expect(await runner.query(check)).toEqual([{ count: '0' }]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    }
  });

  it('restores prerequisite indexes on partial primary-key rollback and can reapply it', async () => {
    const changelog = readFileSync('database/changelog/coding-box.changelog-orm-query-hardening.sql', 'utf8');
    const changeset = changelog.split(/^-- changeset /m).find(chunk => chunk.startsWith('iqb:orm-log-primary-keys\n'))!;
    const forward = changeset.slice(changeset.indexOf('\n') + 1);
    const rollback = [...changeset.matchAll(/^-- rollback (.+)$/gm)].map(match => match[1]).join('\n');
    const names = ['orm_bookletlog_id_unique', 'orm_unitlog_id_unique', 'orm_session_id_unique'];
    await fixture.db.transaction(async manager => {
      await manager.query(rollback);
      const indexes = await manager.query('SELECT indexname FROM pg_indexes WHERE schemaname=\'public\' AND indexname=ANY($1::text[])', [names]);
      expect(indexes.map((row: { indexname: string }) => row.indexname).sort()).toEqual([...names].sort());
      await manager.query(forward);
    });
  });

  function readRollback(changesetId: string): string {
    const changelog = readFileSync('database/changelog/coding-box.changelog-orm-query-hardening.sql', 'utf8');
    const changeset = changelog.split(/^-- changeset /m).find(chunk => chunk.startsWith(`iqb:${changesetId} `));
    if (!changeset) throw new Error(`Missing changeset: ${changesetId}`);
    return [...changeset.matchAll(/^-- rollback (.+)$/gm)].map(match => match[1]).join('\n');
  }

  it.each([
    {
      changesetId: 'orm-remove-duplicate-indexes',
      indexes: ['response_id_idx', 'idx_responses_unitid', 'idx_responses_codedstatus', 'person_unique_idx'],
      existingIndex: 'CREATE INDEX response_id_idx ON public.response(id)',
      interruptedIndex: 'CREATE INDEX CONCURRENTLY idx_responses_unitid ON public.response(unitid)'
    },
    {
      changesetId: 'orm-remove-obsolete-status-indexes',
      indexes: ['idx_response_status_codedstatus_unitid', 'idx_response_statistics_covering'],
      existingIndex: "CREATE INDEX idx_response_status_codedstatus_unitid ON public.response(status, status_v1, unitid) WHERE status::text = 'VALUE_CHANGED'",
      interruptedIndex: "CREATE INDEX CONCURRENTLY idx_response_statistics_covering ON public.response(status, unitid, status_v1, id) WHERE status::text = 'VALUE_CHANGED'"
    }
  ])('resumes $changesetId after an interrupted index build', async ({
    changesetId, indexes, existingIndex, interruptedIndex
  }) => {
    const [validName, invalidName] = indexes;
    const rollback = readRollback(changesetId);
    const builder = fixture.db.createQueryRunner();
    const blocker = fixture.db.createQueryRunner();
    const readIndexes = (): Promise<{ name: string; oid: number; valid: boolean }[]> => builder.query(`
      SELECT c.relname AS name, c.oid, i.indisvalid AS valid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ANY($1::text[]) ORDER BY c.relname
    `, [indexes]);
    try {
      await builder.query(existingIndex);
      await blocker.startTransaction();
      await blocker.query('LOCK TABLE public.response IN ROW EXCLUSIVE MODE');

      await builder.query("SET lock_timeout = '500ms'");
      await expect(builder.query(interruptedIndex)).rejects.toMatchObject({ code: '55P03' });
      const before = await readIndexes();
      expect(before).toHaveLength(2);
      expect(before).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: validName, valid: true }),
        expect.objectContaining({ name: invalidName, valid: false })
      ]));

      await expect(builder.query(rollback)).rejects.toMatchObject({ code: '55P03' });
      expect(await readIndexes()).toEqual(before);

      await blocker.rollbackTransaction();
      await builder.query('RESET lock_timeout');
      await builder.query(rollback);
      const restored = await readIndexes();
      expect(restored.map(({ name }) => name).sort()).toEqual([...indexes].sort());
      expect(restored.every(({ valid }) => valid)).toBe(true);
      expect(restored.find(({ name }) => name === validName))
        .toEqual(before.find(({ name }) => name === validName));

      await builder.query(rollback);
      expect(await readIndexes()).toEqual(restored);
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      try {
        await builder.query('RESET lock_timeout');
        const qualifiedNames = indexes.map(name => `public.${name}`);
        await builder.query(`DROP INDEX IF EXISTS ${qualifiedNames.join(', ')}`);
      } finally {
        await builder.release();
      }
    }
  });

  it('keeps a conflicting index and rolls back earlier restores in the same changeset', async () => {
    const rollback = readRollback('orm-remove-duplicate-indexes');
    await fixture.db.query('CREATE INDEX idx_responses_unitid ON public.response(id)');
    try {
      await expect(fixture.db.query(rollback)).rejects.toThrow('existing object has a different definition');
      const [indexes] = await fixture.db.query(`
        SELECT to_regclass('public.response_id_idx') AS restored,
               pg_get_indexdef('public.idx_responses_unitid'::regclass) AS conflicting
      `);
      expect(indexes.restored).toBeNull();
      expect(indexes.conflicting).toBe('CREATE INDEX idx_responses_unitid ON public.response USING btree (id)');
    } finally {
      await fixture.db.query('DROP INDEX IF EXISTS public.idx_responses_unitid, public.response_id_idx');
    }
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
    const third = await fixture.response(workspaceId, 'CURSOR', 'THIRD', 'cursor-3');
    const query = fixture.db.getRepository(ResponseEntity).createQueryBuilder('response')
      .select('response.id', 'id').addSelect('response.value', 'value')
      .where('response.id IN (:...ids)', { ids: [first, second, third] })
      .orderBy('response.id');
    const profiles = new MissingsProfilesService(fixture.db.getRepository(MissingsProfile), fixture.db.getRepository(CodingJob), fixture.db.getRepository(JobDefinition), {} as never);
    let resolveMissing: SnapshotMissingResolver | undefined;
    const iterator = readPostgresQueryBatches<{ id: number; value: string | null }>(query, 1, async manager => {
      resolveMissing = await profiles.getMissingResolverForSnapshot(workspaceId, manager);
      // Commit on a second connection after the profile read and before DECLARE.
      // READ COMMITTED would open the cursor on the updated response.
      await fixture.db.transaction(async writer => {
        await writer.update(ResponseEntity, second, { value: 'changed before DECLARE' });
        await writer.update(MissingsProfile, profileId, {
          missings: JSON.stringify([
            {
              id: 'mir', label: 'Changed concurrently', code: -88, score: 1
            }
          ])
        });
      });
    });
    try {
      expect((await iterator.next()).value).toEqual([{ id: first, value: null }]);
      await fixture.db.getRepository(ResponseEntity).update(second, { value: 'changed after first batch' });
      expect(resolveMissing!(profileId, { id: 'mir' }).code).toBe(-98);
      expect((await iterator.next()).value).toEqual([{ id: second, value: null }]);
    } finally {
      await iterator.return(undefined);
    }
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
});
