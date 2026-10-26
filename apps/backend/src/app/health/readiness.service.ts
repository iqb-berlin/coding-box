import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

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

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('test-person-coding') private readonly queue: Queue
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
