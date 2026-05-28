import { Job } from 'bull';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisProcessor } from './variable-analysis.processor';

type MockQueryBuilder = ReturnType<typeof createQueryBuilder>;

const createQueryBuilder = (rawRows: unknown[] = []) => {
  const selectFragments: string[] = [];
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn((selection?: string) => {
      if (selection) selectFragments.push(selection);
      return qb;
    }),
    addSelect: jest.fn((selection?: string, alias?: string) => {
      if (alias === '') selectFragments.push(alias);
      if (selection) selectFragments.push(selection);
      return qb;
    }),
    distinct: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawRows),
    getQueryAndParameters: jest.fn(() => [
      `SELECT ${selectFragments.join(', ') || '1'} FROM response`,
      []
    ])
  };

  return qb;
};

const createJob = (data: Partial<VariableAnalysisJobData> = {}) => ({
  id: 'job-1',
  data: {
    workspaceId: 1,
    cacheKey: 'variable-analysis:1:job-1',
    ...data
  },
  progress: jest.fn().mockResolvedValue(undefined)
}) as unknown as Job<VariableAnalysisJobData>;

const findCacheSetPayload = <T>(
  cacheService: { set: jest.Mock },
  key: string
): T => {
  const call = cacheService.set.mock.calls.find(([cacheKey]) => cacheKey === key);
  expect(call).toBeDefined();
  return call[1] as T;
};

const defaultExclusions = {
  globalIgnoredUnits: [],
  ignoredBooklets: [],
  testletIgnoredUnits: []
};

const createProcessor = ({
  representativeRows = [{ unitName: 'UNIT', unitId: '1' }],
  queryResults = [],
  unitVariableDetails = [
    {
      unitName: 'UNIT',
      unitId: 'UNIT',
      variables: [
        {
          id: 'VAR',
          alias: 'VAR',
          type: 'string',
          sourceType: 'BASE',
          hasCodingScheme: true,
          codes: [{ id: 'A', label: 'Alpha' }]
        }
      ]
    }
  ],
  exclusions = defaultExclusions
}: {
  representativeRows?: unknown[];
  queryResults?: unknown[][];
  unitVariableDetails?: unknown[];
  exclusions?: typeof defaultExclusions;
} = {}) => {
  const baseQuery = createQueryBuilder();
  const representativeQuery = createQueryBuilder(representativeRows);
  const analysisQuery = createQueryBuilder();
  baseQuery.clone = jest.fn()
    .mockReturnValueOnce(representativeQuery)
    .mockReturnValue(analysisQuery);

  const responseRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(baseQuery),
    query: jest.fn()
  };
  queryResults.forEach(result => {
    responseRepository.query.mockResolvedValueOnce(result);
  });
  responseRepository.query.mockResolvedValue([]);

  const cacheService = {
    set: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true)
  };
  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue(exclusions)
  };
  const workspaceFilesService = {
    getUnitVariableDetails: jest.fn().mockResolvedValue(unitVariableDetails)
  };
  const processor = new VariableAnalysisProcessor(
    responseRepository as never,
    cacheService as unknown as CacheService,
    workspaceExclusionService as unknown as WorkspaceExclusionService,
    workspaceFilesService as unknown as WorkspaceFilesService
  );

  return {
    processor,
    responseRepository,
    cacheService,
    workspaceExclusionService,
    workspaceFilesService,
    baseQuery: baseQuery as MockQueryBuilder,
    analysisQuery: analysisQuery as MockQueryBuilder
  };
};

