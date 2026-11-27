import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DataSource } from 'typeorm';
import { DatabaseExportService } from './database-export.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('SQLite exports during concurrent PostgreSQL changes', () => {
  let source: DataSource;
  let directory: string;
  let workspaceId: number;
  let otherId: number;

  beforeAll(async () => {
    source = await new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB
    }).initialize();
  });
  afterAll(async () => source?.destroy());

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'snapshot-export-'));
    const [workspace, other] = await source.query("INSERT INTO workspace (name) VALUES ('Export'), ('Other') RETURNING id");
    workspaceId = workspace.id;
    otherId = other.id;
    await source.query(`INSERT INTO persons (workspace_id, "group", code, login)
      SELECT $1, 'g', 'code', 'person-' || i FROM generate_series(1, 2500) i`, [workspaceId]);
    await source.query(`INSERT INTO persons (workspace_id, "group", code, login)
      VALUES ($1, 'g', 'code', 'other-person')`, [otherId]);
    await source.query(`INSERT INTO variable_bundle (workspace_id, name, variables)
      VALUES ($1, 'original', '[]')`, [workspaceId]);
  });

  afterEach(async () => {
    await source.query('DELETE FROM workspace WHERE id IN ($1, $2)', [workspaceId, otherId]);
    await rm(directory, { recursive: true, force: true });
  });

  it.each(['system', 'workspace'])('writes the original rows and later tables for %s', async scope => {
    const expected = await source.query('SELECT id, login FROM persons WHERE workspace_id = $1 ORDER BY id', [workspaceId]);
    const file = join(directory, 'snapshot.sqlite');
    let changed = false;
    const changeSource = async (_progress: number, message: string) => {
      if (changed || !message.startsWith('Tabelle persons: 1000/')) return;
      // A separate connection commits after the first batch and before the next one.
      await source.transaction(async writer => {
        await writer.query('DELETE FROM persons WHERE id = $1', [expected[0].id]);
        await writer.query("UPDATE persons SET login = 'updated' WHERE id = $1", [expected[2499].id]);
        await writer.query(`INSERT INTO persons (workspace_id, "group", code, login)
          VALUES ($1, 'g', 'code', 'inserted')`, [workspaceId]);
        await writer.query("UPDATE variable_bundle SET name = 'updated' WHERE workspace_id = $1", [workspaceId]);
      });
      changed = true;
    };
    const service = new DatabaseExportService(source);
    if (scope === 'system') await service.exportToSqliteFile(file, changeSource);
    else await service.exportWorkspaceToSqliteFile(file, workspaceId, changeSource);

    expect(changed).toBe(true);
    const sqlite = new DatabaseSync(file, { readOnly: true });
    try {
      expect(sqlite.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
      expect(sqlite.prepare('SELECT id, login FROM persons WHERE workspace_id = ? ORDER BY id').all(workspaceId))
        .toEqual(expected);
      expect(sqlite.prepare('SELECT name FROM variable_bundle WHERE workspace_id = ?').all(workspaceId))
        .toEqual([{ name: 'original' }]);
      expect(sqlite.prepare('SELECT login FROM persons WHERE workspace_id = ?').all(otherId))
        .toEqual(scope === 'system' ? [{ login: 'other-person' }] : []);
    } finally {
      sqlite.close();
    }
  }, 60000);
});
