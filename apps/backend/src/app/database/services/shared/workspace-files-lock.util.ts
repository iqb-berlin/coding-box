import { ConflictException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

const WORKSPACE_FILES_LOCK_NAMESPACE = 774020252;

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

export type WorkspaceFilesMutationLockAttempt<T> =
  | { acquired: true; value: T }
  | { acquired: false };

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

export async function tryLockWorkspaceFilesMutation(
  queryRunner: QueryRunner,
  workspaceId: number
): Promise<boolean> {
  const rows = await queryRunner.query(
    'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
    [WORKSPACE_FILES_LOCK_NAMESPACE, normalizeWorkspaceId(workspaceId)]
  ) as Array<{ locked: boolean }>;
  return rows[0]?.locked === true;
}

export async function withWorkspaceFilesMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  const lockAttempt = await tryWithWorkspaceFilesMutationLock(
    connection,
    workspaceId,
    callback
  );
  if (!lockAttempt.acquired) {
    throw new ConflictException(
      'Workspace files cannot be changed while an Autocoder or another file mutation is running.'
    );
  }
  return lockAttempt.value;
}

export async function tryWithWorkspaceFilesMutationLock<T>(
  connection: QueryRunnerFactory,
  workspaceId: number,
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<WorkspaceFilesMutationLockAttempt<T>> {
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const queryRunner = connection.createQueryRunner();
  let locked = false;

  await queryRunner.connect();
  try {
    locked = await tryLockWorkspaceFilesMutation(
      queryRunner,
      normalizedWorkspaceId
    );
    if (!locked) {
      return { acquired: false };
    }
    return {
      acquired: true,
      value: await callback(queryRunner)
    };
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
