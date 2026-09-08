import { getQueueJobsInBatches } from './queue-job-snapshot';

describe('queue ID snapshots', () => {
  it('keeps all IDs when states move between detail batches and skips removed jobs', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => String(index));
    const transaction = {
      lrange: jest.fn(),
      zrange: jest.fn(),
      exec: jest.fn().mockResolvedValue([[null, ids], [null, ['0']]])
    };
    let firstBatchLoaded = false;
    const queue = {
      client: { multi: jest.fn().mockReturnValue(transaction) },
      toKey: (state: string) => `queue:${state}`,
      getJob: jest.fn(async (id: string) => {
        if (id === '50') expect(firstBatchLoaded).toBe(true);
        return id === '10' ? null : { id, state: firstBatchLoaded ? 'completed' : 'active' };
      })
    };
    const seen: string[] = [];
    for await (const jobs of getQueueJobsInBatches(queue as never)) {
      expect(jobs.length).toBeLessThanOrEqual(50);
      seen.push(...jobs.map(job => String(job.id)));
      firstBatchLoaded = true;
    }
    expect(seen).toEqual(ids.filter(id => id !== '10'));
    expect(transaction.exec).toHaveBeenCalledTimes(1);
    expect(transaction.lrange).toHaveBeenCalledWith('queue:wait', 0, -1);
    expect(transaction.zrange).toHaveBeenCalledWith('queue:completed', 0, -1);
    expect(queue.getJob).toHaveBeenCalledTimes(51);
  });

  it('fails the snapshot on a Redis command error instead of returning a partial overview', async () => {
    const transaction = {
      lrange: jest.fn(),
      zrange: jest.fn(),
      exec: jest.fn().mockResolvedValue([[new Error('read failed'), null]])
    };
    const queue = { client: { multi: () => transaction }, toKey: (key: string) => key };
    const iterator = getQueueJobsInBatches(queue as never);
    await expect(iterator.next()).rejects.toThrow('read failed');
  });
});
