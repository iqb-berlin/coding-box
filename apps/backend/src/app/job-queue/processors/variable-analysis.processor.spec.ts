import * as childProcess from 'child_process';
import * as path from 'path';
import { createHash } from 'crypto';
import { Job } from 'bullmq';
import type { VariableFrequencyDto } from '../../admin/variable-analysis/dto/variable-frequency.dto';
import { CacheService } from '../../cache/cache.service';
import { WorkspaceExclusionService } from '../../database/services/workspace';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { VariableAnalysisJobData } from '../job-queue.service';
import { VariableAnalysisProcessor } from './variable-analysis.processor';
import eatPrepReferenceGolden = require('./__fixtures__/variable-analysis-eatpreptba-reference.golden.json');

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
  progress: 0,
  updateProgress: jest.fn().mockResolvedValue(undefined)
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

interface ReferenceVariableCombo {
  unitName: string;
  variableId: string;
  totalCount: number;
  validCount: number;
  invalidCount: number;
  emptyCount: number;
  emptyPercentage: number;
  distinctValueCount: number;
}

interface ReferenceFrequency {
  unitName: string;
  variableId: string;
  value: string;
  label?: string;
  score?: number;
  count: number;
  validOccurrenceCount: number;
  percentageTotal: number;
  percentageValid: number | null;
  isSchemaOnly: boolean;
}

interface EatPrepReferenceGolden {
  tolerance: number;
  variableCombos: ReferenceVariableCombo[];
  frequencies: ReferenceFrequency[];
}

const eatPrepReference =
  eatPrepReferenceGolden as EatPrepReferenceGolden;

const repoRoot = path.resolve(__dirname, '../../../../../..');
const eatPrepReferenceNormalizerPath = path.join(
  repoRoot,
  'scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs'
);

const toReferenceKey = (
  unitName: string,
  variableId: string,
  value?: string
): string => (
  value === undefined ?
    `${unitName}\u001F${variableId}` :
    `${unitName}\u001F${variableId}\u001F${value}`
);

const expectCloseToReference = (
  actual: unknown,
  expected: number,
  tolerance: number
): void => {
  expect(typeof actual).toBe('number');
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
    tolerance
  );
};

