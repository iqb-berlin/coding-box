import { Job, UnrecoverableError, Worker } from 'bullmq';
import {
  numericJobProgress, requireJobId, rethrowJobError, withQueueJobId
} from './job-queue.util';

describe('BullMQ job boundaries', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, ''])('rejects an unpersisted job ID (%s)', id => {
    expect(() => requireJobId({ id })).toThrow('missing its persisted ID');
  });

  it.each(['job-1', 42])('retains persisted job IDs (%s)', id => {
    expect(requireJobId({ id })).toBe(String(id));
  });

  it.each([undefined, 'phase', { rows: 8 }, Number.NaN])('keeps non-numeric progress out of numeric DTOs (%s)', progress => {
    expect(numericJobProgress({ progress })).toBe(0);
  });

  it('preserves numeric progress', () => {
    expect(numericJobProgress({ progress: 37 })).toBe(37);
  });

  it('assigns distinct UUIDs instead of reusing old numerical cache identifiers', () => {
    const first = withQueueJobId({ attempts: 3 });
    const second = withQueueJobId();
    expect(first.attempts).toBe(3);
    expect(first.jobId).toMatch(/^[a-f0-9-]{36}$/);
    expect(second.jobId).not.toBe(first.jobId);
  });

  it('retains explicit IDs used to deduplicate cache work', () => {
    expect(withQueueJobId({ jobId: 'flat-options-workspace-1', attempts: 2 }))
      .toEqual({ jobId: 'flat-options-workspace-1', attempts: 2 });
  });

  it.each(['isPaused', 'isCancelled', 'skipRetries'])('does not retry a failure after persisted %s', async flag => {
    jest.spyOn(Job, 'fromId').mockResolvedValue({ data: { [flag]: true } } as Job);
    await expect(rethrowJobError(new Error('processing failed'), {
      id: 'job-1', data: {}
    } as Job, () => ({} as Worker))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('retains ordinary errors for the configured retry policy', async () => {
    const error = new Error('temporary failure');
    jest.spyOn(Job, 'fromId').mockResolvedValue({ data: {} } as Job);
    await expect(rethrowJobError(error, { id: 'job-1', data: {} } as Job, () => ({} as Worker))).rejects.toBe(error);
  });

  it('does not mask the original failure when refreshing Redis data fails', async () => {
    const error = new Error('processing failed');
    jest.spyOn(Job, 'fromId').mockRejectedValue(new Error('Redis unavailable'));
    await expect(rethrowJobError(error, { id: 'job-1', data: {} } as Job, () => ({} as Worker))).rejects.toBe(error);
  });

  it('turns non-Error rejections into errors understood by the worker retry API', async () => {
    jest.spyOn(Job, 'fromId').mockResolvedValue({ data: {} } as Job);
    await expect(rethrowJobError('temporary failure', { id: 'job-1', data: {} } as Job, () => ({} as Worker)))
      .rejects.toThrow('temporary failure');
  });
});
