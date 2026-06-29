import { Job } from 'bull';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceExclusionService, WorkspaceFilesService } from '../../database/services/workspace';
import { CodingAnalysisJobData } from '../job-queue.service';
import { CodingAnalysisProcessor } from './coding-analysis.processor';

describe('CodingAnalysisProcessor', () => {
  function createProcessor(cacheService: Partial<CacheService>) {
    const processor = new CodingAnalysisProcessor(
      {} as never,
      cacheService as CacheService,
      {} as WorkspaceExclusionService,
      {} as WorkspaceFilesService,
      { getCodingIncompleteVariables: jest.fn() } as never
    );
    const analysis: ResponseAnalysisDto = {
      emptyResponses: {
        total: 0,
        totalUncoded: 0,
        items: []
      },
      duplicateValues: {
        total: 0,
        totalResponses: 0,
        groups: [],
        isAggregationApplied: false
      },
      aggregationSummary: {
        duplicateGroups: 0,
        duplicateResponses: 0,
        collapsedCases: 0,
        rawCases: 0,
        effectiveCases: 0,
        threshold: 2,
        aggregationActive: true
      },
      matchingFlags: [],
      analysisTimestamp: '2026-05-22T00:00:00.000Z'
    };

    (processor as unknown as {
      computeResponseAnalysis: jest.Mock<Promise<ResponseAnalysisDto>, [
        number,
        string[],
        number,
        Job<CodingAnalysisJobData>
      ]>;
    }).computeResponseAnalysis = jest.fn().mockResolvedValue(analysis);

    return {
      processor,
      analysis
    };
  }

  function createJob(runId: string): Job<CodingAnalysisJobData> {
    return {
      id: 'analysis-job-1',
      data: {
        workspaceId: 7,
        matchingFlags: [],
        threshold: 2,
        cacheKey: 'response-analysis:7__t2',
        runId
      }
    } as unknown as Job<CodingAnalysisJobData>;
  }

  it('does not cache stale analysis results superseded by a newer run', async () => {
    const cacheService = {
      get: jest.fn().mockResolvedValue('newer-run'),
      set: jest.fn().mockResolvedValue(true)
    };
    const { processor } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('old-run'))).resolves.toMatchObject({
      cacheKey: 'response-analysis:7__t2',
      status: 'stale-skip',
      workspaceId: 7
    });

    expect(cacheService.get).toHaveBeenCalledWith('response-analysis:7__t2:run');
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('caches lightweight analysis pages for the latest marked run', async () => {
    const cacheService = {
      get: jest.fn().mockResolvedValue('current-run'),
      set: jest.fn().mockResolvedValue(true)
    };
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('current-run'))).resolves.toMatchObject({
      cacheKey: 'response-analysis:7__t2',
      status: 'cached',
      workspaceId: 7
    });

    expect(cacheService.set).not.toHaveBeenCalledWith(
      'response-analysis:7__t2',
      analysis
    );
    expect(cacheService.set.mock.calls[0][0]).toBe(
      'response-analysis:7__t2:summary'
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'response-analysis:7__t2:empty-chunk:0',
      expect.objectContaining({ chunkIndex: 0 })
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'response-analysis:7__t2:duplicate-chunk:0',
      expect.objectContaining({ chunkIndex: 0 })
    );
  });

  it('normalizes manual analysis variable keys for query filters', async () => {
    const codingValidationService = {
      getCodingIncompleteVariables: jest.fn().mockResolvedValue([
        { unitName: ' unit-a.XML ', variableId: 'var1' },
        { unitName: 'UNIT-A', variableId: 'var1' },
        { unitName: 'unit-b', variableId: ' var2 ' },
        { unitName: '', variableId: 'ignored' },
        { unitName: 'unit-c', variableId: '' }
      ])
    };
    const processor = new CodingAnalysisProcessor(
      {} as never,
      {} as CacheService,
      {} as WorkspaceExclusionService,
      {} as WorkspaceFilesService,
      codingValidationService as never
    );

    const variables = await (processor as unknown as {
      getManualAnalysisVariables: (workspaceId: number) => Promise<
      { unitName: string; variableId: string }[]
      >;
    }).getManualAnalysisVariables(7);

    expect(codingValidationService.getCodingIncompleteVariables)
      .toHaveBeenCalledWith(7);
    expect(variables).toEqual([
      { unitName: 'UNIT-A', variableId: 'var1' },
      { unitName: 'UNIT-B', variableId: 'var2' }
    ]);
  });
});
