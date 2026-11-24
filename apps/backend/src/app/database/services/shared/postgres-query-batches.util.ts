import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** Keyset pages on the query's connection, including during a write transaction. */
export async function* readEntityBatchesById<T extends ObjectLiteral & { id: number }>(
  query: SelectQueryBuilder<T>, batchSize: number
): AsyncGenerator<T[]> {
  const idColumn = `${query.alias}.id`;
  const pageQuery = query.andWhere(`${idColumn} > :batchAfterId`).orderBy(idColumn, 'ASC').limit(batchSize);
  let afterId = 0;

  while (true) {
    const rows = await pageQuery.setParameter('batchAfterId', afterId).getMany();
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
    afterId = rows[rows.length - 1].id;
  }
}

/** A single cursor snapshot avoids growing OFFSET scans and shifting batch boundaries. */
export async function* readPostgresQueryBatches<T extends ObjectLiteral>(
  query: SelectQueryBuilder<ObjectLiteral>, batchSize: number,
  prepareSnapshot?: (manager: EntityManager) => Promise<void>
): AsyncGenerator<T[]> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
    throw new Error('Invalid PostgreSQL cursor batch size');
  }
  const runner = query.connection.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction('REPEATABLE READ');
    await runner.query('SET TRANSACTION READ ONLY');
    await prepareSnapshot?.(runner.manager);
    const [sql, parameters] = query.getQueryAndParameters();
    await runner.query(`DECLARE batch_rows NO SCROLL CURSOR FOR ${sql}`, parameters);
    while (true) {
      const rows: T[] = await runner.query(`FETCH FORWARD ${batchSize} FROM batch_rows`);
      if (rows.length === 0) break;
      yield rows;
      if (rows.length < batchSize) break;
    }
    await runner.commitTransaction();
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
}
