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
