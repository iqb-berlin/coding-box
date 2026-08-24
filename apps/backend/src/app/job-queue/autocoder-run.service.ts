import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import type { QueryRunner } from 'typeorm';
import {
  AutocoderBatchPlan,
  CodingProcessService
} from '../database/services/coding/coding-process.service';
import { CodingStatistics } from '../database/services/shared';
import { WorkspaceCodingService } from '../database/services/workspace';
import { requireAutoCoderRun } from './auto-coder-run.util';
import { TestPersonCodingJobData } from './job-queue.service';

const BATCH_SIZE = 50;
const FINALIZATION_ATTEMPTS = 3;
const FINALIZATION_RETRY_DELAY_MS = 250;
const MAX_PLANNED_RESPONSES = 250_000;

@Injectable()
export class AutocoderRunService {
  private readonly logger = new Logger(AutocoderRunService.name);

  constructor(
    private readonly codingProcessService: CodingProcessService,
    private readonly workspaceCodingService: WorkspaceCodingService
  ) {}

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

  private async shouldStopBeforeBatch(
    job: Job<TestPersonCodingJobData>,
    batchNumber: number
  ): Promise<boolean> {
    const currentState = await job.getState();
    if (currentState === 'failed' || currentState === 'paused') {
      this.logger.log(
        `Job ${job.id} was ${currentState} before processing batch ${batchNumber}`
      );
      return true;
    }

    let isPausedInLatestJob = false;
    try {
      const latestJob = await job.queue.getJob(job.id);
      isPausedInLatestJob = Boolean(latestJob?.data?.isPaused);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not refresh pause state for job ${job.id} before processing ` +
          `batch ${batchNumber}: ${message}`
      );
    }

    if (job.data.isPaused || isPausedInLatestJob) {
      this.logger.log(
        `Job ${job.id} was paused before processing batch ${batchNumber}`
      );
      return true;
    }

    return false;
  }

  private async finalizeCommittedJob(
    job: Job<TestPersonCodingJobData>
  ): Promise<string | undefined> {
    let finalizationWarning: string | undefined;
    for (let attempt = 1; attempt <= FINALIZATION_ATTEMPTS; attempt++) {
      try {
        await this.workspaceCodingService.finalizeAutocoderPersistence(
          job.data.workspaceId
        );
        finalizationWarning = undefined;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        if (attempt < FINALIZATION_ATTEMPTS) {
          const retryDelay = FINALIZATION_RETRY_DELAY_MS * 2 ** (attempt - 1);
          this.logger.warn(
            `Auto-coding job ${job.id} committed, but finalization attempt ` +
              `${attempt} failed: ${message}. Retrying cache finalization in ` +
              `${retryDelay} ms.`
          );
          await new Promise(resolve => {
            setTimeout(resolve, retryDelay);
          });
        } else {
          finalizationWarning =
            'Autocoder cache finalization remained incomplete after ' +
            `${FINALIZATION_ATTEMPTS} attempts: ${message}`;
          this.logger.error(
            `Auto-coding job ${job.id} committed, but finalization failed ` +
              `after ${FINALIZATION_ATTEMPTS} attempts: ${message}`,
            stack
          );
        }
      }
    }

    try {
      await job.progress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Auto-coding job ${job.id} committed, but progress could not be set ` +
          `to 100: ${message}`
      );
    }
    return finalizationWarning;
  }

  async run(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    this.logger.log(
      `Processing test person coding job ${job.id} for workspace ` +
        `${job.data.workspaceId}`
    );

    const personIds = this.normalizePersonIds(job.data.personIds);
    const autoCoderRun = requireAutoCoderRun(job.data.autoCoderRun);
    const combinedResult: CodingStatistics = {
      totalResponses: 0,
      statusCounts: {}
    };

    await job.progress(0);
    if (personIds.length === 0) {
      await job.progress(100);
      return combinedResult;
    }

    const totalPersons = personIds.length;
    const totalBatches = Math.ceil(totalPersons / BATCH_SIZE);
    const plans: AutocoderBatchPlan[] = [];
    let plannedResponses = 0;
    let queryRunner: QueryRunner | undefined;
    let committed = false;

    try {
      queryRunner =
        await this.codingProcessService.beginAutocoderPersistenceSession(
          job.data.workspaceId
        );
      this.codingProcessService.prepareAutocoderPreflight(job.data.workspaceId);
      const preflightContext =
        this.codingProcessService.createAutocoderPreflightContext();

      for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
        const batchNumber = i / BATCH_SIZE + 1;
        if (await this.shouldStopBeforeBatch(job, batchNumber)) {
          return combinedResult;
        }

        const batchPersonIds = personIds.slice(i, i + BATCH_SIZE);
        this.logger.log(
          `Preflighting batch ${batchNumber} of ${totalBatches} ` +
            `(${batchPersonIds.length} persons)`
        );
        const preflightProgress = async (progress: number) => {
          const completedShare = i / totalPersons;
          const currentShare =
            (progress / 100) * (batchPersonIds.length / totalPersons);
          await job.progress(
            Math.min(Math.floor((completedShare + currentShare) * 90), 90)
          );
        };
        const plan = await this.codingProcessService.prepareAutocoderBatch(
          job.data.workspaceId,
          batchPersonIds,
          autoCoderRun,
          preflightProgress,
          job.id.toString(),
          job.data.unitIds,
          job.data.freshnessSourceRevision,
          preflightContext,
          MAX_PLANNED_RESPONSES - plannedResponses
        );
        if (plan) {
          plannedResponses += plan.codedResponses.length;
          if (plannedResponses > MAX_PLANNED_RESPONSES) {
            throw new Error(
              `Auto-coding preflight produced ${plannedResponses} planned ` +
              'responses, exceeding the safe in-memory limit of ' +
              `${MAX_PLANNED_RESPONSES}. Split the run into a smaller scope.`
            );
          }
          plans.push(plan);
        }
        await job.progress(
          Math.min(
            Math.floor(((i + batchPersonIds.length) / totalPersons) * 90),
            90
          )
        );

        if (await this.shouldStopBeforeBatch(job, batchNumber)) {
          return combinedResult;
        }
      }

      this.logger.log(
        `Preflight completed with ${plannedResponses} planned responses in ` +
          `${plans.length} batches`
      );
      await queryRunner.startTransaction('READ COMMITTED');

      for (let index = 0; index < plans.length; index++) {
        const batchNumber = index + 1;
        if (await this.shouldStopBeforeBatch(job, batchNumber)) {
          return { totalResponses: 0, statusCounts: {} };
        }

        this.logger.log(
          `Persisting preflighted batch ${batchNumber} of ${plans.length}`
        );
        const persistenceProgress = async (progress: number) => {
          const completedShare = index / Math.max(plans.length, 1);
          const currentShare = progress / 100 / Math.max(plans.length, 1);
          await job.progress(
            Math.min(90 + Math.floor((completedShare + currentShare) * 9), 99)
          );
        };
        const plan = plans[index];
        const persisted =
          await this.codingProcessService.persistAutocoderBatchPlan(
            plan,
            queryRunner,
            job.id.toString(),
            persistenceProgress
          );
        if (!persisted) {
          return { totalResponses: 0, statusCounts: {} };
        }

        combinedResult.totalResponses += plan.statistics.totalResponses;
        Object.entries(plan.statistics.statusCounts).forEach(
          ([status, count]) => {
            combinedResult.statusCounts[status] =
              (combinedResult.statusCounts[status] || 0) + count;
          }
        );
      }

      if (await this.shouldStopBeforeBatch(job, totalBatches + 1)) {
        return { totalResponses: 0, statusCounts: {} };
      }

      await queryRunner.commitTransaction();
      committed = true;
      const finalizationWarning = await this.finalizeCommittedJob(job);
      if (finalizationWarning) {
        combinedResult.warnings = [
          ...(combinedResult.warnings || []),
          finalizationWarning
        ];
      }
      this.logger.log(`Job ${job.id} completed successfully`);
      return combinedResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error processing job ${job.id}: ${message}`, stack);
      throw error;
    } finally {
      if (queryRunner) {
        if (!committed && queryRunner.isTransactionActive) {
          try {
            await queryRunner.rollbackTransaction();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Could not roll back auto-coding job ${job.id}: ${message}`
            );
          }
        }
        try {
          await this.codingProcessService.releaseAutocoderPersistenceSession(
            queryRunner,
            job.data.workspaceId
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Could not release auto-coding session for job ${job.id}: ${message}`
          );
        }
      }
    }
  }
}
