import type { Queue } from 'bullmq';
import type { ValidationTaskJobData } from './job-queue.service';
import { readValidationTaskRecovery } from './validation-task-queue-state';

describe('validation queue recovery status', () => {
  it('distinguishes expired locks, active workers and failed legacy jobs', async () => {
    const jobs = [
      { id: 'validation-task-1', data: { taskId: 1 }, getState: async () => 'active' },
      { id: 'validation-task-2', data: { taskId: 2 }, getState: async () => 'active' }
    ];
    const legacyJob = { data: { taskId: 3 }, getState: async () => 'failed', failedReason: 'stalled' };
    const queue = {
      getJob: async (id: string) => jobs.find(job => job.id === id),
      getJobs: async () => [legacyJob],
      toKey: (key: string) => key,
      getBackend: () => ({
        client: Promise.resolve({
          runCommand: async (_command: string, [key]: string[]) => (key === 'validation-task-1:lock' ? 0 : 1)
        })
      })
    } as unknown as Queue<ValidationTaskJobData>;

    expect(await readValidationTaskRecovery(queue, [1, 2, 3])).toEqual(new Map([
      [1, { status: 'pending' }],
      [3, { status: 'failed', reason: 'stalled' }]
    ]));
  });
});
