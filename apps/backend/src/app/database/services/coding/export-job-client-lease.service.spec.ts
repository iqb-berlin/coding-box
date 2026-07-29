import {
  ConflictException,
  ServiceUnavailableException
} from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { ExportJobClientLeaseService } from './export-job-client-lease.service';

describe('ExportJobClientLeaseService', () => {
  const cacheService = {
    executeScript: jest.fn(),
    existsStrict: jest.fn(),
    delete: jest.fn()
  };
  let service: ExportJobClientLeaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.executeScript.mockResolvedValue(1);
    cacheService.existsStrict.mockResolvedValue(true);
    cacheService.delete.mockResolvedValue(true);
    service = new ExportJobClientLeaseService(
      cacheService as unknown as CacheService
    );
  });

  it('creates, refreshes and releases a lease with a bounded TTL', async () => {
    const leaseId = await service.createLease();

    expect(leaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ExportJobClientLeaseService.ttlSeconds).toBeGreaterThan(60);
    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      [
        `export-client-lease:${leaseId}`,
        `export-client-lease-cleanup:${leaseId}`
      ],
      [
        expect.stringContaining('refreshedAt'),
        ExportJobClientLeaseService.ttlSeconds.toString()
      ]
    );

    await service.refreshLease(leaseId);
    await expect(service.isLeaseActive(leaseId)).resolves.toBe(true);
    await service.releaseLease(leaseId);

    expect(cacheService.executeScript).toHaveBeenCalledTimes(2);
    expect(cacheService.existsStrict).toHaveBeenCalledWith(
      `export-client-lease:${leaseId}`
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      `export-client-lease:${leaseId}`
    );
  });

  it('rejects job creation when the initial lease cannot be persisted', async () => {
    cacheService.executeScript.mockRejectedValue(new Error('redis down'));

    await expect(service.createLease()).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('claims an expired lease atomically and releases only that claim', async () => {
    const cleanupClaim = await service.tryClaimExpiredLease('lease-id');

    expect(cleanupClaim).toMatch(/^[0-9a-f-]{36}$/);
    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringContaining("'NX'"),
      [
        'export-client-lease:lease-id',
        'export-client-lease-cleanup:lease-id'
      ],
      [cleanupClaim, '30']
    );

    await service.releaseCleanupClaim('lease-id', cleanupClaim as string);
    expect(cacheService.executeScript).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('GET'"),
      ['export-client-lease-cleanup:lease-id'],
      [cleanupClaim]
    );
  });

  it('confirms ownership and extends a cleanup claim atomically', async () => {
    await expect(service.confirmCleanupClaim(
      'lease-id',
      'cleanup-claim'
    )).resolves.toBe(true);

    expect(cacheService.executeScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE'"),
      [
        'export-client-lease:lease-id',
        'export-client-lease-cleanup:lease-id'
      ],
      ['cleanup-claim', '30']
    );

    cacheService.executeScript.mockResolvedValueOnce(0);
    await expect(service.confirmCleanupClaim(
      'lease-id',
      'expired-claim'
    )).resolves.toBe(false);
  });

  it('does not claim a lease that is active or already being cleaned up', async () => {
    cacheService.executeScript.mockResolvedValue(0);

    await expect(service.tryClaimExpiredLease('lease-id')).resolves.toBeNull();
    await expect(service.refreshLease('lease-id')).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('treats an unavailable lease status as unknown instead of expired', async () => {
    cacheService.existsStrict.mockRejectedValue(new Error('redis down'));

    await expect(service.isLeaseActive('lease-id')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
