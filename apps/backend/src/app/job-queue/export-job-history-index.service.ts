import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import type { ExportJobData } from './job-queue.service';

export interface ExportJobHistoryScope {
  workspaceId: number;
  userId?: number;
  exportTypes: readonly string[];
}

@Injectable()
export class ExportJobHistoryIndexService {
  static readonly candidateLimit = 2000;
  private static readonly maxEntriesPerKey = 2000;
  private static readonly indexTtlSeconds = 2 * 24 * 60 * 60;

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
