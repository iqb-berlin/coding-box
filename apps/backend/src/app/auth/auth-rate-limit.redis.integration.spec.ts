import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { AuthRateLimitStorage } from './auth-rate-limit.storage';

const describeRedis = process.env.BULLMQ_TEST_REDIS_HOST && process.env.BULLMQ_TEST_REDIS_PORT ? describe : describe.skip;

describeRedis('authentication counters against isolated Redis', () => {
  const options = {
    host: process.env.BULLMQ_TEST_REDIS_HOST || '127.0.0.1',
    port: Number(process.env.BULLMQ_TEST_REDIS_PORT || 6379),
    keyPrefix: `auth-rate-limit-test:${randomUUID()}:`,
    lazyConnect: true,
    commandTimeout: 1000,
    maxRetriesPerRequest: 0
  };
  let clients: Redis[];
  let stores: AuthRateLimitStorage[];

  beforeAll(async () => {
    clients = [new Redis(options), new Redis(options)];
    await Promise.all(clients.map(client => client.connect()));
    stores = clients.map(client => new AuthRateLimitStorage(client));
  });

  afterAll(async () => {
    if (clients?.[0].status === 'ready') {
      await clients[0].del('default:parallel', 'default:expiring', 'default:block', 'other:parallel');
    }
    clients?.forEach(client => client.disconnect());
  });

  it('atomically enforces one limit across concurrent calls from two API replicas', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => (
      stores[index % 2].increment('parallel', 5000, 7, 5000, 'default')
    )));
    expect(results.filter(result => !result.isBlocked)).toHaveLength(7);
    expect(results.filter(result => result.isBlocked)).toHaveLength(43);
    expect(await clients[0].pttl('default:parallel')).toBeGreaterThan(0);
    expect((await stores[1].increment('parallel', 5000, 7, 5000, 'other')).isBlocked).toBe(false);
  });

  it('expires counters and permits requests after the block period', async () => {
    expect((await stores[0].increment('expiring', 100, 1, 100, 'default')).isBlocked).toBe(false);
    expect((await stores[1].increment('expiring', 100, 1, 100, 'default')).isBlocked).toBe(true);
    await new Promise(resolve => { setTimeout(resolve, 150); });
    const nextWindow = await stores[0].increment('expiring', 100, 1, 100, 'default');
    expect(nextWindow).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('does not extend a block when a blocked client keeps requesting', async () => {
    await stores[0].increment('block', 5000, 1, 5000, 'default');
    await stores[0].increment('block', 5000, 1, 5000, 'default');
    const before = await clients[0].pttl('default:block');
    await new Promise(resolve => { setTimeout(resolve, 25); });
    expect((await stores[1].increment('block', 5000, 1, 5000, 'default')).isBlocked).toBe(true);
    expect(await clients[0].pttl('default:block')).toBeLessThan(before);
  });
});
