import { Readable } from 'stream';
import { IsNull, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { CodingResultsExportService } from './coding-results-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

jest.mock('./coding-list.service', () => ({
  CodingListService: jest.fn()
}));
jest.mock('../workspace/workspace-core.service', () => ({
  WorkspaceCoreService: jest.fn()
}));

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;
type TestCodingJobUnit = {
  id?: number;
  code?: number | null;
  score?: number | null;
  coding_issue_option?: number | null;
  notes?: string | null;
  updated_at?: Date;
  unit_name?: string;
  variable_id?: string;
  booklet_name?: string;
  person_login?: string;
  person_code?: string;
  person_group?: string;
  coding_job?: {
    training_id?: number | null;
    missings_profile_id?: number | null;
    codingJobCoders?: Array<{
      user?: {
        id?: number;
        username?: string;
      };
    }>;
  };
  response?: {
    status_v1?: number | null;
    unit?: {
      name?: string;
      booklet?: {
        bookletinfo?: { name?: string };
        person?: {
          login?: string;
          code?: string;
          group?: string;
        };
      };
    };
  };
};

const baseUnit = {
  code: 7,
  score: 7,
  coding_issue_option: 1,
  notes: 'needs review',
  updated_at: new Date('2026-04-14T10:00:00.000Z'),
  unit_name: 'UNIT1',
  variable_id: 'VAR1',
  booklet_name: 'BOOKLET1',
  person_login: 'login-1',
  person_code: 'code-1',
  person_group: 'group-1',
  coding_job: {
    codingJobCoders: [{ user: { id: 11, username: 'coder-a' } }]
  },
  response: {
    status_v1: 5,
    unit: {
      name: 'UNIT1',
      booklet: {
        bookletinfo: { name: 'BOOKLET1' },
        person: {
          login: 'login-1',
          code: 'code-1',
          group: 'group-1'
        }
      }
    }
  }
};

const queryVisibleUnits = (units: TestCodingJobUnit[]): TestCodingJobUnit[] => units.filter(
  unit => !unit.coding_job?.training_id &&
    (unit.response?.status_v1 === null ||
      unit.response?.status_v1 === undefined ||
      ![0, 1, 2, 10].includes(unit.response.status_v1))
);

const createCodingJobUnitQueryBuilder = (units: TestCodingJobUnit[]) => {
  let skipValue = 0;
  let takeValue = units.length || 500;
  const queryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn((value: number) => {
      skipValue = value;
      return queryBuilder;
    }),
    take: jest.fn((value: number) => {
      takeValue = value;
      return queryBuilder;
    }),
    getCount: jest.fn().mockImplementation(async () => queryVisibleUnits(units).length),
    getRawMany: jest.fn().mockImplementation(async () => Array.from(
      new Map(
        queryVisibleUnits(units)
          .filter(unit => unit.unit_name && unit.variable_id)
          .map(unit => [`${unit.unit_name}|${unit.variable_id}`, {
            unitName: unit.unit_name,
            variableId: unit.variable_id
          }])
      ).values()
    )),
    getMany: jest.fn().mockImplementation(async () => queryVisibleUnits(units)
      .slice(skipValue, skipValue + takeValue))
  };
  return queryBuilder;
};

const createCodingJobQueryBuilder = (units: TestCodingJobUnit[]) => {
  const queryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockImplementation(async () => Array.from(
      new Set(
        queryVisibleUnits(units)
          .map(unit => unit.coding_job?.codingJobCoders?.[0]?.user?.username)
          .filter((username): username is string => !!username)
      )
    ).map(username => ({ username })))
  };
  return queryBuilder;
};

