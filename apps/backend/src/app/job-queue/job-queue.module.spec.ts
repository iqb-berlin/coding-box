import { WorkerHost } from '@nestjs/bullmq';
import { WorkspaceWorkerHost } from './workspace-worker-host';
import { ExportJobProcessor } from './processors/export-job.processor';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { getEnabledJobQueueProcessors } from './job-queue.module';
import { DatabaseExportProcessor } from '../admin/database/database-export.processor';

describe('JobQueueModule processor selection', () => {
  it('registers every processor, including database exports, as a BullMQ worker host', () => {
    const processors = [...getEnabledJobQueueProcessors('all', undefined), DatabaseExportProcessor];
    expect(processors).toHaveLength(12);
    processors.forEach(processor => {
      expect(processor.prototype).toBeInstanceOf(WorkerHost);
      expect(processor.prototype).toBeInstanceOf(WorkspaceWorkerHost);
    });
  });
  it('enables all processors by default', () => {
    const processors = getEnabledJobQueueProcessors(undefined, undefined);

    expect(processors).toContain(ExportJobProcessor);
    expect(processors).toContain(TestPersonCodingProcessor);
  });

  it('can isolate the data export processor for a dedicated worker', () => {
    expect(getEnabledJobQueueProcessors('data-export', undefined)).toEqual([
      ExportJobProcessor
    ]);
  });

  it('can remove the data export processor from the API backend', () => {
    const processors = getEnabledJobQueueProcessors('all', 'data-export');

    expect(processors).not.toContain(ExportJobProcessor);
    expect(processors).toContain(TestPersonCodingProcessor);
  });

  it('can disable every processor for queue-client-only processes', () => {
    expect(getEnabledJobQueueProcessors('none', undefined)).toEqual([]);
  });
});
