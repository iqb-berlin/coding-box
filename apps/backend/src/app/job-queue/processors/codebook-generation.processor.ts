import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { requireJobId } from '../job-queue.util';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { CodebookGenerationService } from '../../database/services/coding/codebook-generation.service';
import { CacheService } from '../../cache/cache.service';
import { CodebookGenerationJobData, CodebookJobResult } from '../job-queue.service';

@Injectable()
@Processor('codebook-generation', { concurrency: 1 })
export class CodebookGenerationProcessor extends WorkspaceWorkerHost {
  private readonly logger = new Logger(CodebookGenerationProcessor.name);
  private readonly resultTtlSeconds = 86400;

  constructor(
    private readonly codebookGenerationService: CodebookGenerationService,
    private readonly cacheService: CacheService
  ) {
    super();
  }

  async processWorkspaceJob(job: Job<CodebookGenerationJobData>): Promise<CodebookJobResult> {
    this.logger.log(
      `Processing codebook generation job ${job.id} for workspace ${job.data.workspaceId}`
    );

    try {
      await job.updateProgress(0);

      const {
        workspaceId, missingsProfile, contentOptions, unitIds
      } = job.data;

      await job.updateProgress(10);

      const codebook = await this.codebookGenerationService.generateCodebook(
        workspaceId,
        missingsProfile,
        contentOptions,
        unitIds
      );

      await job.updateProgress(80);

      if (!codebook) {
        throw new Error('Failed to generate codebook');
      }

      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      this.cleanupExpiredCodebookFiles(tempDir);

      const fileExt = contentOptions.exportFormat.toLowerCase();
      const fileName = `codebook_${job.id}_${Date.now()}.${fileExt}`;
      const filePath = path.join(tempDir, fileName);

      fs.writeFileSync(filePath, codebook);

      await job.updateProgress(90);

      const result: CodebookJobResult = {
        fileId: requireJobId(job),
        fileName,
        filePath,
        fileSize: codebook.length,
        workspaceId,
        exportFormat: contentOptions.exportFormat,
        createdAt: Date.now()
      };

      await this.cacheService.set(
        `codebook-result:${job.id}`,
        result,
        this.resultTtlSeconds
      );

      await job.updateProgress(100);
      this.logger.log(`Codebook generation job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Error processing codebook generation job ${job.id}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }

  private cleanupExpiredCodebookFiles(tempDir: string): void {
    try {
      const expiresBefore = Date.now() - this.resultTtlSeconds * 1000;
      fs.readdirSync(tempDir)
        .filter(fileName => /^codebook_.+\.(docx|json)$/i.test(fileName))
        .forEach(fileName => {
          const filePath = path.join(tempDir, fileName);
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < expiresBefore) {
            fs.unlinkSync(filePath);
          }
        });
    } catch (error) {
      this.logger.warn(`Failed to clean up expired codebook files: ${getErrorMessage(error)}`);
    }
  }
}
