import { Job } from 'bull';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisProcessor } from './variable-analysis.processor';

const createQueryBuilder = (rawRows: unknown[] = []) => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  distinct: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  clone: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(rawRows),
  getQueryAndParameters: jest.fn().mockReturnValue(['SELECT 1', []])
});

describe('VariableAnalysisProcessor', () => {
  it('stores full analysis results in cache and returns only small job metadata', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'VAR' }
    ]);
    const summaryQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        totalCount: '10',
        emptyCount: '1',
        distinctValueCount: '2'
      }
    ]);
    const topValuesQuery = createQueryBuilder();
    const statusQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        status: '3',
        count: '10'
      }
    ]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([
        {
          unitId: '1',
          unitName: 'UNIT',
          variableId: 'VAR',
          value: 'x'.repeat(500),
          valueLength: '1000',
          valueHash: 'abc123',
          count: '9'
        }
      ])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    const metadata = await processor.process(job);

    expect(metadata).toEqual(expect.objectContaining({
      cacheKey: 'variable-analysis:1:job-1',
      workspaceId: 1,
      total: 1,
      storage: 'chunked',
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: expect.any(String)
    }));
    expect(metadata).not.toHaveProperty('variableCombos');
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:variable-combos:0',
      [expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'VAR'
      })],
      86400
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:VAR', [expect.objectContaining({
        value: `${'x'.repeat(500)}... [truncated 1000 chars, md5:abc123]`,
        count: 9,
        percentage: 90
      })]]],
      86400
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1',
      expect.objectContaining({
        storage: 'chunked',
        total: 1,
        variableComboChunks: 1,
        frequencyChunks: 1
      }),
      86400
    );
  });

  it('adds coding scheme codes as optional supplemental frequency rows', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'VAR' }
    ]);
    const summaryQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        totalCount: '4',
        emptyCount: '0',
        distinctValueCount: '3'
      }
    ]);
    const topValuesQuery = createQueryBuilder();
    const schemaCountQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'VAR',
        value: 'B',
        count: '1'
      }
    ]);
    const statusQuery = createQueryBuilder([]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(schemaCountQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([
        {
          unitId: '1',
          unitName: 'UNIT',
          variableId: 'VAR',
          value: 'A',
          valueLength: '1',
          valueHash: 'hash-a',
          count: '2'
        }
      ])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'VAR',
              alias: 'VAR',
              type: 'string',
              hasCodingScheme: true,
              codes: [
                { id: 'A', label: 'Alpha' },
                { id: 'B', label: 'Beta' },
                { id: 'C', label: 'Gamma', score: 0 }
              ]
            }
          ]
        }
      ])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    await processor.process(job);

    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:VAR', [
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: 2,
          percentage: 50,
          schemaOrder: 0
        }),
        expect.objectContaining({
          value: 'B',
          label: 'Beta',
          count: 1,
          percentage: 25,
          schemaOrder: 1,
          isSchemaSupplemental: true
        }),
        expect.objectContaining({
          value: 'C',
          label: 'Gamma',
          score: 0,
          count: 0,
          percentage: 0,
          schemaOrder: 2,
          isSchemaOnly: true,
          isSchemaSupplemental: true
        })
      ]]],
      86400
    );
  });

  it('splits multiple response arrays and applies metadata value labels', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'MULTI' }
    ]);
    const summaryQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'MULTI',
        totalCount: '3',
        emptyCount: '0',
        distinctValueCount: '3'
      }
    ]);
    const topValuesQuery = createQueryBuilder();
    const multipleResponseQuery = createQueryBuilder([
      {
        responseId: '1',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: '["A","B"]'
      },
      {
        responseId: '2',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: '["B"]'
      },
      {
        responseId: '3',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: '[]'
      }
    ]);
    const schemaCountQuery = createQueryBuilder([]);
    const statusQuery = createQueryBuilder([]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(multipleResponseQuery)
      .mockReturnValueOnce(schemaCountQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([
        {
          unitId: '1',
          unitName: 'UNIT',
          variableId: 'MULTI',
          value: '["A","B"]',
          valueLength: '9',
          valueHash: 'hash-array',
          count: '1'
        }
      ])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'MULTI',
              alias: 'MULTI',
              type: 'string',
              multiple: true,
              hasCodingScheme: false,
              values: [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' }
              ]
            }
          ]
        }
      ])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    await processor.process(job);

    expect(multipleResponseQuery.andWhere).toHaveBeenCalledWith(
      'response.id > :multipleLastResponseId',
      { multipleLastResponseId: 0 }
    );
    expect(multipleResponseQuery.limit).toHaveBeenCalledWith(5000);
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:variable-combos:0',
      [expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'MULTI',
        totalCount: 3,
        emptyCount: 1,
        distinctValueCount: 2
      })],
      86400
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:MULTI', [
        expect.objectContaining({
          value: 'B',
          label: 'Beta',
          count: 2,
          percentage: 66.66666666666666
        }),
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: 1,
          percentage: 33.33333333333333
        })
      ]]],
      86400
    );
  });

  it('paginates multiple response rows across batches', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'MULTI' }
    ]);
    const summaryQuery = createQueryBuilder([
      {
        unitId: '1',
        variableId: 'MULTI',
        totalCount: '5001',
        emptyCount: '0',
        distinctValueCount: '3'
      }
    ]);
    const topValuesQuery = createQueryBuilder();
    const multipleResponseBatchSize = 5000;
    const multipleResponsePage1Query = createQueryBuilder(
      Array.from({ length: multipleResponseBatchSize }, (_, index) => ({
        responseId: index + 1,
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: '["A"]'
      }))
    );
    const multipleResponsePage2Query = createQueryBuilder([
      {
        responseId: multipleResponseBatchSize + 1,
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: '["B","C"]'
      }
    ]);
    const schemaCountQuery = createQueryBuilder([]);
    const statusQuery = createQueryBuilder([]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(multipleResponsePage1Query)
      .mockReturnValueOnce(multipleResponsePage2Query)
      .mockReturnValueOnce(schemaCountQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'MULTI',
              alias: 'MULTI',
              type: 'string',
              multiple: true,
              hasCodingScheme: false,
              values: [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' },
                { value: 'C', label: 'Gamma' }
              ]
            }
          ]
        }
      ])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    await processor.process(job);

    expect(multipleResponsePage1Query.andWhere).toHaveBeenCalledWith(
      'response.id > :multipleLastResponseId',
      { multipleLastResponseId: 0 }
    );
    expect(multipleResponsePage2Query.andWhere).toHaveBeenCalledWith(
      'response.id > :multipleLastResponseId',
      { multipleLastResponseId: multipleResponseBatchSize }
    );
    expect(multipleResponsePage1Query.limit)
      .toHaveBeenCalledWith(multipleResponseBatchSize);
    expect(multipleResponsePage2Query.limit)
      .toHaveBeenCalledWith(multipleResponseBatchSize);
    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:MULTI', [
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: multipleResponseBatchSize
        }),
        expect.objectContaining({
          value: 'B',
          label: 'Beta',
          count: 1
        }),
        expect.objectContaining({
          value: 'C',
          label: 'Gamma',
          count: 1
        })
      ]]],
      86400
    );
  });

  it('maps boolean multiple response arrays to value position labels', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'BOOL_MULTI' }
    ]);
    const summaryQuery = createQueryBuilder([]);
    const topValuesQuery = createQueryBuilder();
    const multipleResponseQuery = createQueryBuilder([
      {
        responseId: '1',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'BOOL_MULTI',
        value: '[true,false]'
      },
      {
        responseId: '2',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'BOOL_MULTI',
        value: '[true,true]'
      },
      {
        responseId: '3',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'BOOL_MULTI',
        value: '[false,false]'
      }
    ]);
    const schemaCountQuery = createQueryBuilder([]);
    const statusQuery = createQueryBuilder([]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(multipleResponseQuery)
      .mockReturnValueOnce(schemaCountQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'BOOL_MULTI',
              alias: 'BOOL_MULTI',
              type: 'boolean',
              multiple: true,
              hasCodingScheme: false,
              valuePositionLabels: ['Red', 'Blue']
            }
          ]
        }
      ])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    await processor.process(job);

    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:BOOL_MULTI', [
        expect.objectContaining({
          value: '1',
          label: 'Red',
          count: 2,
          percentage: 66.66666666666666
        }),
        expect.objectContaining({
          value: '2',
          label: 'Blue',
          count: 1,
          percentage: 33.33333333333333
        })
      ]]],
      86400
    );
  });

  it('maps boolean multiple response arrays to declared values without position labels', async () => {
    const baseQuery = createQueryBuilder();
    const variableCombosQuery = createQueryBuilder([
      { unitId: '1', unitName: 'UNIT', variableId: 'BOOL_MULTI' }
    ]);
    const summaryQuery = createQueryBuilder([]);
    const topValuesQuery = createQueryBuilder();
    const multipleResponseQuery = createQueryBuilder([
      {
        responseId: '1',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'BOOL_MULTI',
        value: '[true,false,true]'
      },
      {
        responseId: '2',
        unitId: '1',
        unitName: 'UNIT',
        variableId: 'BOOL_MULTI',
        value: '[false,true,false]'
      }
    ]);
    const schemaCountQuery = createQueryBuilder([]);
    const statusQuery = createQueryBuilder([]);
    baseQuery.clone = jest.fn()
      .mockReturnValueOnce(variableCombosQuery)
      .mockReturnValueOnce(summaryQuery)
      .mockReturnValueOnce(topValuesQuery)
      .mockReturnValueOnce(multipleResponseQuery)
      .mockReturnValueOnce(schemaCountQuery)
      .mockReturnValueOnce(statusQuery);

    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
      query: jest.fn().mockResolvedValue([])
    };
    const cacheService = {
      set: jest.fn().mockResolvedValue(true)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const workspaceFilesService = {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'BOOL_MULTI',
              alias: 'BOOL_MULTI',
              type: 'boolean',
              multiple: true,
              hasCodingScheme: false,
              values: [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' },
                { value: 'C', label: 'Gamma' }
              ]
            }
          ]
        }
      ])
    };
    const processor = new VariableAnalysisProcessor(
      responseRepository as never,
      cacheService as unknown as CacheService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
    const job = {
      id: 'job-1',
      data: {
        workspaceId: 1,
        cacheKey: 'variable-analysis:1:job-1'
      },
      progress: jest.fn().mockResolvedValue(undefined)
    } as unknown as Job<VariableAnalysisJobData>;

    await processor.process(job);

    expect(cacheService.set).toHaveBeenCalledWith(
      'variable-analysis:1:job-1:frequencies:0',
      [['1:BOOL_MULTI', [
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: 1,
          percentage: 50
        }),
        expect.objectContaining({
          value: 'B',
          label: 'Beta',
          count: 1,
          percentage: 50
        }),
        expect.objectContaining({
          value: 'C',
          label: 'Gamma',
          count: 1,
          percentage: 50
        })
      ]]],
      86400
    );
  });
});
