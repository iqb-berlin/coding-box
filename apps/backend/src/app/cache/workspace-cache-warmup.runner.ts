import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Persons from '../database/entities/persons.entity';
import {
  captureMemoryUsage,
  formatMemoryUsage,
  isHeapUsageHigh
} from './memory-usage.util';

interface WorkspaceCacheWarmupLogger {
  debug(message: string): void;
  error(message: string, stack?: string): void;
  log(message: string): void;
  warn(message: string): void;
}

export interface WorkspaceCacheWarmupOptions {
  key: string;
  description: string;
  logger: WorkspaceCacheWarmupLogger;
  warmWorkspace: (workspaceId: number) => Promise<void>;
}

@Injectable()
export class WorkspaceCacheWarmupRunner {
  private readonly inFlightRuns = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>
  ) {}

  run(options: WorkspaceCacheWarmupOptions): Promise<void> {
    const activeRun = this.inFlightRuns.get(options.key);
    if (activeRun) {
      options.logger.warn(
        `Skipping ${options.description} cache warmup because the previous run is still active`
      );
      return activeRun;
    }

    const run = this.execute(options).finally(() => {
      if (this.inFlightRuns.get(options.key) === run) {
        this.inFlightRuns.delete(options.key);
      }
    });
    this.inFlightRuns.set(options.key, run);
    return run;
  }

  private async execute(options: WorkspaceCacheWarmupOptions): Promise<void> {
    const startTime = Date.now();
    options.logger.log(`Starting ${options.description} cache warmup`);

    try {
      const workspaces = await this.getWorkspacesWithPersons();
      options.logger.log(
        `Found ${workspaces.length} workspaces with test persons`
      );

      if (workspaces.length === 0) {
        options.logger.log('No workspaces found, skipping cache warmup');
        return;
      }

      options.logger.log(
        `Initial memory usage: ${formatMemoryUsage(captureMemoryUsage())}`
      );

      let processedCount = 0;
      for (const workspace of workspaces) {
        await this.warmWorkspaceWithRecovery(
          workspace.workspace_id,
          options
        );
        processedCount += 1;
        if (processedCount % 10 === 0) {
          this.logMemoryProgress(
            processedCount,
            workspaces.length,
            options.logger
          );
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      const finalMemoryUsage = formatMemoryUsage(captureMemoryUsage());
      const completion =
        `Cached ${options.description} for all workspaces in ${duration.toFixed(2)} seconds.`;
      options.logger.log(
        `${completion} Final memory usage: ${finalMemoryUsage}`
      );
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      options.logger.error(
        `Error caching ${options.description} for all workspaces: ${errorMessage}`,
        this.getErrorStack(error)
      );
    }
  }

  private async warmWorkspaceWithRecovery(
    workspaceId: number,
    options: WorkspaceCacheWarmupOptions
  ): Promise<void> {
    options.logger.debug(
      `Caching ${options.description} for workspace ${workspaceId}`
    );

    try {
      await options.warmWorkspace(workspaceId);
      options.logger.debug(
        `Successfully cached ${options.description} for workspace ${workspaceId}`
      );
    } catch (error) {
      if (!this.isMemoryError(error)) {
        const errorMessage = this.getErrorMessage(error);
        options.logger.error(
          `Error caching ${options.description} for workspace ${workspaceId}: ${errorMessage}`,
          this.getErrorStack(error)
        );
        return;
      }

      const memoryUsage = formatMemoryUsage(captureMemoryUsage());
      const errorMessage = this.getErrorMessage(error);
      const memoryError =
        `Memory limit exceeded while caching workspace ${workspaceId}.`;
      options.logger.error(
        `${memoryError} Memory usage: ${memoryUsage}. Error: ${errorMessage}`,
        this.getErrorStack(error)
      );

      if (global.gc) {
        try {
          global.gc();
          options.logger.log(
            `GC triggered after memory error. Retrying workspace ${workspaceId}...`
          );
          options.logger.log(
            `Memory usage after GC: ${formatMemoryUsage(captureMemoryUsage())}`
          );
          await options.warmWorkspace(workspaceId);
          options.logger.log(
            `Successfully recovered and cached workspace ${workspaceId} after GC`
          );
          return;
        } catch (retryError) {
          const retryErrorMessage = this.getErrorMessage(retryError);
          options.logger.error(
            `Retry failed for workspace ${workspaceId} after GC: ${retryErrorMessage}`,
            this.getErrorStack(retryError)
          );
        }
      }

      const skippedWorkspace =
        `Skipping workspace ${workspaceId} due to memory constraints.`;
      options.logger.warn(
        `${skippedWorkspace} Continuing with other workspaces.`
      );
    }
  }

  private logMemoryProgress(
    processedCount: number,
    workspaceCount: number,
    logger: WorkspaceCacheWarmupLogger
  ): void {
    const memoryUsage = captureMemoryUsage();
    const formattedMemoryUsage = formatMemoryUsage(memoryUsage);
    const progress =
      `Processed ${processedCount}/${workspaceCount} workspaces.`;
    logger.log(
      `${progress} Memory usage: ${formattedMemoryUsage}`
    );

    if (isHeapUsageHigh(memoryUsage)) {
      logger.warn(`High memory usage detected: ${formattedMemoryUsage}`);
    }

    if (global.gc) {
      global.gc();
      logger.log(
        `Memory usage after GC: ${formatMemoryUsage(captureMemoryUsage())}`
      );
    }
  }

  private getWorkspacesWithPersons(): Promise<{ workspace_id: number }[]> {
    return this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.workspace_id', 'workspace_id')
      .where('person.consider = :consider', { consider: true })
      .getRawMany();
  }

  private isMemoryError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    const code = typeof error === 'object' && error !== null && 'code' in error ?
      String(error.code) :
      '';
    return message.includes('heap limit') ||
      message.includes('out of memory') ||
      code === 'ERR_OUT_OF_MEMORY';
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }
}
