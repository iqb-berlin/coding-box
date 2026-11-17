import { Job } from 'bullmq';
import { CodingResetPreviewProcessor } from './coding-reset-preview.processor';
import { CodingResetPreviewService } from '../../database/services/coding/coding-reset-preview.service';
import { ResetCodingPreviewJobData } from '../job-queue.service';

describe('CodingResetPreviewProcessor', () => {
  it('only runs the read-only preview service and returns its counts', async () => {
    const preview = jest.fn().mockResolvedValue({ status: 'valid', affectedResponseCount: 123 });
    const processor = new CodingResetPreviewProcessor({ preview } as unknown as CodingResetPreviewService);
    const scope = { version: 'v1' as const, unitFilters: ['DHB003'], variableFilters: [] };
    const job = { data: { workspaceId: 5, scope }, updateProgress: jest.fn() };
    await expect(processor.processWorkspaceJob(job as unknown as Job<ResetCodingPreviewJobData>))
      .resolves.toMatchObject({ affectedResponseCount: 123 });
    expect(preview).toHaveBeenCalledWith(5, scope);
    expect(job.updateProgress.mock.calls).toEqual([[0], [100]]);
  });
});
