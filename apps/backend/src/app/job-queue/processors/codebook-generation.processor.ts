import { Processor, Process } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as path from 'path';
import * as fs from 'fs';
import { CodebookGenerationService } from '../../database/services/coding/codebook-generation.service';
import { CacheService } from '../../cache/cache.service';
import { CodebookGenerationJobData, CodebookJobResult } from '../job-queue.service';

@Injectable()
@Processor('codebook-generation')
export class CodebookGenerationProcessor {
  private readonly logger = new Logger(CodebookGenerationProcessor.name);
  private readonly resultTtlSeconds = 86400;

  constructor(
    private readonly codebookGenerationService: CodebookGenerationService,
    private readonly cacheService: CacheService
  ) {}

  @Process()
  async process(job: Job<CodebookGenerationJobData>): Promise<CodebookJobResult> {
    this.logger.log(
      `Processing codebook generation job ${job.id} for workspace ${job.data.workspaceId}`
    );

    try {
      await job.progress(0);

      const {
        workspaceId, missingsProfile, contentOptions, unitIds
      } = job.data;

      await job.progress(10);

      const codebook = await this.codebookGenerationService.generateCodebook(
        workspaceId,
        missingsProfile,
        contentOptions,
        unitIds
      );

      await job.progress(80);

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

      await job.progress(90);

      const result: CodebookJobResult = {
        fileId: job.id.toString(),
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

      await job.progress(100);
      this.logger.log(`Codebook generation job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Error processing codebook generation job ${job.id}: ${error.message}`,
        error.stack
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
      this.logger.warn(`Failed to clean up expired codebook files: ${error.message}`);
    }
  }
}
