import { ConfigService } from '@nestjs/config';
import { BullRootModuleOptions } from '@nestjs/bullmq';

export const JOB_QUEUE_NAMES = [
  'test-person-coding',
  'coding-statistics',
  'data-export',
  'flat-response-filter-options',
  'test-results-upload',
  'codebook-generation',
  'reset-coding-version',
  'validation-task',
  'response-analysis',
  'variable-analysis',
  'external-coding-import',
  'database-export'
] as const;

export function createJobQueueOptions(config: ConfigService): BullRootModuleOptions {
  return {
    connection: {
      host: config.get<string>('REDIS_HOST', 'redis'),
      port: Number(config.get<string>('REDIS_PORT', '6379'))
    },
    // Bull and BullMQ have incompatible Redis formats. Never reuse Bull's keys.
    prefix: `${config.get<string>('REDIS_PREFIX', 'coding-box')}:bullmq`
  };
}
