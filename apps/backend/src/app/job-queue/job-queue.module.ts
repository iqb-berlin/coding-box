import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobQueueService } from './job-queue.service';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { CodingStatisticsProcessor } from './processors/coding-statistics.processor';
// eslint-disable-next-line import/no-cycle
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
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
    forwardRef(() => DatabaseModule)
  ],
  providers: [JobQueueService, TestPersonCodingProcessor, CodingStatisticsProcessor],
  exports: [JobQueueService]
})
export class JobQueueModule {}
