import { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import { ResponseAnalysisDto } from '../../../../../../api-dto/coding/response-analysis.dto';
import { CacheService } from '../../cache/cache.service';
import { EmptyResponseSelectionService } from '../../database/services/coding/empty-response-selection.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import type { WorkspaceFileMetadataReader } from '../../database/services/workspace/workspace-file-metadata-reader.token';
import { getManualCodingScopeKey } from '../../database/utils/manual-coding-scope.util';
import {
  CODING_COMPLETE_STATUS, CODING_INCOMPLETE_STATUS, INTENDED_INCOMPLETE_STATUS
} from '../../database/utils/manual-coding-candidate.util';
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
      },
      getState: jest.fn(),
      updateProgress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<CodingAnalysisJobData>;
  }

  it('does not publish analysis results superseded by a newer run', async () => {
    const cacheService = {
      setIfMarkerMatches: jest.fn().mockResolvedValue(false),
      expire: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(true)
    };
    const { processor, analysis } = createProcessor(cacheService);

    await expect(processor.handleResponseAnalysis(createJob('old-run'))).resolves.toBe(analysis.aggregationSummary);

    expect(cacheService.setIfMarkerMatches).toHaveBeenCalledWith(
      'response-analysis:7__t2', expect.anything(), 600, 'response-analysis:7__t2:run', 'old-run'
    );
    expect(cacheService.delete).toHaveBeenCalledTimes(2);
  });

  it('publishes the current result and records only the summary in the job', async () => {
    const cacheService = {
      setIfMarkerMatches: jest.fn().mockResolvedValue(true),
      expire: jest.fn().mockResolvedValue(undefined)
    };
    const { processor, analysis } = createProcessor(cacheService);
    const job = createJob('current-run');

    await expect(processor.handleResponseAnalysis(job)).resolves.toBe(analysis.aggregationSummary);
    expect(cacheService.setIfMarkerMatches).toHaveBeenCalledWith(
      'response-analysis:7__t2', analysis, 600, 'response-analysis:7__t2:run', 'current-run'
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('keeps the marker during a retry and releases it only when a job finishes', async () => {
    const deleteIfMarkerMatches = jest.fn();
    const { processor } = createProcessor({ deleteIfMarkerMatches });
    const job = createJob('retried-run');
    jest.mocked(job.getState).mockResolvedValueOnce('delayed').mockResolvedValueOnce('failed');

    await processor.releaseFailedRunMarker(job);
    expect(deleteIfMarkerMatches).not.toHaveBeenCalled();
    await processor.releaseFailedRunMarker(job);
    expect(deleteIfMarkerMatches).toHaveBeenNthCalledWith(1, 'response-analysis:7__t2:run', 'retried-run');

    await processor.releaseCompletedRunMarker(createJob('completed-run'));
    expect(deleteIfMarkerMatches).toHaveBeenNthCalledWith(2, 'response-analysis:7__t2:run', 'completed-run');
  });

  it('selects the status needed to report an empty derived response for a mixed selection and justification', async () => {
    const derivedResponse = {
      id: 1,
      value: 'technical solver value',
      variableid: 'DERIVED',
      unitid: 2,
      status_v1: CODING_INCOMPLETE_STATUS,
      status_v2: null,
      unit: {
        name: 'UNIT',
        booklet: {
          person: { login: 'person' },
          bookletinfo: { name: 'booklet' }
        }
      }
    } as ResponseEntity;

    const analysisQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ unitName: 'UNIT', variableId: 'DERIVED' }]),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([derivedResponse])
    };
    const sourceQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 2, unitid: 2, variableid: 'CHOICE', value: 'selected', status_v1: CODING_COMPLETE_STATUS
        },
        {
          id: 3, unitid: 2, variableid: 'REASON', value: '', status_v1: INTENDED_INCOMPLETE_STATUS
        }
      ])
    };
    const emptyResponseSelectionService = new EmptyResponseSelectionService(
      { createQueryBuilder: () => sourceQuery } as unknown as Repository<ResponseEntity>,
      {
        getDerivedVariableMetadata: jest.fn().mockResolvedValue({
          metadataAvailable: true,
          derivedVariableMap: new Map([['UNIT', new Set(['DERIVED'])]]),
          derivedVariablesBySourceMap: new Map([
            [getManualCodingScopeKey('UNIT', 'CHOICE'), new Set(['DERIVED'])],
            [getManualCodingScopeKey('UNIT', 'REASON'), new Set(['DERIVED'])]
          ])
        })
      } as unknown as WorkspaceFileMetadataReader
    );
    const appendListItems = jest.fn();
    const publish = jest.fn().mockResolvedValue(true);
    const processor = new CodingAnalysisProcessor(
      { createQueryBuilder: () => analysisQuery } as unknown as Repository<ResponseEntity>,
      { appendListItems, expire: jest.fn(), setIfMarkerMatches: publish } as unknown as CacheService,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({
          globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: []
        })
      } as unknown as WorkspaceExclusionService,
      emptyResponseSelectionService
    );

    await processor.handleResponseAnalysis(createJob('mixed-response-run'));

    expect(analysisQuery.select).toHaveBeenCalledWith(expect.arrayContaining(['response.status_v1']));
    expect(appendListItems).toHaveBeenCalledWith(expect.stringMatching(/:empty$/), [
      expect.objectContaining({ responseId: 1, value: 'technical solver value' })
    ], expect.any(Number));
    expect(publish).toHaveBeenCalledWith(
      'response-analysis:7__t2',
      expect.objectContaining({ emptyResponses: { total: 1, totalUncoded: 1 }, duplicateValues: expect.objectContaining({ total: 0 }) }),
      600,
      'response-analysis:7__t2:run',
      'mixed-response-run'
    );
  });
});
