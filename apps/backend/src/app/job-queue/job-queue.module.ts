import { Module, Type, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobQueueClientModule } from './job-queue-client.module';
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
import { CacheClientModule } from '../cache/cache-client.module';
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
    JobQueueClientModule,
    TypeOrmModule.forFeature([ResponseEntity, ValidationTask]),
    forwardRef(() => CodingModule),
    forwardRef(() => WorkspaceModule),
    CacheClientModule
  ],
  providers: [
    ...getEnabledJobQueueProcessors()
  ],
  exports: [JobQueueClientModule]
})
export class JobQueueModule { }
