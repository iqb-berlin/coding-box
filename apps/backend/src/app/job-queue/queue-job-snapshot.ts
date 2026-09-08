import { Job, Queue } from 'bull';

/** Capture IDs atomically before loading potentially large job hashes in batches. */
export async function* getQueueJobsInBatches(queue: Queue): AsyncGenerator<Job[]> {
  const transaction = queue.client.multi();
  for (const state of ['active', 'wait', 'paused']) {
    transaction.lrange(queue.toKey(state), 0, -1);
  }
  for (const state of ['delayed', 'completed', 'failed']) {
    transaction.zrange(queue.toKey(state), 0, -1);
  }
  const replies = await transaction.exec();
  if (!replies) throw new Error('Queue ID snapshot failed');
  const ids = new Set<string>();
  for (const [error, reply] of replies) {
    if (error) throw error;
    for (const id of reply as string[]) ids.add(id);
  }
  const snapshot = [...ids];
  for (let start = 0; start < snapshot.length; start += 50) {
    const jobs = await Promise.all(snapshot.slice(start, start + 50).map(id => queue.getJob(id)));
    yield jobs.filter((job): job is Job => job !== null);
  }
}
