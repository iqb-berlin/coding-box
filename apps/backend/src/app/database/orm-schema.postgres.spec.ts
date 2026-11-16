import { readFileSync } from 'node:fs';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';

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
});
