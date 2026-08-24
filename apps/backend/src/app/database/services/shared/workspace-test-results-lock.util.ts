import { DataSource, EntityManager, QueryRunner } from 'typeorm';

const WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE = 774020251;

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

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

export async function lockWorkspaceTestResultsMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query(
    'SELECT pg_advisory_lock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
}

export async function unlockWorkspaceTestResultsMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query(
    'SELECT pg_advisory_unlock($1::int, $2::int)',
    [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  );
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
    await lockWorkspaceTestResultsMutation(queryRunner, normalizedWorkspaceId);
    locked = true;
    return await callback();
  } finally {
    try {
      if (locked) {
        await unlockWorkspaceTestResultsMutation(
          queryRunner,
          normalizedWorkspaceId
        );
      }
    } finally {
      await queryRunner.release();
    }
  }
}
