import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { JobQueueService, RedisConnectionStatus } from '../job-queue/job-queue.service';

type Dependency = 'database' | 'redis';
type DependencyStatus = 'up' | 'down';

export interface ReadinessStatus {
  status: 'ok' | 'error' | 'shutting_down';
  checks: Partial<Record<Dependency, DependencyStatus>>;
}

export const READINESS_TIMEOUT_MS = 1000;

@Injectable()
export class ReadinessService implements BeforeApplicationShutdown {
  private readonly inFlight = new Map<Dependency, Promise<DependencyStatus>>();
  private shuttingDown = false;
  private redisDiagnostics?: Promise<RedisConnectionStatus>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('test-person-coding') private readonly queue: Queue,
    private readonly jobs: JobQueueService
  ) {}

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  async check(): Promise<ReadinessStatus> {
    if (this.shuttingDown) return { status: 'shutting_down', checks: {} };

    const [database, redis] = await Promise.all([
      this.checkDependency('database', async () => {
        if (!this.dataSource.isInitialized) throw new Error('Database is not initialized');
        await this.dataSource.query('SELECT 1');
      }),
      this.checkDependency('redis', async () => {
        const client = await this.queue.getBackend().client;
        if (!client || await client.runCommand('ping', []) !== 'PONG') {
          throw new Error('Redis is not available');
        }
      })
    ]);

    let status: ReadinessStatus['status'] = 'error';
    if (this.shuttingDown) status = 'shutting_down';
    else if (database === 'up' && redis === 'up') status = 'ok';
    return { status, checks: { database, redis } };
  }

  redisStatus(): Promise<RedisConnectionStatus> {
    const unavailable = { connected: false, message: 'Redis is unavailable' };
    if (this.shuttingDown) return Promise.resolve(unavailable);
    if (this.redisDiagnostics) return this.redisDiagnostics;

    // Keep a timed-out diagnostic operation shared until the driver settles.
    const pending = Promise.resolve().then(() => this.jobs.checkRedisConnection());
    const result = new Promise<RedisConnectionStatus>(resolve => {
      const timer = setTimeout(() => resolve(unavailable), READINESS_TIMEOUT_MS);
      pending.then(value => {
        clearTimeout(timer);
        this.redisDiagnostics = undefined;
        resolve(value);
      }, () => {
        clearTimeout(timer);
        this.redisDiagnostics = undefined;
        resolve(unavailable);
      });
    });
    this.redisDiagnostics = result;
    return result;
  }

  private async checkDependency(name: Dependency, probe: () => Promise<void>): Promise<DependencyStatus> {
    let pending = this.inFlight.get(name);
    if (!pending) {
      // A response timeout does not cancel the driver's operation. Share that
      // operation until it settles, including across later polling requests.
      pending = Promise.resolve().then(probe)
        .then<DependencyStatus, DependencyStatus>(() => 'up', () => 'down')
        .finally(() => { this.inFlight.delete(name); });
      this.inFlight.set(name, pending);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<DependencyStatus>(resolve => {
          timer = setTimeout(() => resolve('down'), READINESS_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
