import {
  Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const JOB_RESULT_MAX_AGE_SECONDS = 7 * 86400;
export interface StoredJobResult {
  kind: 'stored-job-result-v1';
  id: string;
}

@Injectable()
export class JobResultStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobResultStore.name);
  // temp is backed by export_temp_vol on API and workers and is NOT a static asset root.
  private readonly directory = path.resolve(process.env.JOB_RESULT_DIR || 'temp/job-results');
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(@InjectQueue('test-results-upload') private readonly uploadQueue: Queue) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch(error => this.logger.error(`Job result cleanup failed: ${error.message}`));
    }, 3600000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  async save(value: unknown, jobId: string): Promise<StoredJobResult> {
    await fs.mkdir(this.directory, { recursive: true });
    const id = randomUUID();
    const target = path.join(this.directory, `${id}.json.gz`);
    const temporary = `${target}.partial`;
    const owner = path.join(this.directory, `${id}.owner.json`);
    try {
      // Publish ownership before the payload/reference can become visible.
      await fs.writeFile(owner, JSON.stringify({ jobId }), { flag: 'wx', mode: 0o600 });
      await fs.writeFile(temporary, await compress(JSON.stringify(value)), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      await fs.rm(owner, { force: true });
      throw error;
    }
    return { kind: 'stored-job-result-v1', id };
  }

  async read(value: unknown): Promise<unknown> {
    if (!value || typeof value !== 'object' || (value as StoredJobResult).kind !== 'stored-job-result-v1') {
      return value; // Jobs created before this change store their result inline.
    }
    const { id } = value as StoredJobResult;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
      throw new ServiceUnavailableException('Invalid job result reference');
    }
    try {
      const bytes = await fs.readFile(path.join(this.directory, `${id}.json.gz`));
      return JSON.parse((await decompress(bytes)).toString('utf8'));
    } catch {
      throw new ServiceUnavailableException('Job result is unavailable or expired');
    }
  }

  async cleanupExpired(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    // Age only identifies cleanup candidates. Bull retention is lazy: keep the
    // report as long as its owning job exists, even beyond the nominal age.
    const cutoff = Date.now() - (JOB_RESULT_MAX_AGE_SECONDS + 86400) * 1000;
    for (const entry of entries) {
      if (!/^[a-f0-9-]{36}\.(?:json\.gz(?:\.partial)?|owner\.json)$/.test(entry)) continue;
      const file = path.join(this.directory, entry);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
        const id = entry.slice(0, 36);
        const ownerFile = path.join(this.directory, `${id}.owner.json`);
        let owner: { jobId: string };
        try {
          owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
        } catch (error) {
          // Unknown ownership is not proof that a report is unused.
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (typeof owner.jobId !== 'string' || !owner.jobId) continue;
        // EXISTS avoids downloading legacy, potentially very large job results.
        if (await this.uploadQueue.client.exists(this.uploadQueue.toKey(owner.jobId))) continue;
        await fs.rm(path.join(this.directory, `${id}.json.gz`), { force: true });
        await fs.rm(path.join(this.directory, `${id}.json.gz.partial`), { force: true });
        await fs.rm(ownerFile, { force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}
