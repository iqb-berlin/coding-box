import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseExportCancelledError } from './database-export-cancelled.error';
import { DatabaseExportService } from './database-export.service';

export interface DatabaseExportJobData {
  requestedByUserId: number;
  isCancelled?: boolean;
}

export interface DatabaseExportJobResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  createdAt: number;
  requestedByUserId: number;
}

@Injectable()
@Processor('database-export')
export class DatabaseExportProcessor {
  private readonly logger = new Logger(DatabaseExportProcessor.name);

  constructor(private readonly databaseExportService: DatabaseExportService) {}

  private async isJobCancelled(job: Job<DatabaseExportJobData>): Promise<boolean> {
    const latestJob = await job.queue.getJob(String(job.id));
    return latestJob?.data?.isCancelled === true;
  }

  @Process()
  async process(job: Job<DatabaseExportJobData>): Promise<DatabaseExportJobResult> {
    this.logger.log(`Starting database export job ${job.id}`);

    let outputFilePath: string | null = null;

    try {
      await job.progress(0);

      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      outputFilePath = path.join(
        tempDir,
        `database-export-${job.id}-${Date.now()}.sqlite`
      );

      await this.databaseExportService.exportToSqliteFile(
        outputFilePath,
        async progress => {
          await job.progress(progress);
        },
        async () => this.isJobCancelled(job)
      );

      const stats = fs.statSync(outputFilePath);
      const result: DatabaseExportJobResult = {
        filePath: outputFilePath,
        fileName: path.basename(outputFilePath),
        fileSize: stats.size,
        createdAt: Date.now(),
        requestedByUserId: job.data.requestedByUserId
      };

      await job.progress(100);
      this.logger.log(`Database export job ${job.id} completed successfully`);

      return result;
    } catch (error) {
      if (error instanceof DatabaseExportCancelledError) {
        this.logger.warn(`Database export job ${job.id} was cancelled`);
      } else {
        this.logger.error(
          `Database export job ${job.id} failed: ${error?.message || error}`,
          error?.stack
        );
      }

      if (outputFilePath && fs.existsSync(outputFilePath)) {
        try {
          fs.unlinkSync(outputFilePath);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to clean up export file ${outputFilePath}: ${cleanupError?.message || cleanupError}`,
            cleanupError?.stack
          );
        }
      }

      throw error;
    }
  }
}
