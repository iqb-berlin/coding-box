import Redis from 'ioredis';
import { CacheClientModule } from './cache-client.module';

describe('Cache connection lifecycle', () => {
  it('disconnects the owned client during application shutdown without issuing a retrying command', () => {
    const redis = { disconnect: jest.fn(), quit: jest.fn() };
    new CacheClientModule(redis as unknown as Redis).onApplicationShutdown();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(redis.quit).not.toHaveBeenCalled();
  });
});
