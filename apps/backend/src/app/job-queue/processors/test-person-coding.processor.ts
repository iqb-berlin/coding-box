import { WorkerHost, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { rethrowJobError } from '../job-queue.util';
import { CodingStatistics } from '../../database/services/shared';
import { TestPersonCodingJobData } from '../job-queue.service';
import { AutocoderRunService } from '../autocoder-run.service';

@Injectable()
@Processor('test-person-coding', { concurrency: 1 })
export class TestPersonCodingProcessor extends WorkerHost {
  constructor(private readonly autocoderRunService: AutocoderRunService) {
    super();
  }

  async process(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    try {
      return await this.autocoderRunService.run(job);
    } catch (error) {
      return rethrowJobError(error, job, () => this.worker);
    }
  }
}
