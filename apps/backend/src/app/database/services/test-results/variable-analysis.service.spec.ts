import { ConflictException, NotFoundException } from '@nestjs/common';
import { VariableAnalysisService } from './variable-analysis.service';

const createJob = (overrides: Partial<{
  id: string;
  data: { workspaceId: number; unitId?: number; variableId?: string };
  state: string;
  progress: number;
  returnvalue: unknown;
}> = {}) => ({
  id: overrides.id || 'job-1',
  data: overrides.data || { workspaceId: 1, unitId: 2, variableId: 'VAR' },
  getState: jest.fn().mockResolvedValue(overrides.state || 'completed'),
  progress: jest.fn().mockResolvedValue(overrides.progress ?? 100),
  failedReason: undefined,
  timestamp: 1000,
  finishedOn: 2000,
  returnvalue: Object.prototype.hasOwnProperty.call(overrides, 'returnvalue') ? overrides.returnvalue : { rows: [] }
});

describe('VariableAnalysisService', () => {
  let jobQueueService: Record<string, jest.Mock>;
  let service: VariableAnalysisService;

  beforeEach(() => {
    jobQueueService = {
      addVariableAnalysisJob: jest.fn(),
      getVariableAnalysisJob: jest.fn(),
      getVariableAnalysisJobs: jest.fn(),
      deleteVariableAnalysisJob: jest.fn(),
      cancelVariableAnalysisJob: jest.fn(),
      deleteVariableAnalysisJobs: jest.fn()
    };
    service = new VariableAnalysisService(jobQueueService as never);
    jest.spyOn((service as unknown as { logger: { log: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
  });

  it('creates jobs unless one is already active', async () => {
    jest.spyOn(service, 'getAnalysisJobs')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'processing' } as never]);
    jobQueueService.addVariableAnalysisJob.mockResolvedValue({ id: 'job-1' });

    await expect(service.createAnalysisJob(1, 2, 'VAR')).resolves.toMatchObject({
      id: 'job-1',
      workspace_id: 1,
      status: 'pending'
    });
    await expect(service.createAnalysisJob(1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('loads jobs, results and validates workspace ownership', async () => {
    const job = createJob();
    jobQueueService.getVariableAnalysisJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createJob({ data: { workspaceId: 2 } }))
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(createJob({ state: 'active' }))
      .mockResolvedValueOnce(createJob({ returnvalue: null }));

    await expect(service.getAnalysisJob('job-1', 1)).resolves.toMatchObject({
      id: 'job-1',
      workspace_id: 1,
      status: 'completed'
    });
    await expect(service.getAnalysisJob('missing', 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getAnalysisJob('wrong', 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getAnalysisResults('job-1', 1)).resolves.toEqual({ rows: [] });
    await expect(service.getAnalysisResults('active', 1)).rejects.toThrow('is not completed');
    await expect(service.getAnalysisResults('empty', 1)).rejects.toThrow('has no results');
  });

  it('lists, deletes and cancels jobs', async () => {
    jobQueueService.getVariableAnalysisJobs.mockResolvedValue([
      createJob({ id: 'newer', state: 'active' }),
      createJob({ id: 'older', state: 'completed' })
    ]);
    jobQueueService.deleteVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.cancelVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.deleteVariableAnalysisJobs.mockResolvedValue(undefined);

    const jobs = await service.getAnalysisJobs(1);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('processing');
    await expect(service.deleteJob(1, 'job-1')).resolves.toBe(true);
    await expect(service.cancelJob(1, 'job-1')).resolves.toBe(true);
    await expect(service.deleteAllJobs(1)).resolves.toBeUndefined();
  });
});
