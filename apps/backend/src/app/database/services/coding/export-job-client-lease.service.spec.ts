import { ServiceUnavailableException } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { ExportJobClientLeaseService } from './export-job-client-lease.service';

describe('ExportJobClientLeaseService', () => {
  const cacheService = {
    set: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn()
  };
  let service: ExportJobClientLeaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.set.mockResolvedValue(true);
    cacheService.exists.mockResolvedValue(true);
    cacheService.delete.mockResolvedValue(true);
    service = new ExportJobClientLeaseService(
      cacheService as unknown as CacheService
    );
  });

  it('creates, refreshes and releases a lease with a bounded TTL', async () => {
    const leaseId = await service.createLease();

    expect(leaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cacheService.set).toHaveBeenCalledWith(
      `export-client-lease:${leaseId}`,
      expect.objectContaining({ refreshedAt: expect.any(Number) }),
      ExportJobClientLeaseService.ttlSeconds
    );

    await service.refreshLease(leaseId);
    await expect(service.isLeaseActive(leaseId)).resolves.toBe(true);
    await service.releaseLease(leaseId);

    expect(cacheService.set).toHaveBeenCalledTimes(2);
    expect(cacheService.exists).toHaveBeenCalledWith(
      `export-client-lease:${leaseId}`
    );
    expect(cacheService.delete).toHaveBeenCalledWith(
      `export-client-lease:${leaseId}`
    );
  });

  it('rejects job creation when the initial lease cannot be persisted', async () => {
    cacheService.set.mockResolvedValue(false);

    await expect(service.createLease()).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
