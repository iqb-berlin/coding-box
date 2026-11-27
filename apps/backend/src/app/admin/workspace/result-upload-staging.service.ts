import {
  BadRequestException, ConflictException, Injectable, Logger
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { CacheService } from '../../cache/cache.service';
import { JobQueueService } from '../../job-queue/job-queue.service';

export const RESULT_UPLOAD_ROOT = path.resolve('temp', 'result-uploads');
export const UPLOAD_SESSION_TTL = 3600;
const PRUNE_AFTER_MS = 2 * UPLOAD_SESSION_TTL * 1000;

@Injectable()
export class ResultUploadStagingService {
  private readonly logger = new Logger(ResultUploadStagingService.name);

  constructor(private readonly db: DataSource, private readonly cache: CacheService, private readonly jobs: JobQueueService) {}

  // Serialize finalization and expiry across API instances. A disconnected
  // process releases its transaction lock without leaving a stale lease.
  withUploadLock<T>(uploadId: string, action: () => Promise<T>): Promise<T> {
    return this.db.transaction(async manager => {
      const [lock] = await manager.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`result-upload:${uploadId}`]);
      if (!lock.acquired) throw new ConflictException('Upload is being updated');
      return action();
    });
  }

  async assemble(session: { uploadId: string; tempDir: string; totalChunks: number; fileSize: number }): Promise<string> {
    const directory = path.join(RESULT_UPLOAD_ROOT, session.uploadId);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, 'merged.csv');
    if (await this.fileSize(target) === session.fileSize) return target;

    const chunkPath = (index: number) => path.join(session.tempDir, `chunk_${String(index).padStart(6, '0')}`);
    async function* readParts() {
      for (let i = 0; i < session.totalChunks; i++) {
        yield* createReadStream(chunkPath(i));
      }
    }
    // A previous release could finish its merge, remove the parts and then fail to enqueue.
    const legacyFile = path.join(session.tempDir, 'merged.csv');
    const legacySize = legacyFile === target ? undefined : await this.fileSize(legacyFile);
    const partial = path.join(directory, 'assembling');
    try {
      await pipeline(legacySize === session.fileSize ? createReadStream(legacyFile) : readParts(), createWriteStream(partial));
      if ((await fs.stat(partial)).size !== session.fileSize) throw new BadRequestException('Incomplete upload');
      await fs.rename(partial, target);
      // The durable, complete file is now the source for all subsequent attempts.
      for (let i = 0; i < session.totalChunks; i++) await fs.rm(chunkPath(i), { force: true });
      if (legacySize === session.fileSize) await fs.rm(legacyFile, { force: true });
      return target;
    } finally {
      await fs.rm(partial, { force: true });
    }
  }

  private async fileSize(file: string): Promise<number | undefined> {
    try {
      return (await fs.stat(file)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pruneExpiredSessions(): Promise<void> {
    const multipart = path.join(RESULT_UPLOAD_ROOT, 'multipart');
    await fs.mkdir(multipart, { recursive: true });
    for (const name of await fs.readdir(multipart)) {
      const file = path.join(multipart, name);
      try {
        if ((await fs.stat(file)).mtimeMs < Date.now() - PRUNE_AFTER_MS && await this.canRemoveJobFile(`multipart-${name}`)) {
          await fs.rm(file, { force: true });
        }
      } catch (error) {
        this.logger.warn(`Could not prune multipart upload ${name}: ${String(error)}`);
      }
    }
    const entries = await fs.readdir(RESULT_UPLOAD_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'multipart') continue;
      const directory = path.join(RESULT_UPLOAD_ROOT, entry.name);
      try {
        if ((await fs.stat(directory)).mtimeMs > Date.now() - PRUNE_AFTER_MS) continue;
        await this.withUploadLock(entry.name, async () => {
          if (await this.cache.getStrict(`chunked-upload:${entry.name}`)) return;
          if (!await this.canRemoveJobFile(`upload-${entry.name}`)) return;
          await fs.rm(directory, { recursive: true, force: true });
        });
      } catch (error) {
        this.logger.warn(`Could not prune upload ${entry.name}: ${String(error)}`);
      }
    }
  }

  private async canRemoveJobFile(jobId: string): Promise<boolean> {
    const job = await this.jobs.getUploadJob(jobId);
    return !job || ['completed', 'failed'].includes(await job.getState());
  }
}
