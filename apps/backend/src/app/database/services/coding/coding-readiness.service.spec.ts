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
  candidateRows: Array<{
    unitid: number | string;
    variableid: string;
    response_count: number | string;
  }>;
  unitFiles: FileUpload[];
  codingSchemeFiles?: FileUpload[];
  unitVariableMap: Map<string, Set<string>>;
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
  variableid: string
): ResponseEntity => ({
  id,
  unitid,
  variableid
} as ResponseEntity);

const createService = (fixture: ReadinessFixture): CodingReadinessService => {
  const unitQuery = createQueryBuilderMock();
  unitQuery.getMany.mockResolvedValue(fixture.units);

  const countQuery = createQueryBuilderMock();
  countQuery.getCount.mockResolvedValue(fixture.rawResponsesTotal);

  const candidateQuery = createQueryBuilderMock();
  candidateQuery.getRawMany.mockResolvedValue(fixture.candidateRows);

  const fileRevisionQuery = createQueryBuilderMock();
  fileRevisionQuery.getRawOne.mockResolvedValue({
    file_count: fixture.unitFiles.length + (fixture.codingSchemeFiles || []).length,
    max_created_at: '2026-05-20T08:00:00.000Z'
  });

  const responseRepository = {
    createQueryBuilder: jest.fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(candidateQuery),
    query: jest.fn().mockResolvedValue([{ revision: 1 }])
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

  return new CodingReadinessService(
    responseRepository as never,
    unitRepository as never,
    fileUploadRepository as never,
    workspaceFilesService as never,
    workspaceExclusionService as never
  );
};

describe('CodingReadinessService', () => {
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
