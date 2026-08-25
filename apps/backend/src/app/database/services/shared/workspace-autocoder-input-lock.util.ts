import { DataSource, QueryRunner } from 'typeorm';
import {
  tryLockWorkspaceFilesMutation,
  unlockWorkspaceFilesMutation
} from './workspace-files-lock.util';
import {
  tryLockWorkspaceTestResultsMutation,
  unlockWorkspaceTestResultsMutation
} from './workspace-test-results-lock.util';

type QueryRunnerFactory = Pick<DataSource, 'createQueryRunner'>;

export type WorkspaceAutocoderInputMutationLockAttempt<T> =
  | { acquired: true; value: T }
  | { acquired: false };

function normalizeWorkspaceIds(workspaceIds: number[]): number[] {
  const normalizedWorkspaceIds = Array.from(new Set(
    workspaceIds.map(workspaceId => Number(workspaceId))
  )).sort((left, right) => left - right);

  if (
    normalizedWorkspaceIds.length === 0 ||
    normalizedWorkspaceIds.some(workspaceId => !Number.isInteger(workspaceId) || workspaceId < 1)
  ) {
    throw new Error(
      'At least one valid workspace id is required for the Autocoder input mutation lock.'
    );
  }

  return normalizedWorkspaceIds;
}

export async function tryWithWorkspaceAutocoderInputMutationLocks<T>(
  connection: QueryRunnerFactory,
  workspaceIds: number[],
  callback: (queryRunner: QueryRunner) => Promise<T>
): Promise<WorkspaceAutocoderInputMutationLockAttempt<T>> {
  const normalizedWorkspaceIds = normalizeWorkspaceIds(workspaceIds);
  const queryRunner = connection.createQueryRunner();
  const lockedTestResultsWorkspaceIds: number[] = [];
  const lockedFilesWorkspaceIds: number[] = [];

  await queryRunner.connect();
  try {
    // Keep the global lock order aligned with the Autocoder. Sorting also
    // prevents two multi-workspace deletions from acquiring workspace locks
    // in opposite orders.
    for (const workspaceId of normalizedWorkspaceIds) {
      const locked = await tryLockWorkspaceTestResultsMutation(
        queryRunner,
        workspaceId
      );
      if (!locked) {
        return { acquired: false };
      }
      lockedTestResultsWorkspaceIds.push(workspaceId);
    }
    for (const workspaceId of normalizedWorkspaceIds) {
      const locked = await tryLockWorkspaceFilesMutation(
        queryRunner,
        workspaceId
      );
      if (!locked) {
        return { acquired: false };
      }
      lockedFilesWorkspaceIds.push(workspaceId);
    }

    return {
      acquired: true,
      value: await callback(queryRunner)
    };
  } finally {
    try {
      for (const workspaceId of lockedFilesWorkspaceIds.reverse()) {
        await unlockWorkspaceFilesMutation(queryRunner, workspaceId);
      }
    } finally {
      try {
        for (const workspaceId of lockedTestResultsWorkspaceIds.reverse()) {
          await unlockWorkspaceTestResultsMutation(queryRunner, workspaceId);
        }
      } finally {
        await queryRunner.release();
      }
    }
  }
}
