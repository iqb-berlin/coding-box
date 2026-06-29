import { ExportJobProcessor } from './processors/export-job.processor';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { getEnabledJobQueueProcessors } from './job-queue.module';

describe('JobQueueModule processor selection', () => {
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
