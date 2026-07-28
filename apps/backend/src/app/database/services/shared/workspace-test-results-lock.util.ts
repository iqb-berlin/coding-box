import { DataSource, EntityManager, QueryRunner } from 'typeorm';

const WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE = 774020251;

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;
type SqlQueryExecutor = Pick<EntityManager, 'query'>;

export type WorkspaceTestResultsMutationLockOptions = {
  recoverAfterFailure?: () => Promise<unknown>;
};

export type WorkspaceCodingStatusRevisionOperation = {
  revision: number;
};

function normalizeWorkspaceId(workspaceId: number): number {
  const normalized = Number(workspaceId);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error('A valid workspace id is required for the test-results mutation lock.');
  }
  return normalized;
}

export async function lockWorkspaceTestResultsMutationInTransaction(
  manager: EntityManager,
  workspaceId: number
): Promise<void> {
  await manager.query(
    'SELECT pg_advisory_xact_lock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
}

export async function beginWorkspaceCodingStatusRevisionOperation(
  executor: SqlQueryExecutor,
  workspaceId: number
): Promise<WorkspaceCodingStatusRevisionOperation> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const raw = await executor.query(
    `
      WITH expired_operations AS (
        DELETE FROM workspace_coding_status_revision_operation
        WHERE workspace_id = $1
          AND started_at < now() - interval '24 hours'
      ), operation AS (
        SELECT clock_timestamp() AS started_at
      ), next_revision AS (
        INSERT INTO workspace_test_results_revision (workspace_id, revision, updated_at)
        VALUES ($1, 1, now())
        ON CONFLICT (workspace_id)
        DO UPDATE SET revision = workspace_test_results_revision.revision + 1,
                      updated_at = now()
        RETURNING revision
      ), status_update AS (
        INSERT INTO workspace_coding_status_revision (
          workspace_id,
          revision,
          processed_test_results_revision,
          updated_at
        )
        SELECT $1, 1, 0, now()
        FROM operation
        CROSS JOIN next_revision
        ON CONFLICT (workspace_id)
        DO UPDATE SET revision =
                        workspace_coding_status_revision.revision + 1,
                      updated_at = now()
      ), operation_insert AS (
        INSERT INTO workspace_coding_status_revision_operation (
          workspace_id,
          test_results_revision,
          started_at
        )
        SELECT $1, next_revision.revision, operation.started_at
        FROM next_revision
        CROSS JOIN operation
      )
      SELECT next_revision.revision
      FROM next_revision
      CROSS JOIN operation
    `,
    [normalizedWorkspaceId]
  ) as Array<{ revision: number | string }> | undefined;
  const operation = raw?.[0];
  const revision = Number(operation?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(
      `Could not start coding status revision operation for workspace ${normalizedWorkspaceId}.`
    );
  }
  return { revision };
}

export async function completeWorkspaceCodingStatusRevisionOperation(
  executor: SqlQueryExecutor,
  workspaceId: number,
  operation: WorkspaceCodingStatusRevisionOperation
): Promise<void> {
  await executor.query(
    `
      WITH completed_operation AS (
        DELETE FROM workspace_coding_status_revision_operation
        WHERE workspace_id = $1
          AND test_results_revision = $2
      )
      INSERT INTO workspace_coding_status_revision (
        workspace_id,
        revision,
        processed_test_results_revision,
        updated_at
      )
      VALUES ($1, 1, $2, now())
      ON CONFLICT (workspace_id)
      DO UPDATE SET revision =
                      workspace_coding_status_revision.revision + 1,
                    processed_test_results_revision = GREATEST(
                      workspace_coding_status_revision.processed_test_results_revision,
                      EXCLUDED.processed_test_results_revision
                    ),
                    updated_at = now()
    `,
    [normalizeWorkspaceId(workspaceId), operation.revision]
  );
}

export async function failWorkspaceCodingStatusRevisionOperation(
  executor: SqlQueryExecutor,
  workspaceId: number,
  revision: number
): Promise<void> {
  await executor.query(
    `
      WITH failed_operation AS (
        DELETE FROM workspace_coding_status_revision_operation
        WHERE workspace_id = $1
          AND test_results_revision = $2
      )
      UPDATE workspace_coding_status_revision
      SET failed_test_results_revision = GREATEST(
            COALESCE(failed_test_results_revision, 0),
            $2
          ),
          last_test_result_update_failed_at = now(),
          revision = workspace_coding_status_revision.revision + 1,
          updated_at = now()
      WHERE workspace_id = $1
    `,
    [normalizeWorkspaceId(workspaceId), revision]
  );
}

