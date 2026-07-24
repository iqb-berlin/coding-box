import { DataSource } from 'typeorm';

export interface PostgresPoolSnapshot {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

interface PostgresPoolLike {
  totalCount?: unknown;
  idleCount?: unknown;
  waitingCount?: unknown;
}

interface PostgresDriverLike {
  master?: PostgresPoolLike;
}

export type PostgresPoolSnapshotProvider =
  () => PostgresPoolSnapshot | undefined;

export function createPostgresPoolSnapshotProvider(
  dataSource: DataSource
): PostgresPoolSnapshotProvider {
  return () => {
    const pool = (dataSource.driver as unknown as PostgresDriverLike).master;
    if (!pool) {
      return undefined;
    }

    const totalCount = toFiniteCount(pool.totalCount);
    const idleCount = toFiniteCount(pool.idleCount);
    const waitingCount = toFiniteCount(pool.waitingCount);
    if (
      totalCount === undefined ||
      idleCount === undefined ||
      waitingCount === undefined
    ) {
      return undefined;
    }

    return {
      totalCount,
      idleCount,
      waitingCount
    };
  };
}

function toFiniteCount(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 ?
    Math.floor(value) :
    undefined;
}
