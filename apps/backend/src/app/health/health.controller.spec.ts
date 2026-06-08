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
