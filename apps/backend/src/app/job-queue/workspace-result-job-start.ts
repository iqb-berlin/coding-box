import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Job } from 'bullmq';

// Separate from the long-running worker locks on test results and unit files.
const WORKSPACE_RESULT_JOB_START_NAMESPACE = 774020256;

export async function startWorkspaceResultJob<T>(
  database: DataSource,
  workspaceId: number,
  findUnfinished: (queue: 'test-results-upload' | 'test-person-coding') => Promise<Job | undefined>,
  enqueue: () => Promise<T>
): Promise<T> {
  return database.transaction(async manager => {
    const [row]: { locked: boolean }[] = await manager.query(
      'SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS locked',
      [WORKSPACE_RESULT_JOB_START_NAMESPACE, workspaceId]
    );
    if (!row.locked) {
      throw new ConflictException('An upload or auto-coding job is being started for this workspace.');
    }

    const upload = await findUnfinished('test-results-upload');
    if (upload) {
      throw new ConflictException(`An upload job is already running for workspace ${workspaceId} (job ${upload.id})`);
    }
    const coding = await findUnfinished('test-person-coding');
    if (coding) {
      throw new ConflictException(`A test person coding job is already running for workspace ${workspaceId} (job ${coding.id})`);
    }

    // The transaction owns the lock until Redis has accepted the entire submission.
    return enqueue();
  });
}
