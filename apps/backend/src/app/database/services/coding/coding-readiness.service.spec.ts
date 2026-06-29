import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import { CodingReadinessService } from './coding-readiness.service';

type QueryBuilderMock = {
  leftJoin: jest.Mock;
  innerJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
  getRawMany: jest.Mock;
  getRawOne: jest.Mock;
};

type ReadinessFixture = {
  units: Unit[];
  rawResponsesTotal: number;
  activePersonHash?: string;
  candidateRows: Array<{
    unitid: number | string;
    variableid: string;
    response_count: number | string;
  }>;
  candidateResponsesTotal?: number;
  unitFiles: FileUpload[];
  codingSchemeFiles?: FileUpload[];
  unitVariableMap: Map<string, Set<string>>;
};

type ReadinessQueryMocks = {
  unitQuery: QueryBuilderMock;
  countQuery: QueryBuilderMock;
  candidateQuery: QueryBuilderMock;
  fileUploadRepository: {
    find: jest.Mock;
  };
  responseRepository: {
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
  };
  workspaceFilesService: {
    getUnitVariableMap: jest.Mock;
  };
};

const createQueryBuilderMock = (): QueryBuilderMock => {
  const queryBuilder = {
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    getMany: jest.fn(),
    getCount: jest.fn(),
    getRawMany: jest.fn(),
    getRawOne: jest.fn()
  } as QueryBuilderMock;

  Object.values(queryBuilder)
    .filter(value => jest.isMockFunction(value))
    .forEach(mock => mock.mockReturnValue(queryBuilder));

  return queryBuilder;
};

const createUnit = (
  id: number,
  name: string,
  alias: string = name
): Unit => ({
  id,
  name,
  alias
} as Unit);

const createFile = (
  fileId: string,
  data: string = ''
): FileUpload => ({
  file_id: fileId,
  filename: `${fileId}.xml`,
  data
} as FileUpload);

const createCodingScheme = (variableId: string): string => JSON.stringify({
  variableCodings: [{
    id: variableId,
    alias: variableId,
    sourceType: 'BASE',
    codes: []
  }]
});

const createResponse = (
  id: number,
  unitid: number,
  variableid: string,
  value: string | null = 'value'
): ResponseEntity => ({
  id,
  unitid,
  variableid,
  value
} as ResponseEntity);

const createService = (
  fixture: ReadinessFixture,
  queryMocks?: Partial<ReadinessQueryMocks>
): CodingReadinessService => {
  const unitQuery = createQueryBuilderMock();
  unitQuery.getMany.mockResolvedValue(fixture.units);

  const countQuery = createQueryBuilderMock();
  countQuery.getCount.mockResolvedValue(fixture.rawResponsesTotal);
  countQuery.getRawOne.mockResolvedValue({
    raw_responses_total: fixture.rawResponsesTotal,
    raw_responses_with_relevant_status:
      fixture.candidateResponsesTotal ??
      fixture.candidateRows.reduce(
        (sum, row) => sum + Number(row.response_count || 0),
        0
      )
  });

  const candidateQuery = createQueryBuilderMock();
  candidateQuery.getRawMany.mockResolvedValue(fixture.candidateRows);
  candidateQuery.getCount.mockResolvedValue(
    fixture.candidateResponsesTotal ??
      fixture.candidateRows.reduce(
        (sum, row) => sum + Number(row.response_count || 0),
        0
      )
  );

  const fileRevisionQuery = createQueryBuilderMock();
  fileRevisionQuery.getRawOne.mockResolvedValue({
    file_count: fixture.unitFiles.length + (fixture.codingSchemeFiles || []).length,
    max_created_at: '2026-05-20T08:00:00.000Z'
  });

  const responseRepository = {
    createQueryBuilder: jest.fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(candidateQuery),
    query: jest.fn().mockImplementation((query: string) => {
      if (query.includes('FROM persons')) {
        return Promise.resolve([{
          active_count: '1',
          active_hash: fixture.activePersonHash || 'active-person-hash'
        }]);
      }
      return Promise.resolve([{ revision: 1 }]);
    })
  };
  const unitRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(unitQuery)
  };
  const fileUploadRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(fileRevisionQuery),
    find: jest.fn()
      .mockResolvedValueOnce(fixture.unitFiles)
      .mockResolvedValueOnce(fixture.codingSchemeFiles || [])
  };
  const workspaceFilesService = {
    getUnitVariableMap: jest.fn().mockResolvedValue(fixture.unitVariableMap)
  };
  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  };

  Object.assign(queryMocks || {}, {
    unitQuery,
    countQuery,
    candidateQuery,
    fileUploadRepository,
    responseRepository,
    workspaceFilesService
  });

  return new CodingReadinessService(
    responseRepository as never,
    unitRepository as never,
    fileUploadRepository as never,
    workspaceFilesService as never,
    workspaceExclusionService as never
  );
};

