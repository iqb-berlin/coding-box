import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JobQueueService, RedisConnectionStatus } from '../job-queue/job-queue.service';

type DependencyStatus = 'up' | 'down';

export interface ReadinessStatus {
  status: 'ok' | 'down';
  checks: { database: DependencyStatus; redis: DependencyStatus };
}

const READINESS_TIMEOUT_MS = 1500;

@Injectable()
export class ReadinessService {
  private readonly probes = new Map<string, Promise<unknown>>();

  constructor(private readonly database: DataSource, private readonly jobs: JobQueueService) {}

  async check(): Promise<ReadinessStatus> {
    const [database, redis] = await Promise.all([
      this.probe<DependencyStatus>('database', async () => { await this.database.query('SELECT 1'); return 'up'; }, 'down'),
      this.probe<DependencyStatus>('redis', async () => { await this.jobs.pingRedis(); return 'up'; }, 'down')
    ]);
    return { status: database === 'up' && redis === 'up' ? 'ok' : 'down', checks: { database, redis } };
  }

  redisStatus(): Promise<RedisConnectionStatus> {
    return this.probe('redis-details', () => this.jobs.checkRedisConnection(), {
      connected: false, message: 'Redis is unavailable'
    });
  }

  private probe<T>(key: string, operation: () => Promise<T>, unavailable: T): Promise<T> {
    const existing = this.probes.get(key);
    if (existing) return existing as Promise<T>;

    // A timed-out driver operation may still be pending. Share its failed probe
    // until it settles, rather than piling up queries during an outage.
    const pending = Promise.resolve().then(operation);
    const result = new Promise<T>(resolve => {
      const timer = setTimeout(() => resolve(unavailable), READINESS_TIMEOUT_MS);
      pending.then(value => {
        clearTimeout(timer);
        this.probes.delete(key);
        resolve(value);
      }, () => {
        clearTimeout(timer);
        this.probes.delete(key);
        resolve(unavailable);
      });
    });
    this.probes.set(key, result);
    return result;
  }
}
