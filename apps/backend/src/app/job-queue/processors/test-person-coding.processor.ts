import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Job } from 'bull';
import { CodingStatistics } from '../../database/services/shared';
import { TestPersonCodingJobData } from '../job-queue.service';
import { AutocoderRunService } from '../autocoder-run.service';

@Injectable()
@Processor('test-person-coding')
export class TestPersonCodingProcessor {
  constructor(private readonly autocoderRunService: AutocoderRunService) {}

  @Process()
  process(job: Job<TestPersonCodingJobData>): Promise<CodingStatistics> {
    return this.autocoderRunService.run(job);
  }
}
