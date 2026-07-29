import {
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService } from '../../../cache/cache.service';

@Injectable()
export class ExportJobClientLeaseService {
  static readonly ttlSeconds = 30;

  constructor(private readonly cacheService: CacheService) {}

  private static getCacheKey(leaseId: string): string {
    return `export-client-lease:${leaseId}`;
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
    return this.cacheService.exists(
      ExportJobClientLeaseService.getCacheKey(leaseId)
    );
  }

  async releaseLease(leaseId?: string): Promise<void> {
    if (!leaseId) return;
    await this.cacheService.delete(
      ExportJobClientLeaseService.getCacheKey(leaseId)
    );
  }

  private async writeLease(leaseId: string): Promise<void> {
    const written = await this.cacheService.set(
      ExportJobClientLeaseService.getCacheKey(leaseId),
      { refreshedAt: Date.now() },
      ExportJobClientLeaseService.ttlSeconds
    );
    if (!written) {
      throw new ServiceUnavailableException(
        'The export client lease could not be persisted'
      );
    }
  }
}
