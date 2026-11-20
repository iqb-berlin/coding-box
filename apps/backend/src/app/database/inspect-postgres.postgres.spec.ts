import { execFileSync } from 'node:child_process';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('PostgreSQL diagnostics CLI', () => {
  const fixture = new KappaPostgresFixture();

  beforeAll(async () => fixture.open(serverUrl!), 60000);
  afterAll(async () => fixture.close());

  function inspectDatabase(pgOptions?: string) {
    const url = new URL((fixture.db.options as { url: string }).url);
    const output = execFileSync(process.execPath, ['scripts/qa/inspect-postgres.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(pgOptions ? { PGOPTIONS: pgOptions } : {}),
        POSTGRES_HOST: url.hostname,
        POSTGRES_PORT: url.port,
        POSTGRES_USER: decodeURIComponent(url.username),
        POSTGRES_PASSWORD: decodeURIComponent(url.password),
        POSTGRES_DB: decodeURIComponent(url.pathname.slice(1))
      }
    });
    return JSON.parse(output);
  }

  it('reports the original statement timeout and its source', () => {
    expect(inspectDatabase('-c statement_timeout=45s').settings).toContainEqual({
      name: 'statement_timeout', setting: '45000', unit: 'ms', source: 'client'
    });
  });

  it('reports tables and indexes with and without the installed statistics view', async () => {
    const expected = {
      settings: expect.arrayContaining([expect.objectContaining({ name: 'server_version' })]),
      tables: expect.arrayContaining([expect.objectContaining({ relname: 'response' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ relname: 'response' })])
    };
    expect(inspectDatabase()).toMatchObject({ ...expected, pgStatStatementsAvailable: false, queries: [] });

    await fixture.db.query('CREATE EXTENSION pg_stat_statements');
    const [{ preloaded }] = await fixture.db.query(
      "SELECT current_setting('pg_stat_statements.track', true) IS NOT NULL AS preloaded"
    );
    const withExtension = {
      ...expected,
      pgStatStatementsAvailable: preloaded,
      queries: preloaded ? expect.arrayContaining([expect.objectContaining({ calls: expect.anything() })]) : []
    };
    expect(inspectDatabase()).toMatchObject(withExtension);
    await fixture.db.query('CREATE SCHEMA "Monitoring ""DB"""');
    await fixture.db.query('ALTER EXTENSION pg_stat_statements SET SCHEMA "Monitoring ""DB"""');
    expect(inspectDatabase()).toMatchObject(withExtension);
  });
});
