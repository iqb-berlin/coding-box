import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CodingFreshnessService } from '../database/services/coding';

@Injectable()
export class CodingStatusRevisionRecoverySchedulerService implements OnModuleInit {
  private readonly logger =
    new Logger(CodingStatusRevisionRecoverySchedulerService.name);

  private recoveryInFlight: Promise<void> | null = null;

  constructor(
    private readonly codingFreshnessService: CodingFreshnessService
  ) {}

  onModuleInit(): void {
    this.recoverWorkspaceRevisionFailures()
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Unexpected coding status revision recovery error: ${message}`
        );
      });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async recoverWorkspaceRevisionFailures(): Promise<void> {
    if (this.recoveryInFlight) {
      await this.recoveryInFlight;
      return;
    }

    const recovery = this.runRecovery();
    this.recoveryInFlight = recovery;
    try {
      await recovery;
    } finally {
      if (this.recoveryInFlight === recovery) {
        this.recoveryInFlight = null;
      }
    }
  }

  private async runRecovery(): Promise<void> {
    try {
      const recoveredWorkspaceCount = await this.codingFreshnessService
        .reconcileRecoverableWorkspaceRevisionFailures();
      if (recoveredWorkspaceCount > 0) {
        this.logger.warn(
          `Recovered coding status revisions for ${recoveredWorkspaceCount} workspace(s).`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not recover coding status revisions: ${message}`
      );
    }
  }
}
