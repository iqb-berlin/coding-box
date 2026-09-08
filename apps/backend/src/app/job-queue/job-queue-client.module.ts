import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobQueueService } from './job-queue.service';
import { JobResultStore, JOB_RESULT_MAX_AGE_SECONDS } from './job-result.store';
import { ValidationTask } from '../database/entities/validation-task.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ValidationTask]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'redis'),
          port: parseInt(configService.get('REDIS_PORT', '6379'), 10)
        },
        prefix: configService.get('REDIS_PREFIX', 'coding-box')
      })
    }),
    BullModule.registerQueue({
      name: 'test-person-coding'
    }),
    BullModule.registerQueue({
      name: 'coding-statistics'
    }),
    BullModule.registerQueue({
      name: 'data-export'
    }),
    BullModule.registerQueue({
      name: 'flat-response-filter-options'
    }),
    BullModule.registerQueue({
      name: 'test-results-upload',
      defaultJobOptions: {
        removeOnComplete: { age: JOB_RESULT_MAX_AGE_SECONDS, count: 100 },
        removeOnFail: { age: 30 * 86400, count: 100 }
      }
    }),
    BullModule.registerQueue({
      name: 'codebook-generation'
    }),
    BullModule.registerQueue({
      name: 'reset-coding-version'
    }),
    BullModule.registerQueue({
      name: 'validation-task'
    }),
    BullModule.registerQueue({
      name: 'response-analysis',
      defaultJobOptions: {
        removeOnComplete: { age: JOB_RESULT_MAX_AGE_SECONDS, count: 100 },
        removeOnFail: { age: 30 * 86400, count: 100 }
      }
    }),
    BullModule.registerQueue({
      name: 'variable-analysis'
    }),
    BullModule.registerQueue({
      name: 'external-coding-import'
    }),
    BullModule.registerQueue({
      name: 'database-export'
    })
  ],
  providers: [JobQueueService, JobResultStore],
  exports: [BullModule, JobQueueService, JobResultStore]
})
export class JobQueueClientModule { }
