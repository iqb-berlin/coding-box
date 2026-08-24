import { DataSource, QueryRunner } from 'typeorm';

const WORKSPACE_FILES_LOCK_NAMESPACE = 774020252;

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

function normalizeWorkspaceId(workspaceId: number): number {
  const normalized = Number(workspaceId);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(
      'A valid workspace id is required for the files mutation lock.'
    );
  }
  return normalized;
}

export async function lockWorkspaceFilesMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query('SELECT pg_advisory_lock($1::int, $2::int)', [
    WORKSPACE_FILES_LOCK_NAMESPACE,
    normalizeWorkspaceId(workspaceId)
  ]);
}

export async function unlockWorkspaceFilesMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<void> {
  await queryRunner.query('SELECT pg_advisory_unlock($1::int, $2::int)', [
    WORKSPACE_FILES_LOCK_NAMESPACE,
    normalizeWorkspaceId(workspaceId)
  ]);
}

export async function withWorkspaceFilesMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: () => Promise<T>
): Promise<T> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner = connection.createQueryRunner();
  let locked = false;

  await queryRunner.connect();
  try {
    await lockWorkspaceFilesMutation(queryRunner, normalizedWorkspaceId);
    locked = true;
    return await callback();
  } finally {
    try {
      if (locked) {
        await unlockWorkspaceFilesMutation(queryRunner, normalizedWorkspaceId);
      }
    } finally {
      await queryRunner.release();
    }
  }
}
