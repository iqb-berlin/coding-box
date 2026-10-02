import { Job } from 'bull';
import { AutocoderRunService } from '../autocoder-run.service';
import { TestPersonCodingJobData } from '../job-queue.service';
import { TestPersonCodingProcessor } from './test-person-coding.processor';

describe('TestPersonCodingProcessor', () => {
  it('delegates the job to the autocoder run service', async () => {
    const statistics = { totalResponses: 1, statusCounts: { CODED: 1 } };
    const runService = { run: jest.fn().mockResolvedValue(statistics) };
    const processor = new TestPersonCodingProcessor(
      runService as unknown as AutocoderRunService
    );
    const job = { id: 'job-1' } as Job<TestPersonCodingJobData>;

    await expect(processor.process(job)).resolves.toBe(statistics);
    expect(runService.run).toHaveBeenCalledWith(job);
  });
});
