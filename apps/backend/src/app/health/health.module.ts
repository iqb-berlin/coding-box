import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { JobQueueModule } from '../job-queue/job-queue.module';

@Module({
  imports: [JobQueueModule],
  controllers: [HealthController]
})
export class HealthModule {}