describe('VariableAnalysisProcessor', () => {
  it('builds the analyzed variable set from metadata and keeps missing schema variables with zero counts', async () => {
    const { processor, cacheService, responseRepository } = createProcessor({
      unitVariableDetails: [
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'SCHEME_VAR',
              alias: 'VAR',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: true,
              codes: [
                { id: 'A', label: 'Alpha' },
                { id: 'B', label: 'Beta' }
              ]
            },
            {
              id: 'MISSING',
              alias: 'MISSING',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: true,
              codes: [{ id: 'Z', label: 'Zed' }]
            },
            {
              id: 'NO_VALUE',
              alias: 'NO_VALUE',
              type: 'no-value',
              sourceType: 'BASE',
              hasCodingScheme: false
            },
            {
              id: 'BASE_NO_VALUE',
              alias: 'BASE_NO_VALUE',
              type: 'string',
              sourceType: 'BASE_NO_VALUE',
              hasCodingScheme: true
            }
          ]
        },
        {
          unitName: 'OUTSIDE',
          unitId: 'OUTSIDE',
          variables: [
            {
              id: 'OUTSIDE_VAR',
              alias: 'OUTSIDE_VAR',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: true,
              codes: [{ id: 'X', label: 'Outside' }]
            }
          ]
        }
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            totalCount: '2',
            emptyCount: '0',
            distinctValueCount: '1'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            valueLength: '1',
            valueHash: 'hash-a',
            count: '2'
          },
          {
            unitName: 'UNIT',
            variableId: 'ROGUE',
            value: 'ignored',
            valueLength: '7',
            valueHash: 'hash-rogue',
            count: '99'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            count: '2'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            status: '3',
            count: '2'
          }
        ]
      ]
    });

    const metadata = await processor.process(createJob());

    expect(metadata).toEqual(expect.objectContaining({
      cacheKey: 'variable-analysis:1:job-1',
      workspaceId: 1,
      total: 2,
      storage: 'chunked',
      variableComboChunks: 1,
      frequencyChunks: 1,
      storedAt: expect.any(String)
    }));

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'MISSING',
        sourceVariableId: 'MISSING',
        selectionSource: 'coding-scheme',
        sourceType: 'BASE',
        totalCount: 0
      }),
      expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'VAR',
        sourceVariableId: 'SCHEME_VAR',
        variableAlias: 'VAR',
        selectionSource: 'coding-scheme',
        sourceType: 'BASE',
        totalCount: 2,
        distinctValueCount: 1
      })
    ]);
    expect(variableCombos).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ variableId: 'NO_VALUE' }),
      expect.objectContaining({ variableId: 'BASE_NO_VALUE' }),
      expect.objectContaining({ variableId: 'OUTSIDE_VAR' })
    ]));

    const frequencies = findCacheSetPayload<Array<[string, unknown[]]>>(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([
      ['1:MISSING', [
        expect.objectContaining({
          value: 'Z',
          label: 'Zed',
          count: 0,
          percentage: 0,
          isSchemaOnly: true
        })
      ]],
      ['1:VAR', [
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: 2,
          percentage: 100,
          schemaOrder: 0
        }),
        expect.objectContaining({
          value: 'B',
          label: 'Beta',
          count: 0,
          percentage: 0,
          isSchemaOnly: true
        })
      ]]
    ]);
    const schemaCountCall = responseRepository.query.mock.calls.find(([sql]) => (
      String(sql).includes('jsonb_to_recordset')
    ));
    expect(schemaCountCall).toBeDefined();
    const schemaCountParameters = schemaCountCall?.[1] as unknown[];
    const schemaFilterParameter =
      schemaCountParameters[schemaCountParameters.length - 1];
    expect(JSON.parse(schemaFilterParameter as string)).toEqual([
      { logicalKey: 'UNIT\u001FMISSING', value: 'Z' },
      { logicalKey: 'UNIT\u001FVAR', value: 'A' },
      { logicalKey: 'UNIT\u001FVAR', value: 'B' }
    ]);
  });

  it('filters variables through metadata without hiding missing observed responses', async () => {
    const { processor, cacheService, baseQuery } = createProcessor({
      unitVariableDetails: [
        {
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [
            {
              id: 'VAR',
              alias: 'VAR',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: false
            },
            {
              id: 'MISSING',
              alias: 'MISSING',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: false
            }
          ]
        }
      ],
      queryResults: [
        [],
        [],
        []
      ]
    });

    await processor.process(createJob({
      unitId: 1,
      variableId: 'MISSING'
    }));

    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      'unit.id = :unitId',
      { unitId: 1 }
    );
    expect(baseQuery.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('response.variableid LIKE'),
      expect.anything()
    );

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        unitId: 1,
        unitName: 'UNIT',
        variableId: 'MISSING',
        totalCount: 0
      })
    ]);
  });

  it('applies workspace exclusions and builds a deterministic duplicate-response selection query', async () => {
    const {
      processor,
      responseRepository,
      baseQuery,
      analysisQuery
    } = createProcessor({
      exclusions: {
        globalIgnoredUnits: ['IGNORED_UNIT'],
        ignoredBooklets: ['BOOKLET_X'],
        testletIgnoredUnits: [
          { bookletId: 'BOOKLET_Y', unitId: 'UNIT_IN_TESTLET' }
        ]
      },
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            totalCount: '1',
            emptyCount: '0',
            distinctValueCount: '1'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            valueLength: '1',
            valueHash: 'hash-a',
            count: '1'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            count: '1'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            status: '3',
            count: '1'
          }
        ]
      ]
    });

    await processor.process(createJob());

    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('REGEXP_REPLACE'),
      expect.objectContaining({ workspaceExclusionIgnoredUnits: ['IGNORED_UNIT'] })
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT IN (:...workspaceExclusionIgnoredBooklets)'),
      expect.objectContaining({ workspaceExclusionIgnoredBooklets: ['BOOKLET_X'] })
    );
    const duplicateSelection = analysisQuery.addSelect.mock.calls
      .find(([, alias]) => alias === 'analysisRank')?.[0] as string;
    expect(duplicateSelection).toContain('ROW_NUMBER() OVER');
    expect(duplicateSelection).toContain('PARTITION BY');
    expect(duplicateSelection).toContain("CASE WHEN response.value IS NULL OR response.value = '' THEN 1 ELSE 0 END ASC");
    expect(duplicateSelection).toContain('response.id DESC');
    expect(responseRepository.query.mock.calls[0][1]).toEqual([
      ['UNIT\u001FVAR']
    ]);
  });

  it('splits multiple response arrays and applies metadata value labels', async () => {
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [
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
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'MULTI',
            totalCount: '3',
            emptyCount: '0',
            distinctValueCount: '3'
          }
        ],
        [],
        [
          {
            responseId: '1',
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '["A","B"]'
          },
          {
            responseId: '2',
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '["B"]'
          },
          {
            responseId: '3',
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '[]'
          }
        ],
        [],
        []
      ]
    });

    await processor.process(createJob());

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        variableId: 'MULTI',
        totalCount: 3,
        emptyCount: 1,
        distinctValueCount: 2
      })
    ]);

    const frequencies = findCacheSetPayload<Array<[string, unknown[]]>>(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([
      ['1:MULTI', [
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
      ]]
    ]);
  });

  it('splits boolean multiple response arrays using position labels', async () => {
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [
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
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'BOOL_MULTI',
            totalCount: '3',
            emptyCount: '0',
            distinctValueCount: '3'
          }
        ],
        [],
        [
          {
            responseId: '1',
            unitName: 'UNIT',
            variableId: 'BOOL_MULTI',
            value: '[true,false]'
          },
          {
            responseId: '2',
            unitName: 'UNIT',
            variableId: 'BOOL_MULTI',
            value: '[true,true]'
          },
          {
            responseId: '3',
            unitName: 'UNIT',
            variableId: 'BOOL_MULTI',
            value: '[false,false]'
          }
        ],
        [],
        []
      ]
    });

    await processor.process(createJob());

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        variableId: 'BOOL_MULTI',
        totalCount: 3,
        emptyCount: 1,
        distinctValueCount: 2
      })
    ]);

    const frequencies = findCacheSetPayload<Array<[string, unknown[]]>>(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([
      ['1:BOOL_MULTI', [
        expect.objectContaining({
          value: '1',
          label: 'Red',
          count: 2,
          percentage: 66.66666666666666,
          schemaOrder: 0
        }),
        expect.objectContaining({
          value: '2',
          label: 'Blue',
          count: 1,
          percentage: 33.33333333333333,
          schemaOrder: 1
        })
      ]]
    ]);
  });

  it('paginates multiple response rows across batches', async () => {
    const batchSize = 5000;
    const { processor, cacheService, responseRepository } = createProcessor({
      unitVariableDetails: [
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
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'MULTI',
            totalCount: String(batchSize + 1),
            emptyCount: '0',
            distinctValueCount: '3'
          }
        ],
        [],
        Array.from({ length: batchSize }, (_, index) => ({
          responseId: index + 1,
          unitName: 'UNIT',
          variableId: 'MULTI',
          value: '["A"]'
        })),
        [
          {
            responseId: batchSize + 1,
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '["B","C"]'
          }
        ],
        [],
        []
      ]
    });

    await processor.process(createJob());

    expect(responseRepository.query.mock.calls[2][1]).toEqual([
      ['UNIT\u001FMULTI'],
      0,
      batchSize
    ]);
    expect(responseRepository.query.mock.calls[3][1]).toEqual([
      ['UNIT\u001FMULTI'],
      batchSize,
      batchSize
    ]);

    const frequencies = findCacheSetPayload<Array<[string, unknown[]]>>(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([
      ['1:MULTI', [
        expect.objectContaining({ value: 'A', label: 'Alpha', count: batchSize }),
        expect.objectContaining({ value: 'B', label: 'Beta', count: 1 }),
        expect.objectContaining({ value: 'C', label: 'Gamma', count: 1 })
      ]]
    ]);
  });
});
