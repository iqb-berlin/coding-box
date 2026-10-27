import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { JobQueueClientModule } from '../job-queue/job-queue-client.module';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [JobQueueClientModule],
  controllers: [HealthController],
  providers: [ReadinessService]
})
export class HealthModule {}
