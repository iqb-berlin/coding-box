import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService } from '../cache/cache.service';
import type { ExportJobData } from './job-queue.service';

export interface ExportJobHistoryScope {
  workspaceId: number;
  userId?: number;
  exportTypes: readonly string[];
}

export type LegacyExportHistoryBackfillClaim =
  | { status: 'claimed'; claim: string }
  | { status: 'busy' }
  | { status: 'complete' };

@Injectable()
export class ExportJobHistoryIndexService {
  static readonly candidateLimit = 2000;
  private static readonly maxEntriesPerKey = 2000;
  private static readonly indexTtlSeconds = 2 * 24 * 60 * 60;

  private static readonly legacyBackfillClaimTtlSeconds = 5 * 60;
  private static readonly legacyBackfillCompleteKey =
    'export-job-history:v2:legacy-backfill-complete';

  private static readonly legacyBackfillClaimKey =
    'export-job-history:v2:legacy-backfill-claim';

  private static readonly addJobScript = `
    local maxEntries = tonumber(ARGV[3])
    for _, key in ipairs(KEYS) do
      redis.call('ZADD', key, ARGV[2], ARGV[1])
      local entryCount = redis.call('ZCARD', key)
      if entryCount > maxEntries then
        redis.call('ZREMRANGEBYRANK', key, 0, entryCount - maxEntries - 1)
      end
      redis.call('EXPIRE', key, ARGV[4])
    end
    return 1
  `;

  private static readonly getRecentJobsScript = `
    local result = {}
    local limit = tonumber(ARGV[1])
    for _, key in ipairs(KEYS) do
      local entries = redis.call('ZREVRANGE', key, 0, limit - 1, 'WITHSCORES')
      for _, entry in ipairs(entries) do
        table.insert(result, entry)
      end
    end
    return result
  `;

  private static readonly removeJobsScript = `
    if #ARGV == 0 then
      return 0
    end
    local removed = 0
    for _, key in ipairs(KEYS) do
      removed = removed + redis.call('ZREM', key, unpack(ARGV))
    end
    return removed
  `;

  private static readonly claimLegacyBackfillScript = `
    if redis.call('EXISTS', KEYS[1]) == 1 then
      return 2
    end
    if redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2], 'NX') then
      return 1
    end
    return 0
  `;

  private static readonly completeLegacyBackfillScript = `
    if redis.call('GET', KEYS[2]) ~= ARGV[1] then
      return 0
    end
    redis.call('SET', KEYS[1], '1')
    redis.call('DEL', KEYS[2])
    return 1
  `;

  private static readonly refreshLegacyBackfillClaimScript = `
    if redis.call('GET', KEYS[1]) ~= ARGV[1] then
      return 0
    end
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return 1
  `;

  private static readonly releaseLegacyBackfillClaimScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;

  constructor(private readonly cacheService: CacheService) {}

  async addJob(
    jobId: string,
    data: ExportJobData,
    timestamp: number
  ): Promise<void> {
    await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.addJobScript,
      this.getIndexKeys({
        workspaceId: data.workspaceId,
        userId: Number(data.userId),
        exportTypes: [data.exportType]
      }, true),
      [
        jobId,
        timestamp.toString(),
        ExportJobHistoryIndexService.maxEntriesPerKey.toString(),
        ExportJobHistoryIndexService.indexTtlSeconds.toString()
      ]
    );
  }

  async getRecentJobIds(
    scope: ExportJobHistoryScope,
    limit = ExportJobHistoryIndexService.candidateLimit
  ): Promise<string[]> {
    const keys = this.getIndexKeys(scope, false);
    if (!keys.length || limit <= 0) {
      return [];
    }

    const entries = await this.cacheService.executeScript<string[]>(
      ExportJobHistoryIndexService.getRecentJobsScript,
      keys,
      [limit.toString()]
    );
    const scoresByJobId = new Map<string, number>();
    for (let index = 0; index < entries.length; index += 2) {
      const jobId = entries[index];
      const score = Number(entries[index + 1]);
      const previousScore = scoresByJobId.get(jobId);
      if (previousScore === undefined || score > previousScore) {
        scoresByJobId.set(jobId, score);
      }
    }

    return [...scoresByJobId.entries()]
      .sort((first, second) => (
        second[1] - first[1] || first[0].localeCompare(second[0])
      ))
      .slice(0, limit)
      .map(([jobId]) => jobId);
  }

  async removeJobIds(
    scope: ExportJobHistoryScope,
    jobIds: readonly string[]
  ): Promise<void> {
    const keys = this.getIndexKeys(scope, false);
    if (!keys.length || !jobIds.length) {
      return;
    }
    await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.removeJobsScript,
      keys,
      [...jobIds]
    );
  }

  async claimLegacyBackfill(): Promise<LegacyExportHistoryBackfillClaim> {
    const claim = randomUUID();
    const claimed = await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.claimLegacyBackfillScript,
      [
        ExportJobHistoryIndexService.legacyBackfillCompleteKey,
        ExportJobHistoryIndexService.legacyBackfillClaimKey
      ],
      [
        claim,
        ExportJobHistoryIndexService.legacyBackfillClaimTtlSeconds.toString()
      ]
    );
    if (Number(claimed) === 1) {
      return { status: 'claimed', claim };
    }
    return { status: Number(claimed) === 2 ? 'complete' : 'busy' };
  }

  async completeLegacyBackfill(claim: string): Promise<void> {
    const completed = await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.completeLegacyBackfillScript,
      [
        ExportJobHistoryIndexService.legacyBackfillCompleteKey,
        ExportJobHistoryIndexService.legacyBackfillClaimKey
      ],
      [claim]
    );
    if (Number(completed) !== 1) {
      throw new Error('The legacy export history backfill claim expired');
    }
  }

  async refreshLegacyBackfillClaim(claim: string): Promise<void> {
    const refreshed = await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.refreshLegacyBackfillClaimScript,
      [ExportJobHistoryIndexService.legacyBackfillClaimKey],
      [
        claim,
        ExportJobHistoryIndexService.legacyBackfillClaimTtlSeconds.toString()
      ]
    );
    if (Number(refreshed) !== 1) {
      throw new Error('The legacy export history backfill claim expired');
    }
  }

  async releaseLegacyBackfillClaim(claim: string): Promise<void> {
    await this.cacheService.executeScript<number>(
      ExportJobHistoryIndexService.releaseLegacyBackfillClaimScript,
      [ExportJobHistoryIndexService.legacyBackfillClaimKey],
      [claim]
    );
  }

  private getIndexKeys(
    scope: ExportJobHistoryScope,
    includeWorkspaceKeyForUser: boolean
  ): string[] {
    const keys = new Set<string>();
    [...new Set(scope.exportTypes)].forEach(exportType => {
      if (scope.userId === undefined || includeWorkspaceKeyForUser) {
        keys.add(
          `export-job-history:v1:workspace:${scope.workspaceId}:type:${exportType}`
        );
      }
      if (scope.userId !== undefined) {
        keys.add(
          `export-job-history:v1:workspace:${scope.workspaceId}:user:` +
          `${scope.userId}:type:${exportType}`
        );
      }
    });
    return [...keys];
  }
}
