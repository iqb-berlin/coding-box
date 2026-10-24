import {
  Processor
} from '@nestjs/bullmq';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bullmq';
import { WorkspaceWorkerHost } from '../workspace-worker-host';
import { getErrorMessage, getErrorStack } from '../../utils/error.util';
import {
  ValidationTaskJobData
} from '../job-queue.service';
import { ValidationTaskService } from '../../database/services/validation';

@Injectable()
@Processor('validation-task', { concurrency: 1 })
export class ValidationTaskProcessor extends WorkspaceWorkerHost {
  private readonly logger = new Logger(ValidationTaskProcessor.name);

  constructor(
    private readonly validationTaskService: ValidationTaskService
  ) {
    super();
  }

  async processWorkspaceJob(job: Job<ValidationTaskJobData>): Promise<void> {
    this.logger.log(`Processing validation task job ${job.id} for task ${job.data.taskId}`);

    try {
      await this.validationTaskService.processValidationTask(job.data.taskId);
      this.logger.log(`Validation task job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(
        `Error processing validation task job ${job.id}: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      throw error;
    }
  }
}
