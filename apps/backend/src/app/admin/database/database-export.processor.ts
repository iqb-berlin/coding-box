import { WorkerHost, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { requireJobId, rethrowJobError } from '../../job-queue/job-queue.util';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';
import { DatabaseExportService } from './database-export.service';
import { JournalService } from '../../database/services/shared/journal.service';

export interface DatabaseExportJobData {
  requestedByUserId: number;
  scope?: 'system' | 'workspace';
  workspaceId?: number;
  isCancelled?: boolean;
}

export interface DatabaseExportJobResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  createdAt: number;
  requestedByUserId: number;
  scope: 'system' | 'workspace';
  workspaceId?: number;
}

@Injectable()
@Processor('database-export', { concurrency: 1 })
export class DatabaseExportProcessor extends WorkerHost {
  private readonly logger = new Logger(DatabaseExportProcessor.name);

  constructor(private readonly databaseExportService: DatabaseExportService,
              private readonly journalService: JournalService) {
    super();
  }

  private async isJobCancelled(job: Job<DatabaseExportJobData>): Promise<boolean> {
    const latestJob = await Job.fromId<DatabaseExportJobData>(this.worker, requireJobId(job));
    return latestJob?.data?.isCancelled === true;
  }

  async process(job: Job<DatabaseExportJobData>): Promise<DatabaseExportJobResult> {
    this.logger.log(`Starting database export job ${job.id}`);

    let outputFilePath: string | null = null;

    try {
      await job.updateProgress(0);

      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      outputFilePath = path.join(
        tempDir,
        job.data.scope === 'workspace' ?
          `workspace-${job.data.workspaceId}-database-export-${job.id}-${Date.now()}.sqlite` :
          `database-export-${job.id}-${Date.now()}.sqlite`
      );

      if (job.data.scope === 'workspace') {
        if (!job.data.workspaceId) {
          throw new Error('Workspace database export job is missing workspaceId.');
        }

        await this.databaseExportService.exportWorkspaceToSqliteFile(
          outputFilePath,
          job.data.workspaceId,
          async progress => {
            await job.updateProgress(progress);
          },
          async () => this.isJobCancelled(job)
        );
      } else {
        await this.databaseExportService.exportToSqliteFile(
          outputFilePath,
          async progress => {
            await job.updateProgress(progress);
          },
          async () => this.isJobCancelled(job)
        );
      }

      const stats = fs.statSync(outputFilePath);
      const result: DatabaseExportJobResult = {
        filePath: outputFilePath,
        fileName: path.basename(outputFilePath),
        fileSize: stats.size,
        createdAt: Date.now(),
        requestedByUserId: job.data.requestedByUserId,
        scope: job.data.scope || 'system',
        workspaceId: job.data.workspaceId
      };

      await job.updateProgress(100);
      await this.recordOutcome(job, 'success', { fileSize: stats.size });
      this.logger.log(`Database export job ${job.id} completed successfully`);

      return result;
    } catch (error) {
      if (error instanceof DatabaseExportCancelledError) {
        this.logger.warn(`Database export job ${job.id} was cancelled`);
      } else {
        this.logger.error(
          `Database export job ${job.id} failed: ${getErrorMessage(error) || error}`,
          getErrorStack(error)
        );
      }

      if (outputFilePath && fs.existsSync(outputFilePath)) {
        try {
          fs.unlinkSync(outputFilePath);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to clean up export file ${outputFilePath}: ${getErrorMessage(cleanupError) || cleanupError}`,
            getErrorStack(cleanupError)
          );
        }
      }

      await this.recordOutcome(job, 'failure', { cancelled: error instanceof DatabaseExportCancelledError });
      return rethrowJobError(error, job, () => this.worker);
    }
  }

  private async recordOutcome(job: Job<DatabaseExportJobData>, result: 'success' | 'failure', details: Record<string, unknown>): Promise<void> {
    if (job.data.scope !== 'workspace' || !job.data.workspaceId) return;
    await this.journalService.recordEvent({
      workspaceId: job.data.workspaceId,
      actorUserId: job.data.requestedByUserId,
      actorType: 'job',
      eventType: result === 'success' ? 'DATABASE_EXPORT_COMPLETED' : 'DATABASE_EXPORT_FAILED',
      entityType: 'workspace',
      entityId: job.data.workspaceId,
      result,
      summary: result === 'success' ? 'Workspace database export completed' : 'Workspace database export failed',
      jobId: job.id,
      details
    });
  }
}
