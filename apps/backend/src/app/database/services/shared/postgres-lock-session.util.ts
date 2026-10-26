import { DataSource, QueryRunner } from 'typeorm';

// A lease must not occupy the application pool while its callback queries that pool.
export async function withPostgresLockSession<T>(connection: DataSource, callback: (runner: QueryRunner) => Promise<T>): Promise<T> {
  if (connection.options.type !== 'postgres') throw new Error('Advisory locks require PostgreSQL.');
  const lease = new DataSource({
    ...connection.options,
    ...connection.options.replication?.master,
    replication: undefined,
    entities: [],
    subscribers: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    extra: { ...connection.options.extra, max: 1 }
  });
  await lease.initialize();
  const runner = lease.createQueryRunner();
  try {
    await runner.connect();
    return await callback(runner);
  } finally {
    try {
      await runner.release();
    } finally {
      await lease.destroy();
    }
  }
}
