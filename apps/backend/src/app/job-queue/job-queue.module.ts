import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobQueueService } from './job-queue.service';

/**
 * JobQueueModule - Generic Infrastructure Module for Bull Queues
 *
 * This module configures the Bull/Redis connection but does not
 * register specific queues. Feature modules should register their
 * own queues using BullModule.registerQueue().
 */
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
    })
  ],
  providers: [
    JobQueueService
  ],
  exports: [
    JobQueueService,
    BullModule // Export BullModule so other modules can use registerQueue
  ]
})
export class JobQueueModule {}