function createService(overrides: {
  codingJobUnits?: unknown[];
  codingListVariables?: Array<{ unitName: string; variableId: string }>;
  pageMap?: Map<string, string>;
  exclusions?: {
    globalIgnoredUnits: string[];
    ignoredBooklets: string[];
    testletIgnoredUnits: Array<{ bookletId: string; unitId: string }>;
  };
  missingsProfilesService?: { getMissingByIdForProfileOrDefault: jest.Mock };
} = {}) {
  const responseRepository: MockedRepo<ResponseEntity> = {
    createQueryBuilder: jest.fn()
  };
  const codingJobUnits = (overrides.codingJobUnits ?? [baseUnit]) as TestCodingJobUnit[];
  const codingJobUnitQueryBuilders: ReturnType<typeof createCodingJobUnitQueryBuilder>[] = [];
  const codingJobRepository: MockedRepo<CodingJob> = {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => createCodingJobQueryBuilder(codingJobUnits))
  };
  const codingJobVariableRepository: MockedRepo<CodingJobVariable> = {
    find: jest.fn().mockResolvedValue([])
  };
  const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
    find: jest.fn().mockResolvedValue(codingJobUnits),
    createQueryBuilder: jest.fn(() => {
      const queryBuilder = createCodingJobUnitQueryBuilder(codingJobUnits);
      codingJobUnitQueryBuilders.push(queryBuilder);
      return queryBuilder;
    })
  };
  const codingListService = {
    getVariablePageMap: jest.fn().mockResolvedValue(overrides.pageMap ?? new Map([['VAR1', '3']])),
    getCodingResultsByVersionCsvStream: jest.fn().mockResolvedValue(Readable.from(['csv'])),
    getCodingResultsByVersionAsExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
    getCodingResultsByVersionAsGeoGebraZip: jest.fn().mockResolvedValue(Buffer.from('zip')),
    getCodingListVariables: jest.fn().mockResolvedValue(overrides.codingListVariables ?? [{ unitName: 'UNIT1', variableId: 'VAR1' }])
  } as unknown as CodingListService;
  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue(overrides.exclusions ?? {
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  } as unknown as WorkspaceExclusionService;

  const service = new CodingResultsExportService(
    responseRepository as unknown as Repository<ResponseEntity>,
    codingJobRepository as unknown as Repository<CodingJob>,
    codingJobVariableRepository as unknown as Repository<CodingJobVariable>,
    codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
    codingListService,
    {} as WorkspaceCoreService,
    workspaceExclusionService,
    overrides.missingsProfilesService as never
  );

  return {
    service,
    responseRepository,
    codingJobRepository,
    codingJobVariableRepository,
    codingJobUnitRepository,
    codingJobUnitQueryBuilders,
    codingListService,
    workspaceExclusionService
  };
}

const expectProductionJobUnitFilter = (where: unknown) => {
  expect(where).toEqual(expect.objectContaining({
    coding_job: expect.objectContaining({
      workspace_id: 1
    })
  }));
  expect((where as { coding_job?: { training_id?: unknown } }).coding_job?.training_id).toEqual(IsNull());
};

