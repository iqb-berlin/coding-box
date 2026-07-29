import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
  normalizeWorkspaceId,
  touchWorkspaceCodingStatusRevision,
  WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE
} from './workspace-coding-status-revision.util';

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

export async function lockWorkspaceTestResultsMutationInTransaction(
  manager: EntityManager,
  workspaceId: number
): Promise<void> {
  await manager.query(
    'SELECT pg_advisory_xact_lock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
  await touchWorkspaceCodingStatusRevision(manager, workspaceId);
}

export async function withWorkspaceTestResultsMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: () => Promise<T>
): Promise<T> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner: QueryRunner = connection.createQueryRunner();
  let locked = false;

  await queryRunner.connect();

  try {
    await queryRunner.query(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
    );
    locked = true;
    await touchWorkspaceCodingStatusRevision(queryRunner, normalizedWorkspaceId);
    try {
      return await callback();
    } finally {
      await touchWorkspaceCodingStatusRevision(queryRunner, normalizedWorkspaceId);
    }
  } finally {
    try {
      if (locked) {
        await queryRunner.query(
          'SELECT pg_advisory_unlock($1::int, $2::int)',
          [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
        );
      }
    } finally {
      await queryRunner.release();
    }
  }
}
