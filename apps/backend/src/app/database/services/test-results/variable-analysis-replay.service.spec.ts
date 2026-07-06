import { VariableAnalysisReplayService } from './variable-analysis-replay.service';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { CodingListService } from '../coding/coding-list.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

const VARIABLE_PAIR_SEPARATOR = '\u001F';
const UNSET_STATUS = 0;
const CODING_COMPLETE_STATUS = 5;
const CODING_INCOMPLETE_STATUS = 8;

interface ResponseFixtureRow {
  unitId: string;
  variableId: string;
  code_v1: string | null;
  score_v1: number | null;
  status_v1?: number | null;
  consider?: boolean;
  loginName?: string;
  loginCode?: string;
  loginGroup?: string;
  bookletId?: string;
}

interface MockQueryBuilder {
  params: Record<string, unknown>;
  alwaysFalse: boolean;
  offsetValue: number;
  limitValue?: number;
  select: jest.Mock;
  addSelect: jest.Mock;
  leftJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

type QueryKind = 'count' | 'aggregation' | 'totalCounts' | 'sampleInfo';

const toVariablePairKey = (unitId: string, variableId: string): string => (
  `${unitId}${VARIABLE_PAIR_SEPARATOR}${variableId}`
);

const toAggregationKey = (row: ResponseFixtureRow): string => (
  `${row.unitId}${VARIABLE_PAIR_SEPARATOR}${row.variableId}${VARIABLE_PAIR_SEPARATOR}${row.code_v1 ?? ''}`
);

const compareNullableNumericCode = (left: string | null, right: string | null): number => {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  return Number(left) - Number(right);
};

const createQueryBuilder = (
  kind: QueryKind,
  responseRows: ResponseFixtureRow[]
): MockQueryBuilder => {
  const qb = {
    params: {},
    alwaysFalse: false,
    offsetValue: 0
  } as MockQueryBuilder;

  const mergeParams = (condition?: string, params?: Record<string, unknown>): MockQueryBuilder => {
    if (condition === '1 = 0') {
      qb.alwaysFalse = true;
    }
    if (params) {
      qb.params = { ...qb.params, ...params };
    }
    return qb;
  };

  const chainMethods: Array<keyof Pick<
  MockQueryBuilder,
  'select' | 'addSelect' | 'leftJoin' | 'groupBy' | 'addGroupBy' | 'orderBy' | 'addOrderBy'
  >> = ['select', 'addSelect', 'leftJoin', 'groupBy', 'addGroupBy', 'orderBy', 'addOrderBy'];

  chainMethods.forEach(method => {
    qb[method] = jest.fn(() => qb);
  });

  qb.where = jest.fn(mergeParams);
  qb.andWhere = jest.fn(mergeParams);
  qb.offset = jest.fn((value: number) => {
    qb.offsetValue = value;
    return qb;
  });
  qb.limit = jest.fn((value: number) => {
    qb.limitValue = value;
    return qb;
  });

  qb.getRawOne = jest.fn(async () => ({
    count: getAggregatedRows(filterRows(responseRows, qb)).length.toString()
  }));

  qb.getRawMany = jest.fn(async () => {
    const filteredRows = filterRows(responseRows, qb);

    if (kind === 'aggregation') {
      const aggregatedRows = getAggregatedRows(filteredRows);
      const end = qb.limitValue === undefined ? undefined : qb.offsetValue + qb.limitValue;
      return aggregatedRows.slice(qb.offsetValue, end);
    }

    if (kind === 'totalCounts') {
      return getTotalCountRows(filteredRows);
    }

    if (kind === 'sampleInfo') {
      return getSampleInfoRows(filteredRows);
    }

    return [];
  });

  return qb;
};

const filterRows = (
  responseRows: ResponseFixtureRow[],
  qb: MockQueryBuilder
): ResponseFixtureRow[] => {
  if (qb.alwaysFalse) {
    return [];
  }

  let filteredRows = [...responseRows];
  const unitIdFilter = getLikeFilter(qb.params.unitId);
  const variableIdFilter = getLikeFilter(qb.params.variableId);
  const variableIdRegexFilter = [
    qb.params.variableIdRegex,
    qb.params.aggregationVariableIdRegex,
    qb.params.totalCountVariableIdRegex
  ].find((value): value is string => typeof value === 'string');
  const ignoredCodingStatuses = Object.entries(qb.params)
    .find(([key, value]) => (
      key.endsWith('IgnoredStatuses') &&
      Array.isArray(value)
    ))?.[1] as number[] | undefined;
  const considerFilter = Object.entries(qb.params)
    .find(([key]) => key.endsWith('Consider'))?.[1];
  const pairKeyFilters = Object.values(qb.params)
    .filter((value): value is string[] => (
      Array.isArray(value) &&
      value.every(item => typeof item === 'string' && item.includes(VARIABLE_PAIR_SEPARATOR))
    ));

  if (typeof considerFilter === 'boolean') {
    filteredRows = filteredRows.filter(row => (row.consider ?? true) === considerFilter);
  }

  if (ignoredCodingStatuses) {
    filteredRows = filteredRows.filter(row => {
      if (row.status_v1 === null || row.status_v1 === undefined) {
        return false;
      }
      return !ignoredCodingStatuses.includes(row.status_v1);
    });
  }

  if (unitIdFilter) {
    filteredRows = filteredRows.filter(row => row.unitId.includes(unitIdFilter));
  }

  if (variableIdFilter) {
    filteredRows = filteredRows.filter(row => row.variableId.includes(variableIdFilter));
  }

  if (variableIdRegexFilter) {
    const variableIdRegex = new RegExp(variableIdRegexFilter);
    filteredRows = filteredRows.filter(row => variableIdRegex.test(row.variableId));
  }

  pairKeyFilters.forEach(pairKeys => {
    filteredRows = filteredRows.filter(row => pairKeys.includes(toVariablePairKey(row.unitId, row.variableId)));
  });

  return filteredRows;
};

const getLikeFilter = (value: unknown): string => (
  typeof value === 'string' ? value.replace(/%/g, '') : ''
);

const getAggregatedRows = (rows: ResponseFixtureRow[]) => {
  const groupedRows = new Map<string, {
    unitId: string;
    variableId: string;
    code_v1: string | null;
    occurrenceCount: number;
    score_V1: number;
  }>();

  rows.forEach(row => {
    const key = toAggregationKey(row);
    const existing = groupedRows.get(key);

    if (existing) {
      existing.occurrenceCount += 1;
      existing.score_V1 = Math.max(existing.score_V1, row.score_v1 ?? 0);
      return;
    }

    groupedRows.set(key, {
      unitId: row.unitId,
      variableId: row.variableId,
      code_v1: row.code_v1,
      occurrenceCount: 1,
      score_V1: row.score_v1 ?? 0
    });
  });

  return Array.from(groupedRows.values())
    .sort((a, b) => (
      a.unitId.localeCompare(b.unitId) ||
      a.variableId.localeCompare(b.variableId) ||
      compareNullableNumericCode(a.code_v1, b.code_v1)
    ))
    .map(row => ({
      ...row,
      occurrenceCount: row.occurrenceCount.toString(),
      score_V1: row.score_V1.toString()
    }));
};

const getTotalCountRows = (rows: ResponseFixtureRow[]) => {
  const groupedRows = new Map<string, { unitId: string; variableId: string; totalCount: number }>();

  rows.forEach(row => {
    const key = toVariablePairKey(row.unitId, row.variableId);
    const existing = groupedRows.get(key);

    if (existing) {
      existing.totalCount += 1;
      return;
    }

    groupedRows.set(key, {
      unitId: row.unitId,
      variableId: row.variableId,
      totalCount: 1
    });
  });

  return Array.from(groupedRows.values()).map(row => ({
    ...row,
    totalCount: row.totalCount.toString()
  }));
};

const getSampleInfoRows = (rows: ResponseFixtureRow[]) => {
  const groupedRows = new Map<string, {
    unitId: string;
    variableId: string;
    code_v1: string | null;
    loginName: string;
    loginCode: string;
    loginGroup: string;
    bookletId: string;
  }>();

  rows.forEach(row => {
    const key = toAggregationKey(row);
    if (groupedRows.has(key)) {
      return;
    }

    groupedRows.set(key, {
      unitId: row.unitId,
      variableId: row.variableId,
      code_v1: row.code_v1,
      loginName: row.loginName || 'login',
      loginCode: row.loginCode || 'code',
      loginGroup: row.loginGroup || 'group',
      bookletId: row.bookletId || 'booklet'
    });
  });

  return Array.from(groupedRows.values());
};

describe('VariableAnalysisReplayService', () => {
  let service: VariableAnalysisReplayService;
  let fileUploadRepository: { find: jest.Mock };
  let responseRepository: { createQueryBuilder: jest.Mock; manager: { connection: { createQueryRunner: jest.Mock } } };
  let workspaceFilesService: { getUnitVariableMap: jest.Mock };
  let codingListService: { getVariablePageMap: jest.Mock };
  let workspaceExclusionService: { resolveExclusionsForQueries: jest.Mock };

  const responseRows: ResponseFixtureRow[] = [
    {
      unitId: 'MDB002',
      variableId: '00',
      code_v1: '9',
      score_v1: 0,
      status_v1: CODING_COMPLETE_STATUS
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: '0',
      score_v1: 0,
      status_v1: CODING_COMPLETE_STATUS,
      loginName: 'login-code-0',
      loginCode: 'person-0',
      loginGroup: 'group-0',
      bookletId: 'booklet-0'
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: '1',
      score_v1: 1,
      status_v1: CODING_COMPLETE_STATUS,
      loginName: 'login-code-1',
      loginCode: 'person-1',
      loginGroup: 'group-1',
      bookletId: 'booklet-1'
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: null,
      score_v1: null,
      status_v1: CODING_INCOMPLETE_STATUS,
      loginName: 'login-code-empty',
      loginCode: 'person-empty',
      loginGroup: 'group-empty',
      bookletId: 'booklet-empty'
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: null,
      score_v1: null,
      status_v1: null
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: '0',
      score_v1: 0,
      status_v1: UNSET_STATUS
    },
    {
      unitId: 'MDB002',
      variableId: '01',
      code_v1: '1',
      score_v1: 1,
      status_v1: CODING_COMPLETE_STATUS,
      consider: false
    },
    {
      unitId: 'MDB002',
      variableId: '02',
      code_v1: '0',
      score_v1: 0,
      status_v1: CODING_COMPLETE_STATUS
    }
  ];

  beforeEach(() => {
    const queryKinds: QueryKind[] = ['count', 'aggregation', 'totalCounts', 'sampleInfo'];

    fileUploadRepository = {
      find: jest.fn().mockResolvedValue([
        {
          file_id: 'MDB002.VOCS',
          data: JSON.stringify({
            variableCodings: [
              { id: '01', sourceType: 'BASE', label: 'Variable 01' },
              { id: '02', sourceType: 'DERIVED', label: 'Variable 02' }
            ]
          })
        }
      ])
    };
    responseRepository = {
      createQueryBuilder: jest.fn(() => (
        createQueryBuilder(
          queryKinds[responseRepository.createQueryBuilder.mock.calls.length - 1],
          responseRows
        )
      )),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue({
            connect: jest.fn().mockResolvedValue(undefined),
            startTransaction: jest.fn().mockResolvedValue(undefined),
            query: jest.fn().mockResolvedValue(undefined),
            commitTransaction: jest.fn().mockResolvedValue(undefined),
            rollbackTransaction: jest.fn().mockResolvedValue(undefined),
            release: jest.fn().mockResolvedValue(undefined)
          })
        }
      }
    };
    workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
        ['MDB002', new Set(['01', '02'])]
      ]))
    };
    codingListService = {
      getVariablePageMap: jest.fn().mockResolvedValue(new Map([
        ['01', '1'],
        ['02', '2']
      ]))
    };
    workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    service = new VariableAnalysisReplayService(
      fileUploadRepository as unknown as import('typeorm').Repository<FileUpload>,
      responseRepository as unknown as import('typeorm').Repository<ResponseEntity>,
      workspaceFilesService as unknown as WorkspaceFilesService,
      codingListService as unknown as CodingListService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );
  });

  it('counts and paginates only variables from the workspace unit-variable map', async () => {
    const result = await service.getVariableAnalysis(7, 'token', 'http://server', 1, 1);

    expect(result.total).toBe(4);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      unitId: 'MDB002',
      variableId: '01',
      code: '0',
      occurrenceCount: 1,
      totalCount: 3,
      relativeOccurrence: 1 / 3
    });
    expect(result.data[0].replayUrl).toContain('/MDB002/1/01?auth=token&workspaceId=7');
    expect(result.data[0].replayUrl).toContain('login-code-0@person-0@group-0@booklet-0');
  });

  it('uses a replay sample from the matching code group for each distribution row', async () => {
    const result = await service.getVariableAnalysis(7, 'token', 'http://server', 1, 10);
    const rowByAggregationKey = new Map(result.data.map(row => [
      `${row.unitId}${VARIABLE_PAIR_SEPARATOR}${row.variableId}${VARIABLE_PAIR_SEPARATOR}${row.code}`,
      row
    ]));

    expect(rowByAggregationKey.get(`MDB002${VARIABLE_PAIR_SEPARATOR}01${VARIABLE_PAIR_SEPARATOR}`)?.replayUrl)
      .toContain('login-code-empty@person-empty@group-empty@booklet-empty');
    expect(rowByAggregationKey.get(`MDB002${VARIABLE_PAIR_SEPARATOR}01${VARIABLE_PAIR_SEPARATOR}0`)?.replayUrl)
      .toContain('login-code-0@person-0@group-0@booklet-0');
    expect(rowByAggregationKey.get(`MDB002${VARIABLE_PAIR_SEPARATOR}01${VARIABLE_PAIR_SEPARATOR}1`)?.replayUrl)
      .toContain('login-code-1@person-1@group-1@booklet-1');
  });

  it('keeps incomplete empty-code responses but excludes reset, ignored-status and unconsidered responses', async () => {
    const result = await service.getVariableAnalysis(
      7,
      'token',
      'http://server',
      1,
      10,
      undefined,
      '01'
    );

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        variableId: '01',
        code: '',
        occurrenceCount: 1,
        totalCount: 3,
        relativeOccurrence: 1 / 3
      }),
      expect.objectContaining({
        variableId: '01',
        code: '0',
        occurrenceCount: 1,
        totalCount: 3,
        relativeOccurrence: 1 / 3
      }),
      expect.objectContaining({
        variableId: '01',
        code: '1',
        occurrenceCount: 1,
        totalCount: 3,
        relativeOccurrence: 1 / 3
      })
    ]));
  });

  it('applies the derivation filter before counting and paginating', async () => {
    const result = await service.getVariableAnalysis(
      7,
      'token',
      'http://server',
      1,
      1,
      undefined,
      undefined,
      'derived'
    );

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      unitId: 'MDB002',
      variableId: '02',
      derivation: 'DERIVED',
      totalCount: 1
    });
    expect(result.data[0].replayUrl).toContain('/MDB002/2/02?auth=token&workspaceId=7');
  });

  it('prefers coding scheme aliases over colliding technical ids for analysis metadata', async () => {
    fileUploadRepository.find.mockResolvedValueOnce([
      {
        file_id: 'MDB002.VOCS',
        data: JSON.stringify({
          variableCodings: [
            {
              id: '02',
              alias: '01',
              sourceType: 'BASE',
              label: 'Technische Variable 02'
            },
            {
              id: '07',
              alias: '02',
              sourceType: 'DERIVED',
              label: 'Sichtbare Variable 02'
            }
          ]
        })
      }
    ]);
    workspaceFilesService.getUnitVariableMap.mockResolvedValueOnce(new Map([
      ['MDB002', new Set(['02'])]
    ]));

    const result = await service.getVariableAnalysis(
      7,
      'token',
      'http://server',
      1,
      10,
      undefined,
      undefined,
      'derived'
    );

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      unitId: 'MDB002',
      variableId: '02',
      derivation: 'DERIVED',
      description: 'Sichtbare Variable 02'
    });
  });

  it('uses a regex variable filter when requested', async () => {
    const result = await service.getVariableAnalysis(
      7,
      'token',
      'http://server',
      1,
      10,
      undefined,
      '^0[12]$',
      undefined,
      true
    );

    expect(result.total).toBe(4);
    expect(result.data.map(row => row.variableId)).toEqual(['01', '01', '01', '02']);
  });
});
