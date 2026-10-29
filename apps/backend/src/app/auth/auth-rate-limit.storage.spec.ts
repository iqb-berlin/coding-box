import { ServiceUnavailableException } from '@nestjs/common';
import { AuthRateLimitStorage } from './auth-rate-limit.storage';

describe('authentication Redis rate limit storage', () => {
  const redis = { status: 'ready', eval: jest.fn(), disconnect: jest.fn() };
  const storage = new AuthRateLimitStorage(redis as never);

  beforeEach(() => {
    redis.status = 'ready';
    jest.clearAllMocks();
  });

  it('returns the shared counter and block interval', async () => {
    redis.eval.mockResolvedValue([121, 28, 1, 60]);
    await expect(storage.increment('opaque-key', 60_000, 120, 60_000, 'default')).resolves.toEqual({
      totalHits: 121, timeToExpire: 28, isBlocked: true, timeToBlockExpire: 60
    });
  });

  it('fails closed immediately instead of queueing requests during a reconnect', async () => {
    redis.status = 'reconnecting';
    await expect(storage.increment('key', 1000, 2, 1000, 'default')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('does not expose Redis errors or treat failures as an empty counter', async () => {
    redis.eval.mockRejectedValue(new Error('private Redis diagnostic'));
    await expect(storage.increment('key', 1000, 2, 1000, 'default'))
      .rejects.toThrow('Authentication temporarily unavailable');
  });

  it.each([null, [], [1, 2, 0], [1, '2', 0, 0], [NaN, 2, 0, 0]].map(value => [value]))('rejects malformed storage responses: %p', async result => {
    redis.eval.mockResolvedValue(result);
    await expect(storage.increment('key', 1000, 2, 1000, 'default')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('closes its dedicated connection on shutdown', () => {
    storage.onApplicationShutdown();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });
});
