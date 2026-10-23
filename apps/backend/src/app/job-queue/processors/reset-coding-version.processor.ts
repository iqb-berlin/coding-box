import {
  Processor,
  WorkerHost
} from '@nestjs/bullmq';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bullmq';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import { ResetCodingVersionJobData } from '../job-queue.service';
import { CodingVersionService } from '../../database/services/coding/coding-version.service';

export interface ResetCodingVersionResult {
  affectedResponseCount: number;
  deletedGeneratedResponseCount: number;
  cascadeResetVersions: ('v2' | 'v3')[];
  message: string;
}

@Injectable()
@Processor('reset-coding-version', { concurrency: 1 })
export class ResetCodingVersionProcessor extends WorkerHost {
  private readonly logger = new Logger(ResetCodingVersionProcessor.name);

  constructor(
    private readonly codingVersionService: CodingVersionService
  ) {
    super();
  }

  async process(job: Job<ResetCodingVersionJobData>): Promise<ResetCodingVersionResult> {
    this.logger.log(
      `Processing reset coding version job ${job.id} for workspace ${job.data.workspaceId}, version ${job.data.version}`
    );

    try {
      await job.updateProgress(0);

      const progressCallback = async (progress: number) => {
        await job.updateProgress(progress);
      };

      const result = await this.codingVersionService.resetCodingVersion(
        job.data.workspaceId,
        job.data.version,
        job.data.unitFilters,
        job.data.variableFilters,
        progressCallback,
        { actorUserId: job.data.requestedByUserId, jobId: job.id }
      );

      await job.updateProgress(100);
      this.logger.log(`Reset coding version job ${job.id} completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Error processing reset coding version job ${job.id}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }
}
