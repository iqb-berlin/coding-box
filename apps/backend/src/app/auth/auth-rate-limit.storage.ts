import {
  Inject, Injectable, OnApplicationShutdown, ServiceUnavailableException
} from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

export const AUTH_RATE_LIMIT_REDIS = Symbol('AUTH_RATE_LIMIT_REDIS');
type RateLimitResult = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// One expiring hash per client/route. Redis time and a single script keep the
// counter and block period consistent across API replicas and concurrent calls.
const incrementScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local values = redis.call('HMGET', KEYS[1], 'hits', 'expires', 'blocked')
local hits = tonumber(values[1]) or 0
local expires = tonumber(values[2]) or 0
local blocked = tonumber(values[3]) or 0
if blocked > now then
  return {hits, math.max(0, math.ceil((expires - now) / 1000)), 1, math.ceil((blocked - now) / 1000)}
end
if expires <= now or blocked > 0 then
  hits = 0
  expires = now + tonumber(ARGV[1])
end
hits = hits + 1
blocked = 0
if hits > tonumber(ARGV[2]) then
  blocked = now + tonumber(ARGV[3])
end
redis.call('HSET', KEYS[1], 'hits', hits, 'expires', expires, 'blocked', blocked)
redis.call('PEXPIRE', KEYS[1], math.max(expires, blocked) - now)
return {hits, math.max(0, math.ceil((expires - now) / 1000)), blocked > now and 1 or 0, math.max(0, math.ceil((blocked - now) / 1000))}
`;

@Injectable()
export class AuthRateLimitStorage implements ThrottlerStorage, OnApplicationShutdown {
  constructor(@Inject(AUTH_RATE_LIMIT_REDIS) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<RateLimitResult> {
    try {
      if (this.redis.status !== 'ready') throw new Error('Redis is not ready');
      const result = await this.redis.eval(incrementScript, 1, `${throttlerName}:${key}`, ttl, limit, blockDuration);
      if (!Array.isArray(result) || result.length !== 4 || !result.every(value => Number.isFinite(value))) {
        throw new Error('Invalid rate limit response');
      }
      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = result as number[];
      return {
        totalHits, timeToExpire, isBlocked: blocked === 1, timeToBlockExpire
      };
    } catch {
      // An infrastructure outage must not silently disable authentication limits.
      throw new ServiceUnavailableException('Authentication temporarily unavailable');
    }
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
