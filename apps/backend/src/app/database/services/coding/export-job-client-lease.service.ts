import {
  ConflictException,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService } from '../../../cache/cache.service';

@Injectable()
export class ExportJobClientLeaseService {
  static readonly ttlSeconds = 30;
  private static readonly cleanupClaimTtlSeconds = 30;

  private static readonly writeLeaseScript = `
    if redis.call('EXISTS', KEYS[2]) == 1 then
      return 0
    end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return 1
  `;

  private static readonly claimExpiredLeaseScript = `
    if redis.call('EXISTS', KEYS[1]) == 1 then
      return 0
    end
    if redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2], 'NX') then
      return 1
    end
    return 0
  `;

  private static readonly releaseCleanupClaimScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;

  private static readonly confirmCleanupClaimScript = `
    if redis.call('GET', KEYS[2]) ~= ARGV[1] then
      return 0
    end
    if redis.call('EXISTS', KEYS[1]) == 1 then
      return 0
    end
    return redis.call('EXPIRE', KEYS[2], ARGV[2])
  `;

  constructor(private readonly cacheService: CacheService) {}

  private static getCacheKey(leaseId: string): string {
    return `export-client-lease:${leaseId}`;
  }

  private static getCleanupClaimKey(leaseId: string): string {
    return `export-client-lease-cleanup:${leaseId}`;
  }

  async createLease(): Promise<string> {
    const leaseId = randomUUID();
    await this.writeLease(leaseId);
    return leaseId;
  }

  async refreshLease(leaseId: string): Promise<void> {
    await this.writeLease(leaseId);
  }

  async isLeaseActive(leaseId: string): Promise<boolean> {
    try {
      return await this.cacheService.existsStrict(
        ExportJobClientLeaseService.getCacheKey(leaseId)
      );
    } catch {
      throw new ServiceUnavailableException(
        'The export client lease status could not be determined'
      );
    }
  }

  async tryClaimExpiredLease(leaseId: string): Promise<string | null> {
    const cleanupClaim = randomUUID();
    try {
      const claimed = await this.cacheService.executeScript<number>(
        ExportJobClientLeaseService.claimExpiredLeaseScript,
        [
          ExportJobClientLeaseService.getCacheKey(leaseId),
          ExportJobClientLeaseService.getCleanupClaimKey(leaseId)
        ],
        [
          cleanupClaim,
          ExportJobClientLeaseService.cleanupClaimTtlSeconds.toString()
        ]
      );
      return Number(claimed) === 1 ? cleanupClaim : null;
    } catch {
      throw new ServiceUnavailableException(
        'The expired export client lease could not be claimed'
      );
    }
  }

  async releaseCleanupClaim(
    leaseId: string,
    cleanupClaim: string
  ): Promise<void> {
    try {
      await this.cacheService.executeScript<number>(
        ExportJobClientLeaseService.releaseCleanupClaimScript,
        [ExportJobClientLeaseService.getCleanupClaimKey(leaseId)],
        [cleanupClaim]
      );
    } catch {
      throw new ServiceUnavailableException(
        'The export client lease cleanup claim could not be released'
      );
    }
  }

  async confirmCleanupClaim(
    leaseId: string,
    cleanupClaim: string
  ): Promise<boolean> {
    try {
      const confirmed = await this.cacheService.executeScript<number>(
        ExportJobClientLeaseService.confirmCleanupClaimScript,
        [
          ExportJobClientLeaseService.getCacheKey(leaseId),
          ExportJobClientLeaseService.getCleanupClaimKey(leaseId)
        ],
        [
          cleanupClaim,
          ExportJobClientLeaseService.cleanupClaimTtlSeconds.toString()
        ]
      );
      return Number(confirmed) === 1;
    } catch {
      throw new ServiceUnavailableException(
        'The export client lease cleanup claim could not be confirmed'
      );
    }
  }

  async releaseLease(leaseId?: string): Promise<void> {
    if (!leaseId) return;
    await this.cacheService.delete(
      ExportJobClientLeaseService.getCacheKey(leaseId)
    );
  }

  private async writeLease(leaseId: string): Promise<void> {
    let written: number;
    try {
      written = await this.cacheService.executeScript<number>(
        ExportJobClientLeaseService.writeLeaseScript,
        [
          ExportJobClientLeaseService.getCacheKey(leaseId),
          ExportJobClientLeaseService.getCleanupClaimKey(leaseId)
        ],
        [
          JSON.stringify({ refreshedAt: Date.now() }),
          ExportJobClientLeaseService.ttlSeconds.toString()
        ]
      );
    } catch {
      throw new ServiceUnavailableException(
        'The export client lease could not be persisted'
      );
    }
    if (Number(written) !== 1) {
      throw new ConflictException(
        'The export client lease is already being cleaned up'
      );
    }
  }
}
