import { ConflictException, NotFoundException } from '@nestjs/common';
import { VariableAnalysisService } from './variable-analysis.service';

const createJob = (
  overrides: Partial<{
    id: string;
    data: {
      workspaceId: number;
      unitId?: number;
      variableId?: string;
      cacheKey?: string;
    };
    state: string;
    progress: number;
    returnvalue: unknown;
  }> = {}
) => ({
  id: overrides.id || 'job-1',
  data: overrides.data || {
    workspaceId: 1,
    unitId: 2,
    variableId: 'VAR',
    cacheKey: 'variable-analysis:1:job-1'
  },
  getState: jest.fn().mockResolvedValue(overrides.state || 'completed'),
  progress: jest.fn().mockResolvedValue(overrides.progress ?? 100),
  failedReason: undefined,
  timestamp: 1000,
  finishedOn: 2000,
  returnvalue: Object.prototype.hasOwnProperty.call(overrides, 'returnvalue') ?
    overrides.returnvalue :
    {
      cacheKey: 'variable-analysis:1:job-1',
      workspaceId: 1,
      total: 1,
      storedAt: '2026-05-26T00:00:00.000Z'
    }
});

describe('VariableAnalysisService', () => {
  let jobQueueService: Record<string, jest.Mock>;
  let cacheService: Record<string, jest.Mock>;
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
    cacheService = {
      get: jest.fn(),
      delete: jest.fn()
    };
    service = new VariableAnalysisService(
      jobQueueService as never,
      cacheService as never
    );
    jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log'
      )
      .mockImplementation(jest.fn());
  });

  it('creates jobs unless one is already active', async () => {
    jest
      .spyOn(service, 'getAnalysisJobs')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'processing' } as never]);
    jobQueueService.addVariableAnalysisJob.mockResolvedValue({ id: 'job-1' });

    await expect(service.createAnalysisJob(1, 2, 'VAR')).resolves.toMatchObject(
      {
        id: 'job-1',
        workspace_id: 1,
        status: 'pending'
      }
    );
    expect(jobQueueService.addVariableAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringMatching(
          /^variable-analysis:1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
      })
    );
    await expect(service.createAnalysisJob(1)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('loads jobs, results and validates workspace ownership', async () => {
    const cachedResult = {
      variableCombos: [],
      frequencies: {},
      total: 0
    };
    const job = createJob();
    cacheService.get
      .mockResolvedValueOnce(cachedResult)
      .mockResolvedValueOnce(null);
    jobQueueService.getVariableAnalysisJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createJob({ data: { workspaceId: 2 } }))
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(createJob({ state: 'active' }))
      .mockResolvedValueOnce(createJob());

    await expect(service.getAnalysisJob('job-1', 1)).resolves.toMatchObject({
      id: 'job-1',
      workspace_id: 1,
      status: 'completed'
    });
    await expect(service.getAnalysisJob('missing', 1)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.getAnalysisJob('wrong', 1)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.getAnalysisResults('job-1', 1)).resolves.toEqual(
      cachedResult
    );
    expect(cacheService.get).toHaveBeenCalledWith('variable-analysis:1:job-1');
    await expect(service.getAnalysisResults('active', 1)).rejects.toThrow(
      'is not completed'
    );
    await expect(service.getAnalysisResults('empty', 1)).rejects.toThrow(
      'has no cached results'
    );
  });

  it('rejects full result loading for chunked cached results', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: {
          cacheKey: 'variable-analysis:1:job-1',
          workspaceId: 1,
          total: 1,
          storage: 'chunked',
          variableComboChunks: 1,
          frequencyChunks: 1,
          storedAt: '2026-05-26T00:00:00.000Z'
        }
      })
    );
    cacheService.get
      .mockResolvedValueOnce({
        storage: 'chunked',
        workspaceId: 1,
        total: 1,
        variableComboChunks: 1,
        frequencyChunks: 1,
        storedAt: '2026-05-26T00:00:00.000Z'
      });

    await expect(service.getAnalysisResults('job-1', 1)).rejects.toThrow(
      'stored in chunks'
    );
  });

  it('returns one filtered page from chunked cached results', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(
      createJob({
        returnvalue: {
          cacheKey: 'variable-analysis:1:job-1',
          workspaceId: 1,
          total: 3,
          storage: 'chunked',
          variableComboChunks: 1,
          frequencyChunks: 1,
          storedAt: '2026-05-26T00:00:00.000Z'
        }
      })
    );
    cacheService.get
      .mockResolvedValueOnce({
        storage: 'chunked',
        workspaceId: 1,
        total: 3,
        variableComboChunks: 1,
        frequencyChunks: 1,
        storedAt: '2026-05-26T00:00:00.000Z'
      })
      .mockResolvedValueOnce([
        {
          unitId: 1,
          unitName: 'UNIT_A',
          variableId: 'VAR_EMPTY',
          totalCount: 10,
          emptyCount: 2,
          emptyPercentage: 20,
          distinctValueCount: 2,
          statusCounts: []
        },
        {
          unitId: 2,
          unitName: 'UNIT_B',
          variableId: 'VAR_FULL',
          totalCount: 10,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 1,
          statusCounts: []
        },
        {
          unitId: 3,
          unitName: 'OTHER',
          variableId: 'VAR_EMPTY_2',
          totalCount: 10,
          emptyCount: 1,
          emptyPercentage: 10,
          distinctValueCount: 2,
          statusCounts: []
        }
      ])
      .mockResolvedValueOnce([
        [
          '1:VAR_EMPTY',
          [
            {
              unitId: 1,
              unitName: 'UNIT_A',
              variableId: 'VAR_EMPTY',
              value: '',
              count: 2,
              percentage: 20
            }
          ]
        ],
        [
          '2:VAR_FULL',
          [
            {
              unitId: 2,
              unitName: 'UNIT_B',
              variableId: 'VAR_FULL',
              value: 'x',
              count: 10,
              percentage: 100
            }
          ]
        ],
        [
          '3:VAR_EMPTY_2',
          [
            {
              unitId: 3,
              unitName: 'OTHER',
              variableId: 'VAR_EMPTY_2',
              value: '',
              count: 1,
              percentage: 10
            }
          ]
        ]
      ]);

    await expect(
      service.getAnalysisResultsPage('job-1', 1, {
        page: 1,
        pageSize: 1,
        search: 'UNIT',
        onlyEmpty: true
      })
    ).resolves.toEqual({
      variableCombos: [expect.objectContaining({ unitName: 'UNIT_A' })],
      frequencies: {
        '1:VAR_EMPTY': [expect.objectContaining({ value: '' })]
      },
      total: 1,
      unfilteredTotal: 3,
      page: 1,
      pageSize: 1,
      totalPages: 1
    });
  });

  it('lists, deletes and cancels jobs', async () => {
    jobQueueService.getVariableAnalysisJobs.mockResolvedValue([
      createJob({ id: 'newer', state: 'active' }),
      createJob({ id: 'older', state: 'completed' })
    ]);
    jobQueueService.getVariableAnalysisJob.mockResolvedValue(createJob());
    jobQueueService.deleteVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.cancelVariableAnalysisJob.mockResolvedValue(true);
    jobQueueService.deleteVariableAnalysisJobs.mockResolvedValue(undefined);

    const jobs = await service.getAnalysisJobs(1);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('processing');
    await expect(service.deleteJob(1, 'job-1')).resolves.toBe(true);
    expect(cacheService.delete).toHaveBeenCalledWith(
      'variable-analysis:1:job-1'
    );
    await expect(service.cancelJob(1, 'job-1')).resolves.toBe(true);
    await expect(service.deleteAllJobs(1)).resolves.toBeUndefined();
  });
});
