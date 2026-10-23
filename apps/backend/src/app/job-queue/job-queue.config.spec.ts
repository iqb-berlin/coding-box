import { ConfigService } from '@nestjs/config';
import { createJobQueueOptions, JOB_QUEUE_NAMES } from './job-queue.config';

describe('BullMQ connection configuration', () => {
  it('keeps BullMQ queues separate from existing Bull and application cache keys', () => {
    expect(createJobQueueOptions(new ConfigService({
      REDIS_HOST: 'queue-host', REDIS_PORT: '6380', REDIS_PREFIX: 'tenant'
    }))).toEqual({ connection: { host: 'queue-host', port: 6380 }, prefix: 'tenant:bullmq' });
    expect(JOB_QUEUE_NAMES).toHaveLength(12);
    expect(new Set(JOB_QUEUE_NAMES).size).toBe(12);
  });

  it('provides the existing development connection defaults with a new queue namespace', () => {
    expect(createJobQueueOptions(new ConfigService())).toEqual({
      connection: { host: 'redis', port: 6379 }, prefix: 'coding-box:bullmq'
    });
  });
});
