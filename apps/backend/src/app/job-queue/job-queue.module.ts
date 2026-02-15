import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobQueueService } from './job-queue.service';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { CodingStatisticsProcessor } from './processors/coding-statistics.processor';
import { ExportJobProcessor } from './processors/export-job.processor';
import { FlatResponseFilterOptionsProcessor } from './processors/flat-response-filter-options.processor';
import { UploadResultsProcessor } from './processors/upload-results.processor';
import { CodebookGenerationProcessor } from './processors/codebook-generation.processor';
import { ResetCodingVersionProcessor } from './processors/reset-coding-version.processor';
import { ValidationTaskProcessor } from './processors/validation-task.processor';
// eslint-disable-next-line import/no-cycle
import { CodingModule } from '../coding/coding.module';
// eslint-disable-next-line import/no-cycle
import { WorkspaceModule } from '../workspace/workspace.module';
import { CacheModule } from '../cache/cache.module';

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
    BullModule.registerQueue({
      name: 'data-export'
    }),
    BullModule.registerQueue({
      name: 'flat-response-filter-options'
    }),
    BullModule.registerQueue({
      name: 'test-results-upload'
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
    forwardRef(() => CodingModule),
    forwardRef(() => WorkspaceModule),
    CacheModule
  ],
  providers: [
    JobQueueService,
    TestPersonCodingProcessor,
    CodingStatisticsProcessor,
    ExportJobProcessor,
    FlatResponseFilterOptionsProcessor,
    UploadResultsProcessor,
    CodebookGenerationProcessor,
    ResetCodingVersionProcessor,
    ValidationTaskProcessor
  ],
  exports: [JobQueueService]
})
export class JobQueueModule { }
