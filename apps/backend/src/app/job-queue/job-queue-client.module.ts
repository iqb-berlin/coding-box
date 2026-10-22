import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobQueueService } from './job-queue.service';
import { createJobQueueOptions, JOB_QUEUE_NAMES } from './job-queue.config';
import { ValidationTask } from '../database/entities/validation-task.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ValidationTask]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createJobQueueOptions
    }),
    BullModule.registerQueue(...JOB_QUEUE_NAMES.map(name => ({ name })))
  ],
  providers: [JobQueueService],
  exports: [BullModule, JobQueueService]
})
export class JobQueueClientModule { }
