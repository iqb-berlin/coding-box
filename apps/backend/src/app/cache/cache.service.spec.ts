import { CacheService } from './cache.service';

type RedisMock = Record<string, jest.Mock> & {
  options?: {
    keyPrefix?: string;
  };
};

describe('CacheService', () => {
  let redis: RedisMock;
  let service: CacheService;

  beforeEach(() => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      incr: jest.fn(),
      scan: jest.fn()
    };
    service = new CacheService(redis as never);
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'warn').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('reads numbers and falls back on invalid values or redis errors', async () => {
    redis.get
      .mockResolvedValueOnce('42')
      .mockResolvedValueOnce('nope')
      .mockRejectedValueOnce(new Error('redis down'));

    await expect(service.getNumber('a', 7)).resolves.toBe(42);
    await expect(service.getNumber('b', 7)).resolves.toBe(7);
    await expect(service.getNumber('c', 7)).resolves.toBe(7);
  });

  it('increments values and returns zero on errors', async () => {
    redis.incr.mockResolvedValueOnce(3).mockRejectedValueOnce(new Error('redis down'));

    await expect(service.incr('count')).resolves.toBe(3);
    await expect(service.incr('count')).resolves.toBe(0);
  });

  it('generates stable cache keys', () => {
    expect(service.generateFlatResponseFilterOptionsVersionKey(3)).toBe('flat_response_filter_options:version:3');
    expect(service.generateFlatResponseFilterOptionsCacheKey(3, 4, 500)).toBe('flat_response_filter_options:3:v4:thr500');
    expect(service.generateUnitResponseCacheKey(1, 'person', 'unit')).toBe('responses:1:person:unit');
    expect(service.generateValidationCacheKey(2, 'hash')).toBe('validation:v2:2:hash');
  });

  it('gets, sets, deletes and checks cache values', async () => {
    redis.get
      .mockResolvedValueOnce(JSON.stringify({ ok: true }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('not-json');
    redis.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockRejectedValueOnce(new Error('redis down'));
    redis.del.mockResolvedValue(undefined);

    await expect(service.get('json')).resolves.toEqual({ ok: true });
    await expect(service.get('missing')).resolves.toBeNull();
    await expect(service.get('broken')).resolves.toBeNull();

    await expect(service.set('key', { value: 1 }, 10)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith('key', JSON.stringify({ value: 1 }), 'EX', 10);
    await expect(service.set('forever', { value: 2 }, 0)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith('forever', JSON.stringify({ value: 2 }));

    redis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.set('bad', { value: 3 })).resolves.toBe(false);

    await expect(service.delete('key')).resolves.toBe(true);
    redis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.delete('key')).resolves.toBe(false);

    await expect(service.exists('a')).resolves.toBe(true);
    await expect(service.exists('b')).resolves.toBe(false);
    await expect(service.exists('c')).resolves.toBe(false);
  });

  it('stores and pages validation results', async () => {
    const results = [{ unitName: 'U1' }, { unitName: 'U2' }, { unitName: 'U3' }] as never;
    const metadata = { total: 3, missing: 1, timestamp: 100 };

    await expect(service.storeValidationResults('validation-key', results, metadata, 60)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'validation-key',
      expect.stringContaining('"metadata"'),
      'EX',
      60
    );

    jest.spyOn(service, 'get').mockResolvedValueOnce({
      results,
      metadata,
      cachedAt: 101
    } as never);

    await expect(service.getPaginatedValidationResults('validation-key', 2, 2)).resolves.toEqual({
      results: [{ unitName: 'U3' }],
      metadata: {
        total: 3,
        missing: 1,
        timestamp: 100,
        currentPage: 2,
        pageSize: 2,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true
      }
    });

    jest.spyOn(service, 'get').mockResolvedValueOnce(null);
    await expect(service.getPaginatedValidationResults('missing', 1, 2)).resolves.toBeNull();
  });

  it('retrieves complete validation results and handles misses', async () => {
    jest.spyOn(service, 'get')
      .mockResolvedValueOnce({
        results: [{ unitName: 'U1' }],
        metadata: { total: 1, missing: 0, timestamp: 100 },
        cachedAt: 101
      } as never)
      .mockResolvedValueOnce(null);
    jest.spyOn(service, 'exists').mockResolvedValueOnce(false);

    await expect(service.getCompleteValidationResults('validation-key')).resolves.toEqual({
      results: [{ unitName: 'U1' }],
      metadata: { total: 1, missing: 0, timestamp: 100 }
    });
    await expect(service.getCompleteValidationResults('missing')).resolves.toBeNull();
  });

  it('deletes matching keys by scan pattern', async () => {
    redis.scan
      .mockResolvedValueOnce(['5', ['a', 'b']])
      .mockResolvedValueOnce(['0', []]);

    await service.deleteByPattern('prefix:*');

    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'prefix:*', 'COUNT', 100);
    expect(redis.del).toHaveBeenCalledWith('a', 'b');

    redis.scan.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.deleteByPattern('prefix:*')).resolves.toBeUndefined();
  });

  it('deletes matching keys by scan pattern with redis key prefixing enabled', async () => {
    redis.options = {
      keyPrefix: 'coding-box:cache:'
    };
    redis.scan
      .mockResolvedValueOnce([
        '0',
        [
          'coding-box:cache:coding_readiness:v2:1:1:abc',
          'coding-box:cache:coding_readiness:v2:1:2:def'
        ]
      ]);

    await service.deleteByPattern('coding_readiness:v2:1:*');

    expect(redis.scan)
      .toHaveBeenCalledWith(
        '0',
        'MATCH',
        'coding-box:cache:coding_readiness:v2:1:*',
        'COUNT',
        100
      );
    expect(redis.del)
      .toHaveBeenCalledWith(
        'coding_readiness:v2:1:1:abc',
        'coding_readiness:v2:1:2:def'
      );
  });
});
