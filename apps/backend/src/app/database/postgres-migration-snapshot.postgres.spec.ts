import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, readFileSync, rmSync, statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';

const describePostgres = process.env.KAPPA_QUERY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('Migration comparison against the real PostgreSQL schema', () => {
  const fixture = new KappaPostgresFixture();
  let directory: string;
  let environment: NodeJS.ProcessEnv;
  const snapshotFile = (name: string) => join(directory, `${name}.json`);
  const command = (name: string, baseline?: string) => ['scripts/qa/postgres-migration-snapshot.mjs',
    `--reportFile=${snapshotFile(name)}`, ...(baseline ? [`--compareWith=${snapshotFile(baseline)}`] : [])];

  beforeAll(async () => {
    await fixture.open(process.env.KAPPA_QUERY_TEST_DATABASE_URL!);
    directory = mkdtempSync(join(tmpdir(), 'postgres-migration-snapshot-'));
    const url = new URL((fixture.db.options as { url: string }).url);
    environment = {
      ...process.env,
      POSTGRES_HOST: url.hostname,
      POSTGRES_PORT: url.port || '5432',
      POSTGRES_USER: decodeURIComponent(url.username),
      POSTGRES_PASSWORD: decodeURIComponent(url.password),
      POSTGRES_DB: url.pathname.slice(1)
    };
    await fixture.db.query(`CREATE TABLE public.migration_snapshot_probe (
      id SERIAL PRIMARY KEY, removed text, "odd""column" text, score numeric(12,3), code bigint, payload jsonb, payload_bytes bytea);
      ALTER TABLE public.migration_snapshot_probe DROP COLUMN removed;
      INSERT INTO public.migration_snapshot_probe("odd""column",score,code,payload,payload_bytes)
      VALUES ('private-answer-ä',1.250,9007199254740993,'{"b":true,"a":null}',decode('00ff','hex')),
             ('private-answer-ä',1.250,9007199254740993,'{"b":true,"a":null}',decode('00ff','hex'))`);
  }, 60000);

  afterAll(async () => {
    await fixture.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('compares all table values deterministically without advancing sequences or exposing answers', async () => {
    const options = { env: environment, encoding: 'utf8' as const, timeout: 30000 };
    execFileSync(process.execPath, command('before'), options);
    execFileSync(process.execPath, command('same', 'before'), options);
    const raw = readFileSync(snapshotFile('before'), 'utf8');
    const result = JSON.parse(raw);
    expect(result.preserved.tables).toContainEqual(expect.objectContaining({ name: 'migration_snapshot_probe', rows: 2 }));
    expect(result.preserved.columns).toContainEqual(expect.objectContaining({
      table_name: 'migration_snapshot_probe', column_name: 'odd"column', position: 2
    }));
    expect(raw).not.toContain('private-answer-ä');
    expect(raw).not.toContain('9007199254740993');
    expect(statSync(snapshotFile('before')).mode % 0o1000).toBe(0o600);
    expect(await fixture.db.query('SELECT last_value::int FROM migration_snapshot_probe_id_seq')).toEqual([{ last_value: 2 }]);
  });

  it('rejects changed scores even when row counts stay equal', async () => {
    execFileSync(process.execPath, command('score-before'), { env: environment, timeout: 30000 });
    await fixture.db.query('UPDATE public.migration_snapshot_probe SET score=2.500 WHERE id=1');
    const result = spawnSync(process.execPath, command('changed-score', 'score-before'), {
      env: environment, encoding: 'utf8', timeout: 30000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Migration comparison failed: tables');
    expect(result.stderr).not.toContain('private-answer');
  });

  it('rejects changed access rights even when schema and values stay equal', async () => {
    execFileSync(process.execPath, command('access-before'), { env: environment, timeout: 30000 });
    await fixture.db.query('GRANT SELECT ON public.migration_snapshot_probe TO PUBLIC');
    try {
      const result = spawnSync(process.execPath, command('changed-access', 'access-before'), {
        env: environment, encoding: 'utf8', timeout: 30000
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Migration comparison failed: access');
    } finally {
      await fixture.db.query('REVOKE SELECT ON public.migration_snapshot_probe FROM PUBLIC');
    }
  });
});