const literalCoding = (id: string, definitions: { value: string; label: string; score?: number }[]) => ({
  id,
  sourceType: 'BASE',
  codes: definitions.map((definition, index) => ({
    id: index + 1,
    label: definition.label,
    score: definition.score,
    ruleSets: [{ rules: [{ method: 'MATCH', parameters: [definition.value] }] }]
  }))
});

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
          values: [{ value: 'A', label: 'Alpha' }]
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
  it.each([
    {
      nullCount: 2, label: 'NULL', score: 1, isFromSchema: true
    },
    {
      nullCount: 0, label: 'Leer', score: 0, isFromSchema: true
    },
    {
      nullCount: 1, label: undefined, score: undefined, isFromSchema: undefined
    }
  ].flatMap(expected => [true, false].map(inTopValues => ({ ...expected, inTopValues }))))(
    'does not confuse null and empty answers with nullCount=$nullCount and inTopValues=$inTopValues', async expected => {
      const { processor, cacheService, responseRepository } = createProcessor({
        unitVariableDetails: [{
          unitName: 'UNIT',
          unitId: 'UNIT',
          variables: [{
            id: 'VAR',
            alias: 'VAR',
            type: 'string',
            hasCodingScheme: true,
            coding: {
              id: 'VAR',
              sourceType: 'BASE',
              codes: [
                {
                  id: 1, label: 'NULL', score: 1, ruleSets: [{ rules: [{ method: 'IS_NULL' }] }]
                },
                {
                  id: 2, label: 'Leer', score: 0, ruleSets: [{ rules: [{ method: 'IS_EMPTY' }] }]
                }
              ]
            },
            values: [{ value: '', label: 'Leere Antwort' }]
          }]
        }],
        queryResults: [
          [{
            unitName: 'UNIT',
            variableId: 'VAR',
            totalCount: expected.inTopValues ? 2 : 42,
            validCount: expected.inTopValues ? 0 : 40,
            emptyCount: 2,
            distinctValueCount: expected.inTopValues ? 1 : 21
          }],
          expected.inTopValues ?
            [{
              unitName: 'UNIT', variableId: 'VAR', value: '', valueLength: 0, nullCount: expected.nullCount, count: 2, validCount: 0
            }] :
            Array.from({ length: 20 }, (_, index) => ({
              unitName: 'UNIT', variableId: 'VAR', value: `Antwort${index}`, valueLength: 9, nullCount: 0, count: 2, validCount: 2
            })),
          [{
            unitName: 'UNIT', variableId: 'VAR', value: '', nullCount: expected.nullCount, count: 2, validCount: 0
          }],
          []
        ]
      });
      await processor.processWorkspaceJob(createJob());
      const entries = findCacheSetPayload<Array<[string, Array<Record<string, unknown>>]>>(
        cacheService, 'variable-analysis:1:job-1:frequencies:0'
      );
      const emptyRow = entries[0][1].find(row => row.value === '');
      expect(entries[0][1]).toHaveLength(expected.inTopValues ? 1 : 21);
      expect(emptyRow).toMatchObject({
        value: '', count: 2, score: expected.score, isFromSchema: expected.isFromSchema
      });
      if (expected.label) expect(emptyRow?.label).toBe(expected.label);
      expect(responseRepository.query.mock.calls[1][0]).toContain('AS "nullCount"');
    }
  );

  it('applies range coding to unit metadata answers outside the top twenty', async () => {
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'VAR',
          alias: 'VAR',
          type: 'integer',
          hasCodingScheme: true,
          coding: {
            id: 'VAR',
            sourceType: 'BASE',
            codes: [{
              id: 7, label: 'Im Bereich', score: 1, ruleSets: [{ rules: [{ method: 'NUMERIC_RANGE', parameters: ['1', '10'] }] }]
            }]
          },
          values: [{ value: '5', label: 'Fünf' }, { value: '6', label: 'Sechs' }]
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: 41, validCount: 41, emptyCount: 0, distinctValueCount: 21
        }],
        Array.from({ length: 20 }, (_, index) => ({
          unitName: 'UNIT', variableId: 'VAR', value: String(100 + index), valueLength: 3, count: 2, validCount: 2
        })),
        [{
          unitName: 'UNIT', variableId: 'VAR', value: '5', count: 1, validCount: 1
        }],
        []
      ]
    });
    await processor.processWorkspaceJob(createJob());
    const entries = findCacheSetPayload<Array<[string, Array<Record<string, unknown>>]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(entries[0][1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: '5', label: 'Im Bereich', count: 1, score: 1, code: 7, isFromSchema: true, isSchemaSupplemental: true
      }),
      expect.objectContaining({
        value: '6', label: 'Im Bereich', count: 0, score: 1, code: 7, isFromSchema: true, isSchemaOnly: true
      })
    ]));
  });

  it('codes complete long regex answers in batches while caching only their previews', async () => {
    const answers = Array.from({ length: 21 }, (_, index) => `Hai ${index} ${'🦈'.repeat(501)}${index === 20 ? 'x' : ''}`);
    const { processor, cacheService, responseRepository } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: answers.map((answer, index) => ({
          id: `VAR${index}`,
          alias: `VAR${index}`,
          type: 'string',
          hasCodingScheme: true,
          coding: {
            id: 'VAR',
            sourceType: 'BASE',
            codes: [{
              id: 7,
              label: 'Langer Hai',
              score: 1,
              ruleSets: [{ rules: [{ method: 'MATCH_REGEX', parameters: ['^Hai .*🦈$'] }] }]
            }]
          }
        }))
      }],
      queryResults: [
        answers.map((answer, index) => ({
          unitName: 'UNIT', variableId: `VAR${index}`, totalCount: 2, validCount: 2, emptyCount: 0, distinctValueCount: 1
        })),
        answers.map((answer, index) => ({
          unitName: 'UNIT',
          variableId: `VAR${index}`,
          value: Array.from(answer).slice(0, 500).join(''),
          valueLength: Array.from(answer).length,
          valueHash: createHash('md5').update(answer).digest('hex'),
          responseId: index + 1,
          count: 2,
          validCount: 2
        })),
        answers.slice(0, 20).map((value, index) => ({ responseId: index + 1, value })).reverse(),
        answers.slice(20).map((value, index) => ({ responseId: index + 21, value })),
        []
      ]
    });
    await processor.processWorkspaceJob(createJob());
    const entries = findCacheSetPayload<Array<[string, Array<Record<string, unknown>>]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    const rows = entries.flatMap(([, frequencies]) => frequencies);
    expect(rows).toHaveLength(21);
    rows.forEach((row, index) => {
      expect(row).toMatchObject({
        label: index === 20 ? undefined : 'Langer Hai',
        score: index === 20 ? undefined : 1,
        isFromSchema: index === 20 ? undefined : true,
        count: 2
      });
      expect(row.value).not.toBe(answers[index]);
      expect(row.value).toContain(createHash('md5').update(answers[index]).digest('hex'));
    });
    expect(responseRepository.query.mock.calls[2][1]).toEqual([Array.from({ length: 20 }, (_, index) => index + 1)]);
    expect(responseRepository.query.mock.calls[3][1]).toEqual([[21]]);
  });

  it('merges long Unicode schema answers with their observed previews without counting them twice', async () => {
    const answer = `${'🦈'.repeat(501)} Hai`;
    const valueLength = Array.from(answer).length;
    const valueHash = createHash('md5').update(answer).digest('hex');
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'VAR',
          alias: 'VAR',
          type: 'string',
          hasCodingScheme: true,
          coding: literalCoding('VAR', [{ value: answer, label: 'Hai', score: 1 }])
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: 2, validCount: 2, emptyCount: 0, distinctValueCount: 1
        }],
        [{
          unitName: 'UNIT', variableId: 'VAR', value: Array.from(answer).slice(0, 500).join(''), valueLength, valueHash, responseId: 1, count: 2, validCount: 2
        }],
        [{ responseId: 1, value: answer }],
        [{
          unitName: 'UNIT', variableId: 'VAR', value: answer, count: 2, validCount: 2
        }],
        []
      ]
    });
    await processor.processWorkspaceJob(createJob());
    const entries = findCacheSetPayload<Array<[string, Array<Record<string, unknown>>]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(entries[0][1]).toHaveLength(1);
    expect(entries[0][1][0]).toMatchObject({
      count: 2, score: 1, isFromSchema: true, percentage: 100
    });
    expect(entries[0][1][0].value).toContain(valueHash);
  });

  it('counts animal answers and supplements literal answers instead of code ids', async () => {
    const codes = [
      {
        id: 1, label: 'Gesuchte Antwort', score: 1, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Hai\nhai\nHay'] }] }]
      },
      {
        id: 4, label: 'Andere Tiere', score: 0, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Elefant', 'Zebra', 'Löwe'] }] }]
      }
    ];
    const { processor, cacheService, responseRepository } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'ANIMALS',
          alias: 'VAR',
          type: 'string',
          sourceType: 'BASE',
          hasCodingScheme: true,
          codes,
          coding: { id: 'ANIMALS', sourceType: 'BASE', codes }
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: '4', validCount: '4', emptyCount: '0', distinctValueCount: '3'
        }],
        [
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Hai', valueLength: 3, count: '2', validCount: '2'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Hay', valueLength: 3, count: '1', validCount: '1'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Elefant', valueLength: 7, count: '1', validCount: '1'
          }
        ],
        [
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Hai', count: '2', validCount: '2'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Hay', count: '1', validCount: '1'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: 'Elefant', count: '1', validCount: '1'
          }
        ],
        [{
          unitName: 'UNIT', variableId: 'VAR', status: 3, count: '4'
        }]
      ]
    });

    await processor.processWorkspaceJob(createJob());

    const entries = findCacheSetPayload<Array<[string, Array<Record<string, unknown>>]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    const rows = entries[0][1];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 'Hai', count: 2, validOccurrenceCount: 2, score: 1, code: 1, isFromSchema: true
      }),
      expect.objectContaining({
        value: 'Hay', count: 1, score: 1, isFromSchema: true
      }),
      expect.objectContaining({
        value: 'Elefant', count: 1, validOccurrenceCount: 1, score: 0, isFromSchema: true
      }),
      expect.objectContaining({
        value: 'hai', count: 0, score: 1, isFromSchema: true, isSchemaOnly: true
      }),
      expect.objectContaining({
        value: 'Zebra', count: 0, score: 0, isFromSchema: true, isSchemaOnly: true
      })
    ]));
    expect(rows.map(row => row.value)).not.toEqual(expect.arrayContaining(['1', '4']));
    const schemaQuery = responseRepository.query.mock.calls.find(([sql]) => String(sql).includes('jsonb_to_recordset'));
    expect(JSON.parse(schemaQuery?.[1].at(-1))).toEqual([
      'Hai', 'hai', 'Hay', 'Elefant', 'Zebra', 'Löwe'
    ].map(value => ({ logicalKey: 'UNIT\u001FVAR', value })));
  });

  it('normalizes the eatPrepTBA reference with [null] as an empty response and ignores empty list elements', () => {
    try {
      childProcess.execFileSync(
        process.execPath,
        [eatPrepReferenceNormalizerPath, '--check'],
        {
          cwd: repoRoot,
          stdio: 'pipe'
        }
      );
    } catch (error) {
      const execError = error as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(
        'eatPrepTBA reference golden check failed.\n' +
          `${execError.stdout?.toString() || ''}` +
          `${execError.stderr?.toString() || ''}`
      );
    }
  });

  it('matches the documented eatPrepTBA reference fixture for variable frequencies', async () => {
    const { processor, cacheService } = createProcessor({
      representativeRows: [{ unitName: 'UNIT_REF', unitId: '1' }],
      unitVariableDetails: [
        {
          unitName: 'UNIT_REF',
          unitId: 'UNIT_REF',
          variables: [
            {
              id: 'VAR_BASE',
              alias: 'VAR_BASE',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: true,
              values: [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' },
                { value: 'C', label: 'Gamma' }
              ]
            },
            {
              id: 'VAR_MULTI',
              alias: 'VAR_MULTI',
              type: 'string',
              sourceType: 'BASE',
              multiple: true,
              hasCodingScheme: false,
              values: [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' },
                { value: 'C', label: 'Gamma' }
              ]
            },
            {
              id: 'VAR_MULTI_ONLY_EMPTY',
              type: 'string',
              sourceType: 'BASE',
              multiple: true,
              hasCodingScheme: false
            }
          ]
        }
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            totalCount: '5',
            validCount: '4',
            emptyCount: '1',
            distinctValueCount: '4'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            totalCount: '4',
            validCount: '3',
            emptyCount: '1',
            distinctValueCount: '3'
          }
        ],
        [
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: 'A',
            valueLength: '1',
            valueHash: 'hash-a',
            count: '2',
            validCount: '2'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: 'B',
            valueLength: '1',
            valueHash: 'hash-b',
            count: '1',
            validCount: '1'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: 'D',
            valueLength: '1',
            valueHash: 'hash-d',
            count: '1',
            validCount: '1'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: '',
            valueLength: '0',
            valueHash: 'hash-empty',
            count: '1',
            validCount: '0'
          }
        ],
        [
          {
            responseId: '1',
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            value: '["A","B"]',
            status: '3',
            statusV1: null,
            codeV1: null,
            scoreV1: null
          },
          {
            responseId: '2',
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            value: '["B",null,"  "]',
            status: '3',
            statusV1: null,
            codeV1: null,
            scoreV1: null
          },
          {
            responseId: '3',
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            value: '[null]',
            status: '3',
            statusV1: null,
            codeV1: null,
            scoreV1: null
          },
          {
            responseId: '4',
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            value: '["A","C","C"]',
            status: '3',
            statusV1: null,
            codeV1: null,
            scoreV1: null
          },
          ...['5', '6'].map(responseId => ({
            responseId,
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI_ONLY_EMPTY',
            value: '[]',
            status: '3'
          }))
        ],
        [
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: 'A',
            count: '2',
            validCount: '2'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            value: 'B',
            count: '1',
            validCount: '1'
          }
        ],
        [
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            status: '3',
            count: '4'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_BASE',
            status: '7',
            count: '1'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI',
            status: '3',
            count: '4'
          },
          {
            unitName: 'UNIT_REF',
            variableId: 'VAR_MULTI_ONLY_EMPTY',
            status: '3',
            count: '2'
          }
        ]
      ]
    });

    await processor.processWorkspaceJob(createJob());

    const variableCombos = findCacheSetPayload<Array<Record<string, unknown>>>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toHaveLength(
      eatPrepReference.variableCombos.length
    );
    const combosByKey = new Map(
      variableCombos.map(combo => [
        toReferenceKey(
          String(combo.unitName),
          String(combo.variableId)
        ),
        combo
      ])
    );
    expect(combosByKey.size).toBe(eatPrepReference.variableCombos.length);

    eatPrepReference.variableCombos.forEach(expected => {
      const actual = combosByKey.get(
        toReferenceKey(expected.unitName, expected.variableId)
      );
      expect(actual).toBeDefined();
      expect(actual).toMatchObject({
        unitName: expected.unitName,
        variableId: expected.variableId
      });
      [
        'totalCount',
        'validCount',
        'invalidCount',
        'emptyCount',
        'emptyPercentage',
        'distinctValueCount'
      ].forEach(field => {
        expectCloseToReference(
          actual?.[field],
          expected[field as keyof ReferenceVariableCombo] as number,
          eatPrepReference.tolerance
        );
      });
    });

    const frequencyChunks = findCacheSetPayload<
      Array<[string, Array<Record<string, unknown>>]>
    >(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    const actualFrequencies = frequencyChunks.flatMap(([, rows]) => rows);
    expect(actualFrequencies).toHaveLength(eatPrepReference.frequencies.length);
    const frequenciesByKey = new Map<string, Record<string, unknown>>();
    actualFrequencies.forEach(row => {
      frequenciesByKey.set(
        toReferenceKey(
          String(row.unitName),
          String(row.variableId),
          String(row.value)
        ),
        row
      );
    });
    expect(frequenciesByKey.size).toBe(eatPrepReference.frequencies.length);

    eatPrepReference.frequencies.forEach(expected => {
      const actual = frequenciesByKey.get(
        toReferenceKey(
          expected.unitName,
          expected.variableId,
          expected.value
        )
      );
      expect(actual).toBeDefined();
      expect(actual).toMatchObject({
        unitName: expected.unitName,
        variableId: expected.variableId,
        value: expected.value
      });
      if (expected.label !== undefined) {
        expect(actual?.label).toBe(expected.label);
      }
      if (expected.score !== undefined) {
        expectCloseToReference(
          actual?.score,
          expected.score,
          eatPrepReference.tolerance
        );
      }
      expect(Boolean(actual?.isSchemaOnly)).toBe(expected.isSchemaOnly);
      [
        'count',
        'validOccurrenceCount',
        'percentageTotal'
      ].forEach(field => {
        expectCloseToReference(
          actual?.[field],
          expected[field as keyof ReferenceFrequency] as number,
          eatPrepReference.tolerance
        );
      });
      if (expected.percentageValid === null) {
        expect(actual?.percentageValid).toBeNull();
      } else {
        expectCloseToReference(actual?.percentageValid, expected.percentageValid, eatPrepReference.tolerance);
      }
    });
  });

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
              coding: literalCoding('SCHEME_VAR', [
                { value: 'A', label: 'Alpha' },
                { value: 'B', label: 'Beta' }
              ])
            },
            {
              id: 'MISSING',
              alias: 'MISSING',
              type: 'string',
              sourceType: 'BASE',
              hasCodingScheme: true,
              coding: literalCoding('MISSING', [{ value: 'Z', label: 'Zed' }])
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

    const metadata = await processor.processWorkspaceJob(createJob());

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

    await processor.processWorkspaceJob(createJob({
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

  it('calculates absolute counts and percentages for total and valid responses', async () => {
    const { processor, cacheService, responseRepository } = createProcessor({
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
              hasCodingScheme: true,
              coding: literalCoding('VAR', [
                { value: 'A', label: 'Alpha', score: 1 },
                { value: 'B', label: 'Beta', score: 0 }
              ])
            }
          ]
        }
      ],
      queryResults: [
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            totalCount: '4',
            validCount: '3',
            emptyCount: '1',
            distinctValueCount: '3'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            valueLength: '1',
            valueHash: 'hash-a',
            count: '2',
            validCount: '2'
          },
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'B',
            valueLength: '1',
            valueHash: 'hash-b',
            count: '1',
            validCount: '1'
          },
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: '',
            valueLength: '0',
            valueHash: 'hash-empty',
            count: '1',
            validCount: '0'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'A',
            count: '2',
            validCount: '2'
          },
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            value: 'B',
            count: '1',
            validCount: '1'
          }
        ],
        [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            status: '3',
            count: '3'
          },
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            status: '7',
            count: '1'
          }
        ]
      ]
    });

    await processor.processWorkspaceJob(createJob());

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        variableId: 'VAR',
        totalCount: 4,
        validCount: 3,
        invalidCount: 1,
        emptyCount: 1,
        emptyPercentage: 25
      })
    ]);

    const frequencies = findCacheSetPayload<Array<[string, unknown[]]>>(
      cacheService,
      'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([
      ['1:VAR', [
        expect.objectContaining({
          value: 'A',
          count: 2,
          validOccurrenceCount: 2,
          percentageTotal: 50,
          percentageValid: 66.66666666666666
        }),
        expect.objectContaining({
          value: 'B',
          count: 1,
          validOccurrenceCount: 1,
          percentageTotal: 25,
          percentageValid: 33.33333333333333
        }),
        expect.objectContaining({
          value: '',
          count: 1,
          validOccurrenceCount: 0,
          percentageTotal: 25,
          percentageValid: 0
        })
      ]]
    ]);
    expect(String(responseRepository.query.mock.calls[0][0])).toContain(
      'analysisValid'
    );
    expect(String(responseRepository.query.mock.calls[1][0])).toContain(
      '"validCount"'
    );
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

    await processor.processWorkspaceJob(createJob());

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
            value: '["A","B"]',
            status: '3',
            statusV1: '5',
            codeV1: '1',
            scoreV1: null
          },
          {
            responseId: '2',
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '["B"]',
            status: '3',
            statusV1: '7',
            codeV1: '2',
            scoreV1: null
          },
          {
            responseId: '3',
            unitName: 'UNIT',
            variableId: 'MULTI',
            value: '[]',
            status: '7',
            statusV1: null,
            codeV1: null,
            scoreV1: null
          }
        ],
        [],
        []
      ]
    });

    await processor.processWorkspaceJob(createJob());

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        variableId: 'MULTI',
        totalCount: 3,
        validCount: 2,
        invalidCount: 1,
        emptyCount: 1,
        distinctValueCount: 3
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
          validOccurrenceCount: 2,
          percentage: 66.66666666666666
        }),
        expect.objectContaining({
          value: 'A',
          label: 'Alpha',
          count: 1,
          validOccurrenceCount: 1,
          percentage: 33.33333333333333
        }),
        expect.objectContaining({
          value: '',
          count: 1,
          validOccurrenceCount: 0,
          percentageTotal: 33.33333333333333,
          percentageValid: 0
        })
      ]]
    ]);
  });

  it.each([
    { name: 'position labels only', values: undefined },
    { name: 'an empty value for a labeled option', values: [{ value: '', label: 'Red' }] }
  ])('keeps option labels off the empty row with $name', async ({ values }) => {
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
              values,
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

    await processor.processWorkspaceJob(createJob());

    const variableCombos = findCacheSetPayload<unknown[]>(
      cacheService,
      'variable-analysis:1:job-1:variable-combos:0'
    );
    expect(variableCombos).toEqual([
      expect.objectContaining({
        variableId: 'BOOL_MULTI',
        totalCount: 3,
        emptyCount: 1,
        distinctValueCount: 3
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
        }),
        expect.objectContaining({
          value: '',
          count: 1,
          label: undefined,
          schemaOrder: undefined,
          validOccurrenceCount: 0,
          percentageTotal: 33.33333333333333,
          percentageValid: null
        })
      ]]
    ]);
  });

  it('keeps actual empty multiple responses as an observed row when every answer is empty', async () => {
    const values = [null, '', '   ', '[]', '[false,false]', '[null,""]'];
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI', type: 'string', multiple: true, hasCodingScheme: false
        }]
      }],
      queryResults: [[], [], values.map((value, index) => ({
        responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value, status: 3
      }))]
    });
    await processor.processWorkspaceJob(createJob());
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        totalCount: 6,
        validCount: 0,
        invalidCount: 6,
        emptyCount: 6,
        emptyPercentage: 100,
        distinctValueCount: 1
      })
    ]);
    const frequencies = findCacheSetPayload<Array<[string, { isSchemaOnly?: boolean }[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(frequencies).toEqual([['1:MULTI', [expect.objectContaining({
      value: '', count: 6, validOccurrenceCount: 0, percentageTotal: 100, percentageValid: null
    })]]]);
    expect(frequencies[0][1][0].isSchemaOnly).not.toBe(true);
  });

  it('keeps a rare empty multiple response in addition to the twenty most frequent categories', async () => {
    const responseValues = Array.from({ length: 21 }, (_, index) => [String(index), String(index)]).flat();
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI', type: 'string', multiple: true, hasCodingScheme: false
        }]
      }],
      queryResults: [[], [], [...responseValues.map(value => JSON.stringify([value])), '[]'].map((value, index) => ({
        responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value, status: 3
      }))]
    });
    await processor.processWorkspaceJob(createJob());
    const frequencies = findCacheSetPayload<Array<[string, { value: string; count: number }[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    )[0][1];
    expect(frequencies).toHaveLength(21);
    expect(frequencies.filter(row => row.value !== '')).toHaveLength(20);
    expect(frequencies).toContainEqual(expect.objectContaining({ value: '', count: 1, validOccurrenceCount: 0 }));
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        totalCount: 43, validCount: 42, emptyCount: 1, distinctValueCount: 22
      })
    ]);
  });

  it.each(['', '   '])('keeps an unselected Boolean option with metadata value %j alongside the empty row', async value => {
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI',
          type: 'boolean',
          multiple: true,
          hasCodingScheme: false,
          values: [{ value, label: 'Option A' }, { value: '1', label: 'Option B' }]
        }]
      }],
      queryResults: [[], [], ['[false,false]', '[false,true]'].map((response, index) => ({
        responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value: response, status: 3
      }))]
    });

    await processor.processWorkspaceJob(createJob());

    const [[, rows]] = findCacheSetPayload<Array<[string, VariableFrequencyDto[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.isEmptyValue)).toEqual([
      expect.objectContaining({ value: '', count: 1, validOccurrenceCount: 0 })
    ]);
    expect(rows).toContainEqual(expect.objectContaining({
      value: '1', position: 1, label: 'Option A', count: 0, isEmptyValue: false, isSchemaOnly: true, isSchemaSupplemental: true
    }));
    expect(rows).toContainEqual(expect.objectContaining({ value: '1', label: 'Option B', count: 1 }));
    expect(new Set(rows.map(row => row.position ?? row.value)).size).toBe(3);
  });

  it.each(['', '   ', undefined])('counts a Boolean position with metadata value %j separately from literal "1" and empty answers', async value => {
    const values = value === undefined ? undefined : [{ value, label: 'Option A' }];
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI',
          type: 'boolean',
          multiple: true,
          hasCodingScheme: false,
          values,
          valuePositionLabels: ['Option A']
        }]
      }],
      queryResults: [[], [], ['[true]', '["1"]', '[]'].map((response, index) => ({
        responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value: response, status: 3
      }))]
    });

    await processor.processWorkspaceJob(createJob());

    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        totalCount: 3, validCount: 2, emptyCount: 1, distinctValueCount: 3
      })
    ]);
    const [[, rows]] = findCacheSetPayload<Array<[string, VariableFrequencyDto[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: '1', position: 1, label: 'Option A', count: 1, validOccurrenceCount: 1, percentageValid: 50, isEmptyValue: false
      }),
      expect.objectContaining({
        value: '1', position: undefined, label: undefined, count: 1, validOccurrenceCount: 1, percentageValid: 50, isEmptyValue: false
      }),
      expect.objectContaining({
        value: '', label: undefined, count: 1, validOccurrenceCount: 0, percentageValid: 0, isEmptyValue: true
      })
    ]));
  });

  it('keeps a rare selected Boolean position separate from literal "1" and the empty row', async () => {
    const otherPositionsSelected = [false, ...Array<boolean>(20).fill(true)];
    const responses = [
      [true, ...Array<boolean>(20).fill(false)],
      Array<boolean>(21).fill(false),
      ['1'],
      otherPositionsSelected,
      otherPositionsSelected
    ];
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI',
          type: 'boolean',
          multiple: true,
          hasCodingScheme: false,
          values: [{ value: '   ', label: 'Option A' }]
        }]
      }],
      queryResults: [[], [], responses.map((response, index) => ({
        responseId: index + 1,
        unitName: 'UNIT',
        variableId: 'MULTI',
        value: JSON.stringify(response),
        status: 3
      }))]
    });

    await processor.processWorkspaceJob(createJob());

    const [[, rows]] = findCacheSetPayload<Array<[string, VariableFrequencyDto[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(rows.filter(row => row.isEmptyValue)).toEqual([
      expect.objectContaining({ value: '', count: 1, validOccurrenceCount: 0 })
    ]);
    expect(rows).toContainEqual(expect.objectContaining({
      value: '1',
      position: 1,
      label: 'Option A',
      isEmptyValue: false,
      isSchemaSupplemental: true,
      count: 1,
      validOccurrenceCount: 1
    }));
  });

  it.each([
    { first: '[true]', second: '["1"]' },
    { first: '["1"]', second: '[true]' }
  ])('keeps the same twentieth category when $first precedes $second', async ({ first, second }) => {
    const frequentPositions = JSON.stringify([false, ...Array<boolean>(19).fill(true)]);
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI', type: 'boolean', multiple: true, hasCodingScheme: false
        }]
      }],
      queryResults: [[], [], [frequentPositions, frequentPositions, first, second, '[]'].map((value, index) => ({
        responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value, status: 3
      }))]
    });

    await processor.processWorkspaceJob(createJob());

    const [[, rows]] = findCacheSetPayload<Array<[string, VariableFrequencyDto[]]>>(
      cacheService, 'variable-analysis:1:job-1:frequencies:0'
    );
    expect(rows).toHaveLength(21);
    expect(rows.filter(row => row.count === 2)).toHaveLength(19);
    expect(rows.filter(row => row.value === '1')).toEqual([
      expect.objectContaining({ position: 1, count: 1 })
    ]);
    expect(rows).toContainEqual(expect.objectContaining({ value: '', count: 1, isEmptyValue: true }));
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

    await processor.processWorkspaceJob(createJob());

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
  it('preserves the text null in multiple responses while excluding actual null entries', async () => {
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI', alias: 'MULTI', type: 'string', multiple: true, hasCodingScheme: false
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'MULTI', totalCount: 5, emptyCount: 0, distinctValueCount: 5
        }],
        [],
        ['null', '["null",null,"NULL"]', null, '[null]', '[false,false]'].map((value, index) => ({
          responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value, status: 3
        })),
        [], []
      ]
    });

    await processor.processWorkspaceJob(createJob());

    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        totalCount: 5, validCount: 2, invalidCount: 3, emptyCount: 3, distinctValueCount: 3
      })
    ]);
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:frequencies:0')).toEqual([
      ['1:MULTI', expect.arrayContaining([
        expect.objectContaining({
          value: 'null', count: 2, validOccurrenceCount: 2, percentageValid: 100
        }),
        expect.objectContaining({
          value: 'NULL', count: 1, validOccurrenceCount: 1, percentageValid: 50
        })
      ])]
    ]);
  });

  it.each(['values', 'codes'] as const)('preserves list-like text categories and raw emptiness in %s analyses', async analysisMode => {
    const rawValues = ['["[]"]', '["[false]"]', '["[]","A","[]"]', '"[]"', '[]', '[false,false]', '[null]', '["",null," \u00a0"]'];
    const { processor, cacheService } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'MULTI',
          alias: 'MULTI',
          type: 'string',
          multiple: true,
          hasCodingScheme: false,
          values: [{ value: '[false,false]', label: 'Literal category' }]
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'MULTI', totalCount: 8, validCount: 8, emptyCount: 2, distinctValueCount: 1
        }],
        analysisMode === 'codes' ? [{
          unitName: 'UNIT', variableId: 'MULTI', value: '5:0', valueLength: 3, count: 8, validCount: 8
        }] : [],
        rawValues.map((value, index) => ({
          responseId: index + 1, unitName: 'UNIT', variableId: 'MULTI', value, status: 3
        })),
        []
      ]
    });

    await processor.processWorkspaceJob(createJob({ analysisMode }));

    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        totalCount: 8,
        validCount: analysisMode === 'values' ? 4 : 8,
        invalidCount: analysisMode === 'values' ? 4 : 0,
        emptyCount: 4,
        emptyPercentage: 50,
        distinctValueCount: analysisMode === 'values' ? 4 : 1
      })
    ]);
    const rows = analysisMode === 'values' ? [
      expect.objectContaining({
        value: '[]', count: 3, validOccurrenceCount: 3, percentageValid: 75, isEmptyValue: false
      }),
      expect.objectContaining({
        value: '[false]', count: 1, validOccurrenceCount: 1, percentageValid: 25, isEmptyValue: false
      }),
      expect.objectContaining({
        value: 'A', count: 1, validOccurrenceCount: 1, percentageValid: 25, isEmptyValue: false
      }),
      expect.objectContaining({
        value: '', count: 4, validOccurrenceCount: 0, percentageValid: 0, isEmptyValue: true
      }),
      expect.objectContaining({
        value: '[false,false]', count: 0, isSchemaOnly: true, isEmptyValue: false
      })
    ] : [expect.objectContaining({
      value: '0', count: 8, validOccurrenceCount: 8, percentageValid: 100, isEmptyValue: false
    })];
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:frequencies:0')).toEqual([
      ['1:MULTI', expect.arrayContaining(rows)]
    ]);
  });

  it.each(['v1', 'v2', 'v3'] as const)('counts assigned codes from %s with their schema metadata, independently of raw categories', async codingVersion => {
    const { processor, cacheService, analysisQuery } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'VAR',
          alias: 'VAR',
          type: 'string',
          hasCodingScheme: true,
          multiple: true,
          codes: [{ id: 0, label: 'Incorrect', score: 0 }, { id: 1, label: 'Correct' }, { id: 2, label: 'Unobserved' }],
          values: [{ value: '0', label: 'Raw option zero' }]
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: '4', validCount: '3', emptyCount: '1', distinctValueCount: '3'
        }],
        [
          {
            unitName: 'UNIT', variableId: 'VAR', value: '5:0', valueLength: 3, count: '2', validCount: '2'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: '5:1', valueLength: 3, count: '1', validCount: '1'
          },
          {
            unitName: 'UNIT', variableId: 'VAR', value: '', valueLength: 0, count: '1', validCount: '0'
          }
        ],
        ['["A","B"]', '["A"]', '["B"]', '[null]'].map((value, index) => ({
          responseId: index + 1, unitName: 'UNIT', variableId: 'VAR', value, status: 3
        })),
        [],
        [{
          unitName: 'UNIT', variableId: 'VAR', status: '5', count: '3'
        }, {
          unitName: 'UNIT', variableId: 'VAR', status: '0', count: '1'
        }]
      ]
    });
    await processor.processWorkspaceJob(createJob({ analysisMode: 'codes', codingVersion }));
    expect(analysisQuery.addSelect).toHaveBeenCalledWith(expect.stringContaining(`CAST(response.code_${codingVersion} AS text)`), 'value');
    expect(analysisQuery.addSelect).toHaveBeenCalledWith(`response.status_${codingVersion}`, 'status');
    const validity = analysisQuery.addSelect.mock.calls.find(([, alias]) => alias === 'analysisValid')?.[0];
    expect(validity).toContain(`response.code_${codingVersion} IS NOT NULL`);
    expect(validity).toContain(`response.status_${codingVersion} IN (5, 12)`);
    expect(validity).not.toContain('score');
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:variable-combos:0')).toEqual([
      expect.objectContaining({
        analysisMode: 'codes', codingVersion, totalCount: 4, validCount: 3, invalidCount: 1, emptyCount: 1
      })
    ]);
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:frequencies:0')).toEqual([
      ['1:VAR', [
        expect.objectContaining({
          value: '0', label: 'Incorrect', score: 0, count: 2, validOccurrenceCount: 2, percentageTotal: 50, percentageValid: (2 / 3) * 100
        }),
        expect.objectContaining({
          value: '1', label: 'Correct', score: undefined, count: 1, validOccurrenceCount: 1, percentageTotal: 25, percentageValid: (1 / 3) * 100
        }),
        expect.objectContaining({
          value: '', count: 1, validOccurrenceCount: 0, percentageValid: 0
        }),
        expect.objectContaining({
          value: '2', label: 'Unobserved', count: 0, isSchemaOnly: true
        })
      ]]
    ]);
  });

  it('uses raw value labels without borrowing metadata or validity from a matching code ID', async () => {
    const { processor, cacheService, analysisQuery } = createProcessor({
      unitVariableDetails: [{
        unitName: 'UNIT',
        unitId: 'UNIT',
        variables: [{
          id: 'VAR',
          alias: 'VAR',
          type: 'string',
          hasCodingScheme: true,
          values: [{ value: '1', label: 'Raw option' }],
          codes: [{ id: 1, label: 'Unrelated code', score: 99 }, { id: 2, label: 'Unobserved code', score: 1 }]
        }]
      }],
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: 2, validCount: 1, emptyCount: 1, distinctValueCount: 2
        }],
        [{
          unitName: 'UNIT', variableId: 'VAR', value: '1', count: 1, validCount: 1, valueLength: 1
        }, {
          unitName: 'UNIT', variableId: 'VAR', value: '', count: 1, validCount: 0, valueLength: 0
        }],
        [], []
      ]
    });
    await processor.processWorkspaceJob(createJob());
    const validity = analysisQuery.addSelect.mock.calls.find(([, alias]) => alias === 'analysisValid')?.[0];
    expect(validity).toContain('response.status');
    expect(validity).not.toContain('status_v1');
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:frequencies:0')).toEqual([
      ['1:VAR', [
        expect.objectContaining({ value: '1', label: 'Raw option', score: undefined }),
        expect.objectContaining({ value: '', validOccurrenceCount: 0 })
      ]]
    ]);
  });

  it('leaves valid percentages undefined if all responses are invalid', async () => {
    const { processor, cacheService } = createProcessor({
      queryResults: [
        [{
          unitName: 'UNIT', variableId: 'VAR', totalCount: 1, validCount: 0, emptyCount: 1, distinctValueCount: 1
        }],
        [{
          unitName: 'UNIT', variableId: 'VAR', value: '', count: 1, validCount: 0, valueLength: 0
        }], []
      ]
    });
    await processor.processWorkspaceJob(createJob({ analysisMode: 'codes' }));
    expect(findCacheSetPayload(cacheService, 'variable-analysis:1:job-1:frequencies:0')).toEqual([
      ['1:VAR', expect.arrayContaining([expect.objectContaining({ value: '', percentageValid: null })])]
    ]);
  });
});
