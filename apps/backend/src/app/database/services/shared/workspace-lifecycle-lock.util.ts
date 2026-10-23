import { ConflictException } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { DataSource, QueryRunner } from 'typeorm';

// Shared by every worker and the exclusive workspace deletion path.
const WORKSPACE_LIFECYCLE_LOCK_NAMESPACE = 774020254;

export async function withWorkspaceJobLock<T>(
  connection: DataSource,
  workspaceId: number,
  callback: () => Promise<T>
): Promise<T> {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) {
    throw new UnrecoverableError('A workspace job requires a valid workspace ID.');
  }
  if (connection.options.type !== 'postgres') throw new Error('Workspace lifecycle locks require PostgreSQL.');
  // Workers call services which may themselves hold advisory-lock connections.
  // A dedicated one-connection pool keeps lifecycle leases out of the application pool.
  const leaseConnection = new DataSource({
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
  await leaseConnection.initialize();
  const runner = leaseConnection.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    await runner.query('SELECT pg_advisory_lock_shared($1::int, $2::int)', [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, workspaceId]);
    locked = true;
    const rows = await runner.query('SELECT id FROM public.workspace WHERE id = $1', [workspaceId]) as { id: number }[];
    if (rows.length === 0) {
      throw new UnrecoverableError(`Workspace ${workspaceId} has been deleted.`);
    }
    return await callback();
  } finally {
    try {
      if (locked) await runner.query('SELECT pg_advisory_unlock_shared($1::int, $2::int)', [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, workspaceId]);
    } finally {
      try {
        await runner.release();
      } finally {
        await leaseConnection.destroy();
      }
    }
  }
}

export async function withWorkspaceDeletionLocks<T>(
  runner: QueryRunner,
  workspaceIds: number[],
  callback: () => Promise<T>
): Promise<T> {
  const lockedIds: number[] = [];
  try {
    for (const id of [...new Set(workspaceIds)].sort((a, b) => a - b)) {
      const rows = await runner.query('SELECT pg_try_advisory_lock($1::int, $2::int) AS locked', [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, id]) as { locked: boolean }[];
      if (!rows[0]?.locked) {
        throw new ConflictException('Workspaces cannot be deleted while background jobs are running.');
      }
      lockedIds.push(id);
    }
    return await callback();
  } finally {
    for (const id of lockedIds.reverse()) {
      await runner.query('SELECT pg_advisory_unlock($1::int, $2::int)', [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, id]);
    }
  }
}