describe('CodingResultsExportService', () => {
  it('delegates versioned CSV and Excel exports with fallback strings', async () => {
    const { service, codingListService } = createService();

    await expect(service.exportCodingResultsByVersionAsCsv(1, 'v2', '', '', true)).resolves.toBeInstanceOf(Readable);
    await expect(service.exportCodingResultsByVersionAsExcel(1, 'v3', '', '', false)).resolves.toEqual(Buffer.from('xlsx'));

    expect(codingListService.getCodingResultsByVersionCsvStream).toHaveBeenCalledWith(
      1,
      'v2',
      '',
      '',
      true,
      undefined,
      true,
      false
    );
    expect(codingListService.getCodingResultsByVersionAsExcel).toHaveBeenCalledWith(
      1,
      'v3',
      '',
      '',
      false,
      undefined,
      true,
      false
    );
  });

  it('delegates versioned GeoGebra ZIP exports', async () => {
    const { service, codingListService } = createService();
    const onProgress = jest.fn();

    await expect(
      service.exportCodingResultsByVersionAsGeoGebraZip(1, 'v2', '', '', true, onProgress)
    ).resolves.toEqual(Buffer.from('zip'));

    expect(codingListService.getCodingResultsByVersionAsGeoGebraZip).toHaveBeenCalledWith(
      1,
      'v2',
      '',
      '',
      true,
      onProgress
    );
  });

  it('caches variable page maps per workspace and falls back to page zero', async () => {
    const { service, codingListService } = createService({ pageMap: new Map([['VAR1', '5']]) });

    await expect(service.getVariablePage('UNIT1', 'VAR1', 1)).resolves.toBe('5');
    await expect(service.getVariablePage('UNIT1', 'MISSING', 1)).resolves.toBe('0');
    await expect(service.getVariablePage('UNIT1', 'VAR1', 2)).resolves.toBe('5');

    expect(codingListService.getVariablePageMap).toHaveBeenCalledTimes(2);
  });

  it('normalizes coding issue options for detailed CSV export', async () => {
    const { service } = createService({
      codingJobUnits: [
        { ...baseUnit, coding_issue_option: -1 },
        {
          ...baseUnit, variable_id: 'VAR2', code: 0, coding_issue_option: 0, notes: 'zero-code note'
        },
        {
          ...baseUnit, variable_id: 'VAR3', code: null, notes: 'skipped'
        }
      ]
    });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(csv).toContain('"Code";"Code-Hinweis"');
    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
    expect(csv).toContain('"0";""');
    expect(csv).toContain('"zero-code note"');
    expect(csv).not.toContain('skipped');
  });

  it('does not resolve manual missing profiles for regular detailed export codes', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockRejectedValue(new Error('unexpected missing lookup'))
    };
    const { service } = createService({
      missingsProfilesService,
      codingJobUnits: [{
        ...baseUnit,
        code: 7,
        score: 2,
        coding_job: {
          ...baseUnit.coding_job,
          missings_profile_id: 77
        }
      }]
    });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).not.toHaveBeenCalled();
  });

  it('uses comments, replay URLs and pseudo coder names when requested', async () => {
    const { service, codingListService } = createService({
      codingJobUnits: [
        { ...baseUnit, notes: 'comment as value' },
        {
          ...baseUnit,
          variable_id: 'VAR2',
          notes: 'second comment',
          coding_job: { codingJobCoders: [{ user: { id: 12, username: 'coder-b' } }] }
        }
      ],
      codingListVariables: [{ unitName: 'UNIT1', variableId: 'VAR1' }, { unitName: 'UNIT1', variableId: 'VAR2' }],
      pageMap: new Map([['VAR1', '2'], ['VAR2', '4']])
    });
    const req = {
      protocol: 'http',
      get: jest.fn((name: string) => (name === 'host' ? 'example.test' : undefined))
    };

    const csv = (await service.exportCodingResultsDetailed(
      1,
      true,
      true,
      true,
      true,
      'token',
      req as never,
      true
    )).toString('utf-8');

    expect(csv).toContain('"Replay URL"');
    expect(csv).toContain('"comment as value"');
    expect(csv).toContain('"K1"');
    expect(csv).toContain('http://example.test/#/replay/login-1@code-1@group-1@BOOKLET1/UNIT1/2/VAR1?auth=token');
    expect(codingListService.getCodingListVariables).toHaveBeenCalledWith(1);
  });

  it('assigns unique pseudo coder names in first-seen order', async () => {
    const { service } = createService({
      codingJobUnits: [
        {
          ...baseUnit,
          coding_job: { codingJobCoders: [{ user: { id: 12, username: 'coder-b' } }] }
        },
        {
          ...baseUnit,
          notes: 'second coder',
          coding_job: { codingJobCoders: [{ user: { id: 11, username: 'coder-a' } }] }
        }
      ]
    });

    const csv = (await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      true,
      true
    )).toString('utf-8');

    const pseudoCoderCells = csv.match(/"K[12]"/g) || [];
    expect(pseudoCoderCells).toEqual(['"K1"', '"K2"']);
  });

  it('reads detailed export rows in batches', async () => {
    const codingJobUnits = Array.from({ length: 501 }, (_, index) => ({
      ...baseUnit,
      id: index + 1,
      variable_id: `VAR${index + 1}`,
      coding_issue_option: 0,
      notes: `note ${index + 1}`
    }));
    const {
      service,
      codingJobUnitRepository,
      codingJobUnitQueryBuilders
    } = createService({ codingJobUnits });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(codingJobUnitRepository.createQueryBuilder).toHaveBeenCalledTimes(3);
    expect(codingJobUnitQueryBuilders[1].skip).toHaveBeenCalledWith(0);
    expect(codingJobUnitQueryBuilders[1].take).toHaveBeenCalledWith(500);
    expect(codingJobUnitQueryBuilders[2].skip).toHaveBeenCalledWith(500);
    expect(codingJobUnitQueryBuilders[2].take).toHaveBeenCalledWith(500);
    expect(csv).toContain('"VAR501"');
    expect(csv).toContain('"note 501"');
  });

  it('filters ignored units and excluded response statuses from detailed export', async () => {
    const { service } = createService({
      codingJobUnits: [
        { ...baseUnit, unit_name: 'IGNORED', variable_id: 'VAR1' },
        { ...baseUnit, variable_id: 'VAR2', response: { ...baseUnit.response, status_v1: 1 } }
      ],
      exclusions: {
        globalIgnoredUnits: ['IGNORED'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      }
    });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(csv.trimEnd().split('\n')).toHaveLength(1);
  });

  it('filters training jobs from unscoped detailed export', async () => {
    const { service } = createService({
      codingJobUnits: [
        { ...baseUnit, variable_id: 'VAR1' },
        {
          ...baseUnit,
          variable_id: 'TRAINING_VAR',
          coding_job: {
            ...baseUnit.coding_job,
            training_id: 12
          }
        }
      ]
    });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(csv).toContain('"VAR1"');
    expect(csv).not.toContain('TRAINING_VAR');
  });

  it('keeps manual-only detailed export stable when no manual variables exist', async () => {
    const { service } = createService({ codingListVariables: [] });

    const csv = (await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      true
    )).toString('utf-8');

    expect(csv).toContain('"VAR1"');
  });

  it('includes DERIVE_ERROR job-only variables in manual-only aggregated export', async () => {
    const { service } = createService({
      codingListVariables: [],
      codingJobUnits: [{
        ...baseUnit,
        variable_id: 'DERIVE_ONLY',
        response: {
          ...baseUnit.response,
          status_v1: 4
        }
      }]
    });

    const buffer = await service.exportCodingResultsAggregated(
      1,
      false,
      false,
      false,
      false,
      'most-frequent',
      false,
      false,
      '',
      undefined,
      true
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    const cellValues = worksheet.getSheetValues().flat().map(value => String(value ?? ''));

    expect(cellValues.some(value => value.includes('DERIVE_ONLY'))).toBe(true);
    expect(worksheet.getRow(1).getCell(5).value).toBeNull();
  });

  it('adds modal tie metadata to most-frequent aggregated export variables', async () => {
    const { service } = createService({
      codingJobUnits: [
        {
          ...baseUnit,
          id: 1,
          code: 7,
          coding_issue_option: 1,
          coding_job: {
            ...baseUnit.coding_job,
            codingJobCoders: [{ user: { id: 11, username: 'coder-a' } }]
          }
        },
        {
          ...baseUnit,
          id: 2,
          code: 8,
          coding_issue_option: null,
          coding_job: {
            ...baseUnit.coding_job,
            codingJobCoders: [{ user: { id: 12, username: 'coder-b' } }]
          }
        }
      ]
    });

    const buffer = await service.exportCodingResultsAggregated(
      1,
      false,
      false,
      false,
      false,
      'most-frequent',
      false,
      true,
      '',
      undefined,
      true
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    expect(worksheet.getRow(1).getCell(4).value).toBe('UNIT1_VAR1');
    expect(worksheet.getRow(1).getCell(5).value).toBe('UNIT1_VAR1 Modalwert-Gleichstand');
    expect(worksheet.getRow(1).getCell(6).value).toBe('UNIT1_VAR1 Modalwert-Kandidaten');
    expect(worksheet.getRow(2).getCell(4).value).toBe(7);
    expect(worksheet.getRow(2).getCell(5).value).toBe('Ja');
    expect(worksheet.getRow(2).getCell(6).value).toBe('7,8');
  });

  it('includes DERIVE_ERROR job-only variables in manual-only by-variable export', async () => {
    const { service } = createService({
      codingListVariables: [],
      codingJobUnits: [{
        ...baseUnit,
        variable_id: 'DERIVE_VAR',
        response: {
          ...baseUnit.response,
          status_v1: 4
        }
      }]
    });

    const buffer = await service.exportCodingResultsByVariable(
      1,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      '',
      undefined,
      true
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheetNames = workbook.worksheets.map(worksheet => worksheet.name);

    expect(worksheetNames.some(name => name.includes('DERIVE_VAR'))).toBe(true);
  });

  it('limits repository-backed export reads to non-training jobs', async () => {
    const {
      service,
      codingJobUnitRepository,
      codingJobRepository
    } = createService();
    await service.exportCodingResultsAggregated(
      1,
      false,
      false,
      false,
      false,
      'most-frequent',
      false,
      false,
      '',
      undefined,
      true
    );
    await service.exportCodingResultsAggregated(
      1,
      false,
      false,
      false,
      false,
      'new-row-per-variable',
      false,
      false,
      '',
      undefined,
      true
    );
    await service.exportCodingResultsAggregated(
      1,
      false,
      false,
      false,
      false,
      'new-column-per-coder',
      false,
      false,
      '',
      undefined,
      true
    );
    await service.exportCodingResultsByVariable(
      1,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      '',
      undefined,
      true
    );
    await expect(service.exportCodingResultsByCoder(1)).rejects.toThrow('No coding jobs found');

    const unitFindWheres = (codingJobUnitRepository.find as jest.Mock).mock.calls
      .map(([options]) => options?.where)
      .filter(Boolean);

    expect(unitFindWheres.length).toBeGreaterThanOrEqual(4);
    unitFindWheres.forEach(expectProductionJobUnitFilter);
    expect(codingJobRepository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        workspace_id: 1,
        training_id: IsNull()
      })
    }));
  });
});
