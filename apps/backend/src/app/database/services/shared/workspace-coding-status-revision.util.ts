import { DataSource, EntityManager, QueryRunner } from 'typeorm';

export const WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE = 774020251;

type QueryExecutor = Pick<EntityManager, 'query'> | Pick<QueryRunner, 'query'>;
type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

export interface WorkspaceCodingStatusRevision {
  revision: number;
  statusRevision: string;
  stable: boolean;
}

export function normalizeWorkspaceId(workspaceId: number): number {
  const normalized = Number(workspaceId);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(
      'A valid workspace id is required for the coding-status revision.'
    );
  }
  return normalized;
}

export async function touchWorkspaceCodingStatusRevision(
  executor: QueryExecutor,
  workspaceId: number
): Promise<void> {
  await executor.query(
    `
      INSERT INTO workspace_test_results_revision (
        workspace_id,
        revision,
        status_revision,
        updated_at
      )
      VALUES ($1, 0, 1, now())
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        status_revision = workspace_test_results_revision.status_revision + 1,
        updated_at = now()
    `,
    [normalizeWorkspaceId(workspaceId)]
  );
}

export async function getWorkspaceCodingStatusRevision(
  connection: QueryRunnerFactory,
  workspaceId: number
): Promise<WorkspaceCodingStatusRevision> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner = connection.createQueryRunner();
  let sharedLockAcquired = false;

  await queryRunner.connect();
  try {
    const lockRows = (await queryRunner.query(
      'SELECT pg_try_advisory_lock_shared($1::int, $2::int) AS acquired',
      [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
    )) as Array<{ acquired: boolean }>;
    sharedLockAcquired = lockRows[0]?.acquired === true;

    const rows = (await queryRunner.query(
      `
        SELECT revision, status_revision
        FROM workspace_test_results_revision
        WHERE workspace_id = $1
      `,
      [normalizedWorkspaceId]
    )) as Array<{
      revision: number | string;
      status_revision: number | string;
    }>;

    return {
      revision: Number(rows[0]?.revision || 0),
      statusRevision: String(rows[0]?.status_revision || 0),
      stable: sharedLockAcquired
    };
  } finally {
    try {
      if (sharedLockAcquired) {
        await queryRunner.query(
          'SELECT pg_advisory_unlock_shared($1::int, $2::int)',
          [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
        );
      }
    } finally {
      await queryRunner.release();
    }
  }
}
