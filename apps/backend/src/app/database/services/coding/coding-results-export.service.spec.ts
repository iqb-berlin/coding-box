import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { CodingResultsExportService } from './coding-results-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

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

function createService(overrides: {
  codingJobUnits?: unknown[];
  codingListVariables?: Array<{ unitName: string; variableId: string }>;
  pageMap?: Map<string, string>;
  exclusions?: {
    globalIgnoredUnits: string[];
    ignoredBooklets: string[];
    testletIgnoredUnits: Array<{ bookletId: string; unitId: string }>;
  };
} = {}) {
  const responseRepository: MockedRepo<ResponseEntity> = {
    createQueryBuilder: jest.fn()
  };
  const codingJobRepository: MockedRepo<CodingJob> = {
    find: jest.fn().mockResolvedValue([])
  };
  const codingJobVariableRepository: MockedRepo<CodingJobVariable> = {
    find: jest.fn().mockResolvedValue([])
  };
  const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
    find: jest.fn().mockResolvedValue(overrides.codingJobUnits ?? [baseUnit])
  };
  const codingListService = {
    getVariablePageMap: jest.fn().mockResolvedValue(overrides.pageMap ?? new Map([['VAR1', '3']])),
    getCodingResultsByVersionCsvStream: jest.fn().mockResolvedValue(Readable.from(['csv'])),
    getCodingResultsByVersionAsExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
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
    workspaceExclusionService
  );

  return {
    service,
    responseRepository,
    codingJobRepository,
    codingJobVariableRepository,
    codingJobUnitRepository,
    codingListService,
    workspaceExclusionService
  };
}

describe('CodingResultsExportService', () => {
  it('delegates versioned CSV and Excel exports with fallback strings', async () => {
    const { service, codingListService } = createService();

    await expect(service.exportCodingResultsByVersionAsCsv(1, 'v2', '', '', true)).resolves.toBeInstanceOf(Readable);
    await expect(service.exportCodingResultsByVersionAsExcel(1, 'v3', '', '', false)).resolves.toEqual(Buffer.from('xlsx'));

    expect(codingListService.getCodingResultsByVersionCsvStream).toHaveBeenCalledWith(1, 'v2', '', '', true);
    expect(codingListService.getCodingResultsByVersionAsExcel).toHaveBeenCalledWith(1, 'v3', '', '', false);
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
        { ...baseUnit, variable_id: 'VAR2', code: 0, coding_issue_option: 0, notes: 'zero-code note' },
        { ...baseUnit, variable_id: 'VAR3', code: null, notes: 'skipped' }
      ]
    });

    const csv = (await service.exportCodingResultsDetailed(1)).toString('utf-8');

    expect(csv).toContain('"Code";"Code-Hinweis"');
    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
    expect(csv).toContain('"0";""');
    expect(csv).not.toContain('skipped');
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

    expect(csv.split('\n')).toHaveLength(1);
  });

  it('rejects manual-only detailed export when no manual variables exist', async () => {
    const { service } = createService({ codingListVariables: [] });

    await expect(service.exportCodingResultsDetailed(1, false, false, false, false, '', undefined, true))
      .rejects.toThrow('No manual coding variables found');
  });
});
