import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { KappaPostgresFixture } from '../coding/kappa-query.postgres.test.factory';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Data-only restore from before the response projections', () => {
  it('rolls back a failed rebuild and restores counts, payloads and search links on retry', async () => {
    const fixture = new KappaPostgresFixture();
    const directory = mkdtempSync(path.join(tmpdir(), 'response-restore-'));
    const archive = path.join(directory, 'legacy.dump');
    const server = new URL(serverUrl!);
    let workspaceId: number;
    let responseId: number;
    const env = {
      ...process.env,
      PGHOST: server.hostname,
      PGPORT: server.port || '5432',
      PGUSER: decodeURIComponent(server.username),
      PGPASSWORD: decodeURIComponent(server.password),
      POSTGRES_USER: decodeURIComponent(server.username),
      POSTGRES_DB: ''
    };
    const restore = () => execFileSync('bash', ['scripts/make/restore-db-data.sh', archive], { env, stdio: 'pipe' });

    try {
      await fixture.open(serverUrl!, {
        file: 'coding-box.changelog-response-list-search.sql',
        seed: async db => {
          const [{ name }] = await db.query('SELECT current_database() AS name');
          env.POSTGRES_DB = name;
          workspaceId = await fixture.insert('workspace', { name: 'Restore' });
          responseId = await fixture.response(workspaceId, 'UNIT', 'V', 'login');
          await db.query("UPDATE response SET value = 'restored answer' WHERE id = $1", [responseId]);
          await db.query(`INSERT INTO response(unitid, variableid, status, value, is_autocoder_generated)
            SELECT unitid, 'GENERATED', 3, 'generated', true FROM response WHERE id = $1`, [responseId]);
          execFileSync('pg_dump', ['--data-only', '--format=custom', '--file', archive, env.POSTGRES_DB], { env, stdio: 'pipe' });
          await db.query('DELETE FROM workspace WHERE id = $1', [workspaceId]);
          await db.query("DELETE FROM bookletinfo WHERE name = 'BOOKLET'");
        }
      });

      await fixture.db.query('ALTER FUNCTION rebuild_flat_response_workspace(integer) RENAME TO unavailable_rebuild');
      expect(restore).toThrow();
      await expect(fixture.db.query('SELECT id FROM response')).resolves.toEqual([]);
      await fixture.db.query('ALTER FUNCTION unavailable_rebuild(integer) RENAME TO rebuild_flat_response_workspace');

      restore();
      await expect(fixture.db.query('SELECT ready FROM flat_response_first_page_workspace WHERE workspace_id = $1', [workspaceId!]))
        .resolves.toEqual([{ ready: true }]);
      await expect(fixture.db.query('SELECT sum(total)::int AS total FROM flat_response_first_page_total WHERE workspace_id = $1', [workspaceId!]))
        .resolves.toEqual([{ total: 1 }]);
      await expect(fixture.db.query('SELECT id, value_prefix FROM flat_response_first_page_response'))
        .resolves.toEqual([{ id: responseId!, value_prefix: 'restored answer' }]);
      await expect(fixture.db.query(`SELECT l.id, v.value_prefix FROM flat_response_value_search_link l
        JOIN flat_response_value_search_value v ON v.id = l.value_id`))
        .resolves.toEqual([{ id: responseId!, value_prefix: 'restored answer' }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      await fixture.close();
    }
  }, 60000);
});
