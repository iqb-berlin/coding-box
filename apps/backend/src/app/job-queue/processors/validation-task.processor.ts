import {
  Process,
  Processor
} from '@nestjs/bull';
import {
  Injectable,
  Logger
} from '@nestjs/common';
import { Job } from 'bull';
import {
  ValidationTaskJobData
} from '../job-queue.service';
import { ValidationTaskService } from '../../database/services/validation';

@Injectable()
@Processor('validation-task')
export class ValidationTaskProcessor {
  private readonly logger = new Logger(ValidationTaskProcessor.name);

  constructor(
    private readonly validationTaskService: ValidationTaskService
  ) { }

  @Process()
  async process(job: Job<ValidationTaskJobData>): Promise<void> {
    this.logger.log(`Processing validation task job ${job.id} for task ${job.data.taskId}`);

    try {
      await this.validationTaskService.processValidationTask(job.data.taskId);
      this.logger.log(`Validation task job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(
        `Error processing validation task job ${job.id}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
