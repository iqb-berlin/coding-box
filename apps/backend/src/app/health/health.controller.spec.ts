import { HealthController } from './health.controller';
import { JobQueueService } from '../job-queue/job-queue.service';

describe('HealthController', () => {
  let controller: HealthController;
  let jobQueueService: Pick<JobQueueService, 'checkRedisConnection'>;

  beforeEach(() => {
    jobQueueService = {
      checkRedisConnection: jest.fn().mockResolvedValue({
        connected: true,
        message: 'Redis is connected'
      })
    };
    controller = new HealthController(jobQueueService as JobQueueService);
  });

  it('should return application health status', () => {
    const result = controller.checkApplication();

    expect(result.status).toBe('ok');
    expect(result.uptime).toEqual(expect.any(Number));
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('should return Redis health status', async () => {
    await expect(controller.checkRedisConnection()).resolves.toEqual({
      connected: true,
      message: 'Redis is connected'
    });
    expect(jobQueueService.checkRedisConnection).toHaveBeenCalled();
  });
});

describe('readiness', () => {
  it('returns 503 when Redis is disconnected', async () => {
    const controller = new HealthController({
      checkRedisConnection: jest.fn().mockResolvedValue({ connected: false })
    } as never);
    await expect(controller.checkReadiness()).rejects.toMatchObject({ status: 503 });
  });

  it('bounds the check even when the Redis client never responds', async () => {
    jest.useFakeTimers();
    try {
      const controller = new HealthController({
        checkRedisConnection: jest.fn(() => new Promise(() => { /* Simulate a disconnected client that never settles. */ }))
      } as never);
      const result = expect(controller.checkReadiness()).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(1500);
      await result;
    } finally {
      jest.useRealTimers();
    }
  });
});