export async function failExpiredWorkspaceCodingStatusRevisionOperations(
  executor: SqlQueryExecutor,
  workspaceId: number
): Promise<boolean> {
  const rows = await executor.query(
    `
      WITH expired_operations AS (
        DELETE FROM workspace_coding_status_revision_operation
        WHERE workspace_id = $1
          AND started_at < now() - interval '24 hours'
        RETURNING test_results_revision
      ), latest_expired AS (
        SELECT MAX(test_results_revision) AS revision
        FROM expired_operations
      )
      INSERT INTO workspace_coding_status_revision (
        workspace_id,
        revision,
        processed_test_results_revision,
        failed_test_results_revision,
        last_test_result_update_failed_at,
        updated_at
      )
      SELECT $1, 1, 0, latest_expired.revision, now(), now()
      FROM latest_expired
      WHERE latest_expired.revision IS NOT NULL
      ON CONFLICT (workspace_id)
      DO UPDATE SET failed_test_results_revision = GREATEST(
                      COALESCE(
                        workspace_coding_status_revision.failed_test_results_revision,
                        0
                      ),
                      EXCLUDED.failed_test_results_revision
                    ),
                    last_test_result_update_failed_at = now(),
                    revision = workspace_coding_status_revision.revision + 1,
                    updated_at = now()
      RETURNING workspace_id
    `,
    [normalizeWorkspaceId(workspaceId)]
  ) as Array<{ workspace_id: number | string }> | undefined;
  return Array.isArray(rows) && rows.length === 1;
}

export async function clearWorkspaceCodingStatusRevisionFailureAfterReconciliation(
  executor: SqlQueryExecutor,
  workspaceId: number,
  reconciledRevision: number
): Promise<boolean> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (!Number.isSafeInteger(reconciledRevision) || reconciledRevision < 1) {
    throw new Error('A valid reconciled revision is required.');
  }
  const rows = await executor.query(
    `
      UPDATE workspace_coding_status_revision status_revision
      SET failed_test_results_revision = NULL,
          last_test_result_update_failed_at = NULL,
          revision = status_revision.revision + 1,
          updated_at = now()
      WHERE status_revision.workspace_id = $1
        AND status_revision.failed_test_results_revision IS NOT NULL
        AND status_revision.failed_test_results_revision <= $2
        AND status_revision.processed_test_results_revision = $2
        AND EXISTS (
          SELECT 1
          FROM workspace_test_results_revision test_revision
          WHERE test_revision.workspace_id = status_revision.workspace_id
            AND test_revision.revision = $2
        )
        AND NOT EXISTS (
          SELECT 1
          FROM workspace_coding_status_revision_operation active_operation
          WHERE active_operation.workspace_id = status_revision.workspace_id
        )
      RETURNING status_revision.workspace_id
    `,
    [normalizedWorkspaceId, reconciledRevision]
  ) as Array<{ workspace_id: number | string }> | undefined;
  return Array.isArray(rows) && rows.length === 1;
}

export async function withWorkspaceTestResultsMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: () => Promise<T>,
  options: WorkspaceTestResultsMutationLockOptions = {}
): Promise<T> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner: QueryRunner = connection.createQueryRunner();
  let locked = false;
  let operation: WorkspaceCodingStatusRevisionOperation | null = null;

  await queryRunner.connect();

  try {
    await queryRunner.query(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
    );
    locked = true;
    operation = await beginWorkspaceCodingStatusRevisionOperation(
      queryRunner,
      normalizedWorkspaceId
    );
    const result = await callback();
    await completeWorkspaceCodingStatusRevisionOperation(
      queryRunner,
      normalizedWorkspaceId,
      operation
    );
    return result;
  } catch (error) {
    let failureRecorded = false;
    if (operation) {
      try {
        await failWorkspaceCodingStatusRevisionOperation(
          queryRunner,
          normalizedWorkspaceId,
          operation.revision
        );
        failureRecorded = true;
      } catch {
        // Preserve the original mutation failure. The orphaned lease keeps snapshots unstable.
      }
    }
    if (failureRecorded && options.recoverAfterFailure) {
      try {
        await options.recoverAfterFailure();
      } catch {
        // Preserve the original mutation failure. The recorded failure keeps snapshots unstable.
      }
    }
    throw error;
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

export async function withWorkspaceTestResultsAdvisoryLockIfAvailable<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: () => Promise<T>
): Promise<T | undefined> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner: QueryRunner = connection.createQueryRunner();
  let locked = false;

  await queryRunner.connect();
  try {
    const rows = await queryRunner.query(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
    ) as Array<{ locked: boolean | string }> | undefined;
    locked = rows?.[0]?.locked === true || rows?.[0]?.locked === 't';
    if (!locked) {
      return undefined;
    }
    return await callback();
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
