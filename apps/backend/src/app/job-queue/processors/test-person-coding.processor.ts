import { Processor, Process } from '@nestjs/bull';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { Job } from 'bull';
import type { QueryRunner } from 'typeorm';
import {
  mkdtemp, readFile, rm, writeFile
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TestPersonCodingJobData } from '../job-queue.service';
import { CodingStatistics } from '../../database/services/shared';
import { WorkspaceCodingService } from '../../database/services/workspace';
import { requireAutoCoderRun } from '../auto-coder-run.util';
import type { AutocoderBatchPlan } from '../../database/services/coding/coding-process.service';

const AUTOCODER_FINALIZATION_ATTEMPTS = 3;
const AUTOCODER_FINALIZATION_RECOVERY_INTERVAL_MS = 60_000;

@Injectable()
@Processor('test-person-coding')
export class TestPersonCodingProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TestPersonCodingProcessor.name);
  private finalizationRecoveryTimer?: ReturnType<typeof setInterval>;
  private finalizationRecoveryRunning = false;

  constructor(
    private readonly workspaceCodingService: WorkspaceCodingService
  ) { }

  onModuleInit(): void {
    this.recoverPendingFinalizations().catch(() => undefined);
    this.finalizationRecoveryTimer = setInterval(
      () => {
        this.recoverPendingFinalizations().catch(() => undefined);
      },
      AUTOCODER_FINALIZATION_RECOVERY_INTERVAL_MS
    );
    this.finalizationRecoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.finalizationRecoveryTimer) {
      clearInterval(this.finalizationRecoveryTimer);
    }
  }

  private async recoverPendingFinalizations(): Promise<void> {
    if (this.finalizationRecoveryRunning) return;
    this.finalizationRecoveryRunning = true;
    try {
      await this.workspaceCodingService.recoverPendingAutocoderFinalizations();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not recover pending autocoder finalizations: ${message}`
      );
    } finally {
      this.finalizationRecoveryRunning = false;
    }
  }

  private normalizePersonIds(personIds: string[]): string[] {
    const normalized = personIds
      .map(personId => String(personId).trim())
      .filter(Boolean)
      .map(personId => {
        const numericId = Number(personId);
        if (!Number.isInteger(numericId) || numericId < 1) {
          throw new Error(`Invalid test person ID "${personId}"`);
        }
        return String(numericId);
      });
    const unique = Array.from(new Set(normalized));
    const removedCount = normalized.length - unique.length;
    if (removedCount > 0) {
      this.logger.warn(
        `Removed ${removedCount} duplicate test person IDs before auto-coding`
      );
    }
    return unique;
  }

  private async storePlan(
    directory: string,
    index: number,
    plan: AutocoderBatchPlan
  ): Promise<string> {
    const filename = join(directory, `batch-${index + 1}.json`);
    await writeFile(filename, JSON.stringify(plan), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    return filename;
  }

  private async loadPlan(filename: string): Promise<AutocoderBatchPlan> {
    return JSON.parse(await readFile(filename, 'utf8')) as AutocoderBatchPlan;
  }

  private async finalizeCommittedJob(
    job: Job<TestPersonCodingJobData>,
    autoCoderRun: number,
    finalizationTaskId: number
  ): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= AUTOCODER_FINALIZATION_ATTEMPTS; attempt++) {
      try {
        await this.workspaceCodingService.finalizeAutocoderPersistence(
          job.data.workspaceId,
          autoCoderRun
        );
        await this.workspaceCodingService.completeAutocoderFinalization(
          finalizationTaskId
        );
        try {
          await job.progress(100);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Auto-coding job ${job.id} committed, but progress could not be set to 100: ${message}`
          );
        }
        return true;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        if (attempt < AUTOCODER_FINALIZATION_ATTEMPTS) {
          this.logger.warn(
            `Auto-coding job ${job.id} committed, but finalization attempt ` +
            `${attempt} failed: ${message}. Retrying cache finalization only.`
          );
        } else {
          this.logger.error(
            `Auto-coding job ${job.id} committed, but finalization failed ` +
            `after ${AUTOCODER_FINALIZATION_ATTEMPTS} attempts: ${message}`,
            stack
          );
        }
      }
    }

    try {
      await this.workspaceCodingService.recordAutocoderFinalizationFailure(
        finalizationTaskId,
        lastError
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto-coding job ${job.id} committed and finalization task ` +
        `${finalizationTaskId} could not record its retry state: ${message}`
      );
    }
    return false;
  }

  private async shouldStopBeforeBatch(
    job: Job<TestPersonCodingJobData>,
    batchNumber: number
  ): Promise<boolean> {
    const currentState = await job.getState();
    if (currentState === 'failed' || currentState === 'paused') {
      this.logger.log(`Job ${job.id} was ${currentState} before processing batch ${batchNumber}`);
      return true;
    }

    let isPausedInLatestJob = false;
    try {
      const latestJob = await job.queue.getJob(job.id);
      isPausedInLatestJob = Boolean(latestJob?.data?.isPaused);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not refresh pause state for job ${job.id} before processing batch ${batchNumber}: ${message}`
      );
    }

    if (job.data.isPaused || isPausedInLatestJob) {
      this.logger.log(`Job ${job.id} was paused before processing batch ${batchNumber}`);
      return true;
    }

    return false;
  }

  @Process()
  async process(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    this.logger.log(`Processing test person coding job ${job.id} for workspace ${job.data.workspaceId}`);

    try {
      const BATCH_SIZE = 50;
      const personIds = this.normalizePersonIds(job.data.personIds);
      const totalPersons = personIds.length;
      const autoCoderRun = requireAutoCoderRun(job.data.autoCoderRun);
      const combinedResult: CodingStatistics = { totalResponses: 0, statusCounts: {} };
      const totalBatches = Math.ceil(totalPersons / BATCH_SIZE);
      const planFiles: string[] = [];
      let committed = false;
      let finalizationTaskId: number | undefined;
      let queryRunner: QueryRunner | undefined;
      let planDirectory: string | undefined;

      await job.progress(0);

      if (personIds.length === 0) {
        await job.progress(100);
        return combinedResult;
      }

      try {
        planDirectory = await mkdtemp(join(tmpdir(), 'coding-box-autocoder-'));
        queryRunner = await this.workspaceCodingService
          .beginAutocoderPersistenceSession(job.data.workspaceId);
        const fileRevision = await this.workspaceCodingService
          .prepareAutocoderPreflight(job.data.workspaceId);
        const preflightContext = this.workspaceCodingService
          .createAutocoderPreflightContext(fileRevision);

        for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
          const batchNumber = (i / BATCH_SIZE) + 1;
          if (await this.shouldStopBeforeBatch(job, batchNumber)) {
            return combinedResult;
          }

          const batchPersonIds = personIds.slice(i, i + BATCH_SIZE);
          this.logger.log(
            `Preflighting batch ${batchNumber} of ${totalBatches} ` +
            `(${batchPersonIds.length} persons)`
          );
          const preflightProgress = async (progress: number) => {
            const completedShare = i / Math.max(totalPersons, 1);
            const currentShare = (progress / 100) *
              (batchPersonIds.length / Math.max(totalPersons, 1));
            await job.progress(Math.min(
              Math.floor((completedShare + currentShare) * 90),
              90
            ));
          };
          const preflight = await this.workspaceCodingService
            .preflightTestPersonsBatch(
              job.data.workspaceId,
              batchPersonIds,
              autoCoderRun,
              job.id.toString(),
              job.data.unitIds,
              job.data.freshnessSourceRevision,
              preflightProgress,
              preflightContext
            );
          if (preflight.plan) {
            planFiles.push(await this.storePlan(
              planDirectory,
              planFiles.length,
              preflight.plan
            ));
          }
          await job.progress(Math.min(
            Math.floor(((i + batchPersonIds.length) /
              Math.max(totalPersons, 1)) * 90),
            90
          ));

          if (await this.shouldStopBeforeBatch(job, batchNumber)) {
            return combinedResult;
          }
        }

        await this.workspaceCodingService.assertAutocoderFileRevision(
          job.data.workspaceId,
          fileRevision
        );
        await this.workspaceCodingService
          .startAutocoderPersistenceTransaction(queryRunner);

        for (let index = 0; index < planFiles.length; index++) {
          const batchNumber = index + 1;
          if (await this.shouldStopBeforeBatch(job, batchNumber)) {
            return { totalResponses: 0, statusCounts: {} };
          }

          this.logger.log(
            `Persisting preflighted batch ${batchNumber} of ${planFiles.length}`
          );
          const persistenceProgress = async (progress: number) => {
            const completedShare = index / Math.max(planFiles.length, 1);
            const currentShare = (progress / 100) /
              Math.max(planFiles.length, 1);
            await job.progress(Math.min(
              90 + Math.floor((completedShare + currentShare) * 9),
              99
            ));
          };
          const plan = await this.loadPlan(planFiles[index]);
          const persisted = await this.workspaceCodingService
            .persistAutocoderBatchPlan(
              plan,
              queryRunner,
              job.id.toString(),
              persistenceProgress
            );
          if (!persisted) {
            return { totalResponses: 0, statusCounts: {} };
          }

          const batchResult = plan.statistics;
          combinedResult.totalResponses += batchResult.totalResponses;
          Object.entries(batchResult.statusCounts).forEach(([status, count]) => {
            combinedResult.statusCounts[status] =
              (combinedResult.statusCounts[status] || 0) + count;
          });
        }

        if (await this.shouldStopBeforeBatch(job, totalBatches + 1)) {
          return { totalResponses: 0, statusCounts: {} };
        }

        await this.workspaceCodingService.assertAutocoderFileRevisionForCommit(
          queryRunner,
          job.data.workspaceId,
          fileRevision
        );
        finalizationTaskId = await this.workspaceCodingService
          .scheduleAutocoderFinalization(
            queryRunner,
            job.data.workspaceId,
            autoCoderRun,
            job.id.toString()
          );
        await this.workspaceCodingService
          .commitAutocoderPersistenceTransaction(queryRunner);
        committed = true;
        const finalized = await this.finalizeCommittedJob(
          job,
          autoCoderRun,
          finalizationTaskId
        );

        this.logger.log(
          finalized ?
            `Job ${job.id} completed successfully` :
            `Job ${job.id} committed with finalization task ` +
              `${finalizationTaskId} still pending`
        );
        return combinedResult;
      } finally {
        if (queryRunner) {
          if (!committed) {
            try {
              await this.workspaceCodingService
                .rollbackAutocoderPersistenceTransaction(queryRunner);
            } catch (error) {
              const message = error instanceof Error ?
                error.message :
                String(error);
              this.logger.error(
                `Could not roll back auto-coding job ${job.id}: ${message}`
              );
            }
          }
          try {
            await this.workspaceCodingService
              .releaseAutocoderPersistenceSession(
                queryRunner,
                job.data.workspaceId
              );
          } catch (error) {
            if (committed) {
              const message = error instanceof Error ?
                error.message :
                String(error);
              this.logger.error(
                `Auto-coding job ${job.id} committed, but its session could not be released: ${message}`
              );
            } else {
              const message = error instanceof Error ?
                error.message :
                String(error);
              this.logger.error(
                `Could not release auto-coding session for job ${job.id}: ${message}`
              );
            }
          }
        }

        if (planDirectory) {
          try {
            await rm(planDirectory, { recursive: true, force: true });
          } catch (error) {
            const message = error instanceof Error ?
              error.message :
              String(error);
            this.logger.warn(
              `Could not remove temporary auto-coding plans for job ${job.id}: ${message}`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error processing job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
