import { DataSource } from 'typeorm';
import { parsePostgresPoolAcquireTimeout } from './database.module';
import { isPostgresConnectionTimeout } from './postgres-connection-timeout';

const serverUrl = process.env.KAPPA_QUERY_TEST_DATABASE_URL;
const describePostgres = serverUrl ? describe : describe.skip;

describePostgres('PostgreSQL pool acquisition deadline', () => {
  it.each([undefined, '0'])('keeps waiting for the occupied connection with timeout %s', async value => {
    const db = await new DataSource({
      type: 'postgres',
      url: serverUrl,
      extra: { max: 1, connectionTimeoutMillis: parsePostgresPoolAcquireTimeout(value) }
    }).initialize();
    const occupied = db.createQueryRunner();
    let pending: Promise<unknown> | undefined;
    try {
      await occupied.connect();
      const pool = (db.driver as unknown as { master: { options: { connectionTimeoutMillis: number }; waitingCount: number } }).master;
      expect(pool.options.connectionTimeoutMillis).toBe(0);
      pending = db.query('SELECT 7 AS value');
      expect(pool.waitingCount).toBe(1);
      await occupied.release();
      await expect(pending).resolves.toEqual([{ value: 7 }]);
      expect(pool.waitingCount).toBe(0);
    } finally {
      if (!occupied.isReleased) await occupied.release();
      await pending?.catch(() => undefined);
      await db.destroy();
    }
  });

  it('removes expired waiters and recovers after the occupied connection is released', async () => {
    const db = await new DataSource({
      type: 'postgres',
      url: serverUrl,
      extra: { max: 1, connectionTimeoutMillis: parsePostgresPoolAcquireTimeout('1000') }
    }).initialize();
    const occupied = db.createQueryRunner();
    try {
      await occupied.connect();
      const results = await Promise.allSettled([db.query('SELECT 1'), db.query('SELECT 2')]);
      expect(results).toEqual([
        { status: 'rejected', reason: expect.objectContaining({ message: 'timeout exceeded when trying to connect' }) },
        { status: 'rejected', reason: expect.objectContaining({ message: 'timeout exceeded when trying to connect' }) }
      ]);
      for (const result of results) {
        expect(result.status === 'rejected' && isPostgresConnectionTimeout(result.reason)).toBe(true);
      }
      const pool = (db.driver as unknown as { master: { waitingCount: number } }).master;
      expect(pool.waitingCount).toBe(0);

      // The acquisition deadline does not shorten an already running SQL statement.
      await occupied.query('SELECT pg_sleep(1.1)');
      await occupied.release();
      await expect(db.query('SELECT 3 AS value')).resolves.toEqual([{ value: 3 }]);
      expect(pool.waitingCount).toBe(0);
    } finally {
      if (!occupied.isReleased) await occupied.release();
      await db.destroy();
    }
  }, 15000);
});
