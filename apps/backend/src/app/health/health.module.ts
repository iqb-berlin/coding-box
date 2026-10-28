import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { ReadinessController } from './readiness.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [JobQueueModule],
  controllers: [HealthController, ReadinessController],
  providers: [ReadinessService]
})
export class HealthModule {}
