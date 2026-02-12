import {
  Processor,
  Process
} from '@nestjs/bull';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bull';
import { ResetCodingVersionJobData } from '../job-queue.service';
import { CodingVersionService } from '../../database/services/coding/coding-version.service';

export interface ResetCodingVersionResult {
  affectedResponseCount: number;
  cascadeResetVersions: ('v2' | 'v3')[];
  message: string;
}

@Injectable()
@Processor('reset-coding-version')
export class ResetCodingVersionProcessor {
  private readonly logger = new Logger(ResetCodingVersionProcessor.name);

  constructor(
    private readonly codingVersionService: CodingVersionService
  ) { }

  @Process()
  async process(job: Job<ResetCodingVersionJobData>): Promise<ResetCodingVersionResult> {
    this.logger.log(
      `Processing reset coding version job ${job.id} for workspace ${job.data.workspaceId}, version ${job.data.version}`
    );

    try {
      await job.progress(0);

      const progressCallback = async (progress: number) => {
        await job.progress(progress);
      };

      const result = await this.codingVersionService.resetCodingVersion(
        job.data.workspaceId,
        job.data.version,
        job.data.unitFilters,
        job.data.variableFilters,
        progressCallback
      );

      await job.progress(100);
      this.logger.log(`Reset coding version job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Error processing reset coding version job ${job.id}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