describe('CodingReadinessService', () => {
  it('uses array parameters for large scoped unit filters', async () => {
    const queryMocks: Partial<ReadinessQueryMocks> = {};
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK'),
        createUnit(2, 'UNIT_OTHER')
      ],
      rawResponsesTotal: 2,
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 1 },
        { unitid: 2, variableid: 'var2', response_count: 1 }
      ],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>'),
        createFile('UNIT_OTHER', '<Unit><codingSchemeRef>SCHEME_OTHER</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1')),
        createFile('SCHEME_OTHER', createCodingScheme('var2'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])],
        ['UNIT_OTHER', new Set(['var2'])]
      ])
    }, queryMocks);

    await service.getReadiness(1, {
      forceRefresh: true,
      unitIds: [1, 2],
      personIds: ['11', '12']
    });

    expect(queryMocks.unitQuery?.andWhere).toHaveBeenCalledWith(
      'person.id = ANY(:personIds)',
      { personIds: [11, 12] }
    );
    expect(queryMocks.unitQuery?.andWhere).toHaveBeenCalledWith(
      'unit.id = ANY(:unitIds)',
      { unitIds: [1, 2] }
    );
    expect(queryMocks.countQuery?.andWhere).toHaveBeenCalledWith(
      'unit.id = ANY(:unitIds)',
      { unitIds: [1, 2] }
    );
    expect(queryMocks.candidateQuery?.andWhere).toHaveBeenCalledWith(
      'unit.id = ANY(:unitIds)',
      { unitIds: [1, 2] }
    );
  });

  it('invalidates cached and in-flight readiness entries for a workspace', () => {
    const service = createService({
      units: [],
      rawResponsesTotal: 0,
      candidateRows: [],
      unitFiles: [],
      unitVariableMap: new Map()
    });
    const internals = service as unknown as {
      readinessCache: Map<string, unknown>;
      readinessInFlight: Map<string, unknown>;
      cacheRevisionByWorkspace: Map<number, number>;
    };
    internals.readinessCache.set('1|1|1|files|0|scope', {});
    internals.readinessCache.set('2|1|1|files|0|scope', {});
    internals.readinessInFlight.set('1|1|1|files|0|scope', Promise.resolve({}));
    internals.cacheRevisionByWorkspace.set(1, 4);

    service.invalidateWorkspaceReadinessCache(1);

    expect(internals.readinessCache.has('1|1|1|files|0|scope')).toBe(false);
    expect(internals.readinessCache.has('2|1|1|files|0|scope')).toBe(true);
    expect(internals.readinessInFlight.has('1|1|1|files|0|scope')).toBe(false);
    expect(internals.cacheRevisionByWorkspace.get(1)).toBe(5);
  });

  it('returns summary readiness without loading units, variables or files', async () => {
    const queryMocks: Partial<ReadinessQueryMocks> = {};
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK')
      ],
      rawResponsesTotal: 3,
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 3 }
      ],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])]
      ])
    }, queryMocks);

    const readiness = await service.getReadiness(1, {
      forceRefresh: true,
      detailLevel: 'summary'
    });

    expect(readiness).toMatchObject({
      detailLevel: 'summary',
      detailsComplete: false,
      readiness: 'DIAGNOSTICS_PENDING',
      rawResponsesTotal: 3,
      rawResponsesWithRelevantStatus: 3,
      validResponses: 0,
      potentialCodeableResponses: 3,
      codeableResponses: 0,
      matchedUnitFiles: 0,
      matchedCodingSchemes: 0
    });
    expect(queryMocks.unitQuery?.getMany).not.toHaveBeenCalled();
    expect(queryMocks.countQuery?.getRawOne).toHaveBeenCalledTimes(1);
    expect(queryMocks.candidateQuery?.getCount).not.toHaveBeenCalled();
    expect(queryMocks.candidateQuery?.getRawMany).not.toHaveBeenCalled();
    expect(queryMocks.fileUploadRepository?.find).not.toHaveBeenCalled();
    expect(
      queryMocks.workspaceFilesService?.getUnitVariableMap
    ).not.toHaveBeenCalled();
  });

  it('does not reuse workspace-wide summary readiness when active persons changed', async () => {
    const queryMocks: Partial<ReadinessQueryMocks> = {};
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK')
      ],
      rawResponsesTotal: 3,
      activePersonHash: 'first-active-set',
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 3 }
      ],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])]
      ])
    }, queryMocks);
    queryMocks.responseRepository?.createQueryBuilder.mockReturnValue(
      queryMocks.countQuery
    );

    await service.getReadiness(1, {
      detailLevel: 'summary'
    });
    queryMocks.responseRepository?.createQueryBuilder.mockReset();
    queryMocks.responseRepository?.createQueryBuilder.mockReturnValue(
      queryMocks.countQuery
    );
    queryMocks.responseRepository?.query.mockImplementation((query: string) => {
      if (query.includes('FROM persons')) {
        return Promise.resolve([{
          active_count: '2',
          active_hash: 'second-active-set'
        }]);
      }
      return Promise.resolve([{ revision: 1 }]);
    });
    queryMocks.countQuery?.getRawOne.mockReset();
    queryMocks.countQuery?.getRawOne.mockResolvedValue({
      raw_responses_total: 7,
      raw_responses_with_relevant_status: 5
    });

    const readiness = await service.getReadiness(1, {
      detailLevel: 'summary'
    });

    expect(readiness.rawResponsesTotal).toBe(7);
    expect(readiness.rawResponsesWithRelevantStatus).toBe(5);
    expect(readiness.fromCache).toBe(false);
    expect(queryMocks.countQuery?.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('can block from summary readiness when no relevant candidate responses exist', async () => {
    const queryMocks: Partial<ReadinessQueryMocks> = {};
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK')
      ],
      rawResponsesTotal: 2,
      candidateResponsesTotal: 0,
      candidateRows: [],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])]
      ])
    }, queryMocks);

    const readiness = await service.getReadiness(1, {
      forceRefresh: true,
      detailLevel: 'summary'
    });

    expect(readiness).toMatchObject({
      detailLevel: 'summary',
      detailsComplete: true,
      readiness: 'BLOCKED',
      validResponses: 0,
      codeableResponses: 0
    });
    expect(readiness.blockers).toEqual(['NO_RELEVANT_RESPONSES']);
    expect(queryMocks.fileUploadRepository?.find).not.toHaveBeenCalled();
    expect(
      queryMocks.workspaceFilesService?.getUnitVariableMap
    ).not.toHaveBeenCalled();
  });

  it('keeps missing files as diagnostics without blocking partially codeable data', async () => {
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK'),
        createUnit(2, 'UNIT_MISSING')
      ],
      rawResponsesTotal: 2,
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 1 },
        { unitid: 2, variableid: 'var2', response_count: 1 }
      ],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])],
        ['UNIT_MISSING', new Set(['var2'])]
      ])
    });

    const readiness = await service.getReadiness(1, { forceRefresh: true });

    expect(readiness.readiness).toBe('READY');
    expect(readiness.codeableResponses).toBe(1);
    expect(readiness.missingUnitFiles).toEqual(['UNIT_MISSING']);
    expect(readiness.blockers).not.toContain('MISSING_UNIT_FILES');
    expect(readiness.blockers).not.toContain('NO_CODEABLE_RESPONSES');
  });

  it('blocks missing files when no codeable responses remain', async () => {
    const service = createService({
      units: [
        createUnit(1, 'UNIT_MISSING')
      ],
      rawResponsesTotal: 1,
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 1 }
      ],
      unitFiles: [],
      unitVariableMap: new Map([
        ['UNIT_MISSING', new Set(['var1'])]
      ])
    });

    const readiness = await service.getReadiness(1, { forceRefresh: true });

    expect(readiness.readiness).toBe('BLOCKED');
    expect(readiness.codeableResponses).toBe(0);
    expect(readiness.missingUnitFiles).toEqual(['UNIT_MISSING']);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'MISSING_UNIT_FILES',
      'NO_CODEABLE_RESPONSES'
    ]));
  });

  it('ignores helper variables when building readiness diagnostics', async () => {
    const service = createService({
      units: [
        createUnit(1, 'UNIT_OK')
      ],
      rawResponsesTotal: 4,
      candidateRows: [
        { unitid: 1, variableid: 'image_1', response_count: 1 },
        { unitid: 1, variableid: 'text_1', response_count: 1 },
        { unitid: 1, variableid: 'frame_1', response_count: 1 },
        { unitid: 1, variableid: 'var1', response_count: 1 }
      ],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])]
      ])
    });

    const readiness = await service.getReadiness(1, { forceRefresh: true });

    expect(readiness.readiness).toBe('READY');
    expect(readiness.codeableResponses).toBe(1);
    expect(readiness.validResponses).toBe(1);
    expect(readiness.invalidVariableSamples).toEqual([]);
  });

  it('filters out valid-variable responses without usable coding scheme', async () => {
    const units = [
      createUnit(1, 'UNIT_OK'),
      createUnit(2, 'UNIT_MISSING_SCHEME')
    ];
    const service = createService({
      units,
      rawResponsesTotal: 0,
      candidateRows: [],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>'),
        createFile('UNIT_MISSING_SCHEME', '<Unit><codingSchemeRef>SCHEME_MISSING</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])],
        ['UNIT_MISSING_SCHEME', new Set(['var2'])]
      ])
    });

    const filteredResponses = await service.filterResponsesCodeable(
      1,
      [
        createResponse(1, 1, 'var1'),
        createResponse(2, 2, 'var2')
      ],
      units
    );

    expect(filteredResponses.map(response => response.id)).toEqual([1]);
  });

  it('filters helper responses but keeps valid empty responses before autocoding', async () => {
    const units = [
      createUnit(1, 'UNIT_OK')
    ];
    const service = createService({
      units,
      rawResponsesTotal: 0,
      candidateRows: [],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1'))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1', 'image_1', 'text_1', 'frame_1'])]
      ])
    });

    const filteredResponses = await service.filterResponsesCodeable(
      1,
      [
        createResponse(1, 1, 'var1'),
        createResponse(2, 1, 'image_1'),
        createResponse(3, 1, 'text_1'),
        createResponse(4, 1, 'frame_1'),
        createResponse(5, 1, 'var1', '   '),
        createResponse(6, 1, 'var1', null)
      ],
      units
    );

    expect(filteredResponses.map(response => response.id)).toEqual([1, 5, 6]);
  });

  it('blocks coding scheme files that the autocoder cannot parse', async () => {
    const service = createService({
      units: [
        createUnit(1, 'UNIT_INVALID_SCHEME')
      ],
      rawResponsesTotal: 1,
      candidateRows: [
        { unitid: 1, variableid: 'var1', response_count: 1 }
      ],
      unitFiles: [
        createFile('UNIT_INVALID_SCHEME', '<Unit><codingSchemeRef>SCHEME_INVALID</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_INVALID', '{not valid json')
      ],
      unitVariableMap: new Map([
        ['UNIT_INVALID_SCHEME', new Set(['var1'])]
      ])
    });

    const readiness = await service.getReadiness(1, { forceRefresh: true });

    expect(readiness.readiness).toBe('BLOCKED');
    expect(readiness.codeableResponses).toBe(0);
    expect(readiness.matchedCodingSchemes).toBe(0);
    expect(readiness.missingCodingSchemes).toEqual([]);
    expect(readiness.invalidCodingSchemes).toEqual(['SCHEME_INVALID']);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'INVALID_CODING_SCHEMES',
      'NO_CODEABLE_RESPONSES'
    ]));
  });

  it('filters out valid-variable responses with unusable coding scheme files', async () => {
    const units = [
      createUnit(1, 'UNIT_OK'),
      createUnit(2, 'UNIT_INVALID_SCHEME')
    ];
    const service = createService({
      units,
      rawResponsesTotal: 0,
      candidateRows: [],
      unitFiles: [
        createFile('UNIT_OK', '<Unit><codingSchemeRef>SCHEME_OK</codingSchemeRef></Unit>'),
        createFile('UNIT_INVALID_SCHEME', '<Unit><codingSchemeRef>SCHEME_INVALID</codingSchemeRef></Unit>')
      ],
      codingSchemeFiles: [
        createFile('SCHEME_OK', createCodingScheme('var1')),
        createFile('SCHEME_INVALID', JSON.stringify({ variableCodings: [] }))
      ],
      unitVariableMap: new Map([
        ['UNIT_OK', new Set(['var1'])],
        ['UNIT_INVALID_SCHEME', new Set(['var2'])]
      ])
    });

    const filteredResponses = await service.filterResponsesCodeable(
      1,
      [
        createResponse(1, 1, 'var1'),
        createResponse(2, 2, 'var2')
      ],
      units
    );

    expect(filteredResponses.map(response => response.id)).toEqual([1]);
  });
});
