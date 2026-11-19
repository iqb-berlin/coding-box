import { KappaPostgresFixture } from '../coding/kappa-query.postgres.test.factory';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('Response projections after TRUNCATE', () => {
  it.each(['TRUNCATE workspace CASCADE', 'TRUNCATE response CASCADE'])(
    'clears counts, payloads and search values for %s', async statement => {
      const fixture = new KappaPostgresFixture();
      try {
        await fixture.open(serverUrl!);
        const counts = () => fixture.db.query(`SELECT
          (SELECT count(*)::int FROM response) AS responses,
          (SELECT count(*)::int FROM flat_response_unit_count) AS units,
          (SELECT count(*)::int FROM flat_response_all_totals) AS totals,
          (SELECT count(*)::int FROM flat_response_first_page_response) AS payloads,
          (SELECT count(*)::int FROM flat_response_value_search_link) AS links,
          (SELECT count(*)::int FROM flat_response_value_search_value) AS prefixes`);
        await fixture.db.transaction('REPEATABLE READ', async truncator => {
          // The independent import commits after the truncating transaction takes its snapshot.
          await truncator.query('SELECT pg_current_snapshot()');
          const workspaceId = await fixture.insert('workspace', { name: 'Truncate regression' });
          const responseId = await fixture.response(workspaceId, 'UNIT', 'V', 'login');
          await fixture.db.query("UPDATE response SET value = 'answer' WHERE id = $1", [responseId]);
          await expect(counts()).resolves.toEqual([{
            responses: 1, units: 1, totals: 1, payloads: 1, links: 1, prefixes: 1
          }]);
          await truncator.query(statement);
        });
        await expect(counts()).resolves.toEqual([{
          responses: 0, units: 0, totals: 0, payloads: 0, links: 0, prefixes: 0
        }]);
      } finally {
        await fixture.close();
      }
    }, 60000
  );
});
