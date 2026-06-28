import { Module, Type, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobQueueService } from './job-queue.service';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { CodingStatisticsProcessor } from './processors/coding-statistics.processor';
import { ExportJobProcessor } from './processors/export-job.processor';
import { FlatResponseFilterOptionsProcessor } from './processors/flat-response-filter-options.processor';
import { UploadResultsProcessor } from './processors/upload-results.processor';
import { CodebookGenerationProcessor } from './processors/codebook-generation.processor';
import { ResetCodingVersionProcessor } from './processors/reset-coding-version.processor';
import { ValidationTaskProcessor } from './processors/validation-task.processor';
import { CodingAnalysisProcessor } from './processors/coding-analysis.processor';
import { VariableAnalysisProcessor } from './processors/variable-analysis.processor';
import { ExternalCodingImportProcessor } from './processors/external-coding-import.processor';
import { getEnabledProcessorNames } from './job-queue-processor-selection';
// eslint-disable-next-line import/no-cycle
import { CodingModule } from '../coding/coding.module';
// eslint-disable-next-line import/no-cycle
import { WorkspaceModule } from '../workspace/workspace.module';
import { CacheModule } from '../cache/cache.module';
import { ResponseEntity } from '../database/entities/response.entity';
import { ValidationTask } from '../database/entities/validation-task.entity';

const processorProviders = {
  'test-person-coding': TestPersonCodingProcessor,
  'coding-statistics': CodingStatisticsProcessor,
  'data-export': ExportJobProcessor,
  'flat-response-filter-options': FlatResponseFilterOptionsProcessor,
  'test-results-upload': UploadResultsProcessor,
  'codebook-generation': CodebookGenerationProcessor,
  'reset-coding-version': ResetCodingVersionProcessor,
  'validation-task': ValidationTaskProcessor,
  'response-analysis': CodingAnalysisProcessor,
  'variable-analysis': VariableAnalysisProcessor,
  'external-coding-import': ExternalCodingImportProcessor
} satisfies Record<string, Type<unknown>>;

type JobQueueProcessorName = keyof typeof processorProviders;

export function getEnabledJobQueueProcessors(
  enabledValue = process.env.JOB_QUEUE_PROCESSORS,
  disabledValue = process.env.DISABLED_JOB_QUEUE_PROCESSORS
): Type<unknown>[] {
  const allProcessorNames = Object.keys(processorProviders) as JobQueueProcessorName[];

  return getEnabledProcessorNames(allProcessorNames, enabledValue, disabledValue)
    .map(name => processorProviders[name]);
}

@Module({
  imports: [
    TypeOrmModule.forFeature([ResponseEntity, ValidationTask]),
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
    BullModule.registerQueue({
      name: 'response-analysis'
    }),
    BullModule.registerQueue({
      name: 'variable-analysis'
    }),
    BullModule.registerQueue({
      name: 'external-coding-import'
    }),
    BullModule.registerQueue({
      name: 'database-export'
    }),
    forwardRef(() => CodingModule),
    forwardRef(() => WorkspaceModule),
    CacheModule
  ],
  providers: [
    JobQueueService,
    ...getEnabledJobQueueProcessors()
  ],
  exports: [JobQueueService]
})
export class JobQueueModule { }
