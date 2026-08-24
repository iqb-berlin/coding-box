import { Job } from 'bull';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { EmptyResponseSelectionService } from '../../database/services/coding/empty-response-selection.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import { CodingAnalysisJobData } from '../job-queue.service';
import { CodingAnalysisProcessor } from './coding-analysis.processor';

describe('CodingAnalysisProcessor', () => {
  function createProcessor(cacheService: Partial<CacheService>) {
    const processor = new CodingAnalysisProcessor(
      {} as never,
      cacheService as CacheService,
      {} as WorkspaceExclusionService,
      {} as EmptyResponseSelectionService
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
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('old-run'))).resolves.toBe(analysis);

    expect(cacheService.get).toHaveBeenCalledWith('response-analysis:7__t2:run');
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('caches analysis results for the latest marked run', async () => {
    const cacheService = {
      get: jest.fn().mockResolvedValue('current-run'),
      set: jest.fn().mockResolvedValue(true)
    };
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('current-run'))).resolves.toBe(analysis);

    expect(cacheService.set).toHaveBeenCalledWith(
      'response-analysis:7__t2',
      analysis,
      600
    );
  });

  it('reports an effectively empty derived response with a technical target value', () => {
    const { processor } = createProcessor({});
    const emptyResponses: ResponseAnalysisDto['emptyResponses']['items'] = [];
    const duplicateValueGroups: ResponseAnalysisDto['duplicateValues']['groups'] = [];
    const derivedResponse = {
      id: 1,
      value: 'technical solver value',
      variableid: 'DERIVED',
      unitid: 2,
      unit: {
        name: 'UNIT',
        booklet: {
          person: { login: 'person' },
          bookletinfo: { name: 'booklet' }
        }
      }
    } as ResponseEntity;

    (processor as unknown as {
      analyzeBatch: (
        responses: ResponseEntity[],
        matchingFlags: string[],
        emptyItems: ResponseAnalysisDto['emptyResponses']['items'],
        duplicateGroups: ResponseAnalysisDto['duplicateValues']['groups'],
        derivedVariableMap: Map<string, Set<string>>,
        effectivelyEmptyResponseIds: Set<number>
      ) => void;
    }).analyzeBatch(
      [derivedResponse],
      [],
      emptyResponses,
      duplicateValueGroups,
      new Map([['UNIT', new Set(['DERIVED'])]]),
      new Set([1])
    );

    expect(emptyResponses).toEqual([
      expect.objectContaining({
        responseId: 1,
        value: 'technical solver value'
      })
    ]);
    expect(duplicateValueGroups).toEqual([]);
  });
});
