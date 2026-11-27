import { randomUUID } from 'node:crypto';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';

export const TEST_FILES_UPLOAD_PROCESS = 'test-files-upload';
const ACTIVE_TTL_MS = 60_000;
const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export type ReportFileUploadProgress = (fraction: number) => void;

const publishProcess = `
local current = redis.call('GET', KEYS[1])
local version = current and cjson.decode(current).version
if version and version >= ARGV[1] then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(ARGV[4]) <= now then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

// Keep the version until expiry so a late write cannot recreate a removed entry.
const removeProcess = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local process = cjson.decode(current)
if process.id ~= ARGV[1] or process.removed or
   (process.status ~= 'completed' and process.status ~= 'failed') then return 0 end
process.removed = true
redis.call('SET', KEYS[1], cjson.encode(process), 'KEEPTTL')
return 1
`;

@Injectable()
export class WorkspaceFileUploadProcessService implements OnApplicationShutdown {
  private readonly redis: Redis;

  constructor(@InjectRedis() cacheRedis: Redis) {
    // Status commands use a separate connection with bounded waits and no replay.
    this.redis = cacheRedis.duplicate({
      lazyConnect: false,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 0,
      commandTimeout: 1000,
      socketTimeout: 2000
    });
    this.redis.on('error', () => undefined);
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }

  private getKey(workspaceId: number): string {
    return `${TEST_FILES_UPLOAD_PROCESS}:workspace:${workspaceId}`;
  }

  async getProcess(workspaceId: number): Promise<ProcessDto | null> {
    try {
      const value = await this.redis.get(this.getKey(workspaceId));
      if (!value) return null;
      const { removed, version, ...process } = JSON.parse(value) as ProcessDto & { removed?: boolean; version?: string };
      return removed ? null : process;
    } catch {
      return null;
    }
  }

  async removeFinishedProcess(workspaceId: number, id: string): Promise<boolean> {
    try {
      return (await this.redis.eval(removeProcess, 1, this.getKey(workspaceId), id)) === 1;
    } catch {
      return false;
    }
  }

  // Called while holding the workspace file mutation lock.
  async track(
    workspaceId: number,
    uploadOrder: string,
    fileCount: number,
    upload: (report: ReportFileUploadProgress) => Promise<TestFilesUploadResultDto>
  ): Promise<TestFilesUploadResultDto> {
    const key = this.getKey(workspaceId);
    const startedOn = Date.now();
    const process = {
      id: randomUUID(),
      queueName: TEST_FILES_UPLOAD_PROCESS,
      timestamp: startedOn,
      processedOn: startedOn
    };
    let revision = 0;
    const publish = (snapshot: ProcessDto, ttl: number) => {
      revision += 1;
      const version = `${uploadOrder.padStart(20, '0')}:${String(revision).padStart(8, '0')}`;
      this.redis.eval(publishProcess, 1, key, version, JSON.stringify({ ...snapshot, version }), ttl, Date.now() + ACTIVE_TTL_MS)
        .catch(() => undefined);
    };
    let progress = 0;
    const publishActive = () => publish({
      ...process, status: 'active', progress, data: { fileCount }
    }, ACTIVE_TTL_MS);

    publishActive();
    // The active entry expires if the server stops, even during a long batch.
    const heartbeat = setInterval(publishActive, HEARTBEAT_INTERVAL_MS).unref();
    let result: TestFilesUploadResultDto | undefined;
    try {
      result = await upload(fraction => {
        const next = Math.min(99, Math.floor(fraction * 100));
        if (next > progress) {
          progress = next;
          publishActive();
        }
      });
      return result;
    } finally {
      clearInterval(heartbeat);
      const conflictCount = result?.conflicts?.length ?? 0;
      const completed = result && (result.failed === 0 || result.uploaded > 0 || conflictCount > 0);
      publish({
        ...process,
        status: completed ? 'completed' : 'failed',
        progress: result ? 100 : progress,
        finishedOn: Date.now(),
        data: {
          fileCount, uploadedFileCount: result?.uploaded, failedFileCount: result?.failed, conflictCount
        }
      }, FINISHED_TTL_MS);
    }
  }
}
