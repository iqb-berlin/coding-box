import { readFileSync } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { CodingExportService } from './coding-export.service';
import { CodingResultsExportService } from './coding-results-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

jest.mock('./coding-list.service', () => ({
  CodingListService: jest.fn()
}));
jest.mock('../workspace/workspace-core.service', () => ({
  WorkspaceCoreService: jest.fn()
}));

type GoldenManifest = {
  workspaceId: number;
  person: {
    group: string;
    login: string;
    code: string;
    booklet: string;
  };
  unit: {
    name: string;
  };
  variable: {
    id: string;
    page: string;
  };
  coder: {
    id: number;
    name: string;
  };
  selectedCode: {
    code: string;
  };
  expectedExport: {
    comment: string;
  };
};

type QueryBuilderMock = Record<string, jest.Mock>;

const fixtureRoot = path.join(process.cwd(), 'cypress/fixtures/golden-datasets/minimal-valid');

function readFixture(fileName: string): string {
  return readFileSync(path.join(fixtureRoot, fileName), 'utf-8');
}

function normalizeCsv(csv: Buffer | string): string {
  return csv.toString().replace(/\r\n/g, '\n').trim();
}

function chainableQueryBuilder(overrides: Partial<QueryBuilderMock> = {}): QueryBuilderMock {
  const queryBuilder: QueryBuilderMock = {};
  [
    'innerJoin',
    'innerJoinAndSelect',
    'leftJoin',
    'leftJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'offset',
    'limit'
  ].forEach(method => {
    queryBuilder[method] = jest.fn(() => queryBuilder);
  });

  Object.assign(queryBuilder, overrides);
  return queryBuilder;
}

function toDetailedRawRow(codingJobUnit: Record<string, unknown>): Record<string, unknown> {
  const codingJob = codingJobUnit.coding_job as {
    training_id?: number | null;
    missings_profile_id?: number | null;
    codingJobCoders?: Array<{ user?: { username?: string } }>;
  } | undefined;
  const response = codingJobUnit.response as {
    status_v1?: number | null;
    unit?: {
      name?: string;
      booklet?: {
        person?: {
          login?: string;
          code?: string;
          group?: string;
        };
        bookletinfo?: {
          name?: string;
        };
      };
    };
  } | undefined;

  return {
    id: codingJobUnit.id ?? null,
    createdAt: codingJobUnit.created_at ?? null,
    trainingId: codingJob?.training_id ?? null,
    missingsProfileId: codingJob?.missings_profile_id ?? null,
    responseId: codingJobUnit.response_id ?? null,
    unitName: codingJobUnit.unit_name ?? null,
    responseUnitName: response?.unit?.name ?? null,
    variableId: codingJobUnit.variable_id ?? '',
    code: codingJobUnit.code ?? null,
    notes: codingJobUnit.notes ?? null,
    codingIssueOption: codingJobUnit.coding_issue_option ?? null,
    updatedAt: codingJobUnit.updated_at ?? null,
    coderName: codingJob?.codingJobCoders?.[0]?.user?.username ?? null,
    statusV1: response?.status_v1 ?? null,
    bookletName: response?.unit?.booklet?.bookletinfo?.name ?? null,
    personLogin: response?.unit?.booklet?.person?.login ?? null,
    personCode: response?.unit?.booklet?.person?.code ?? null,
    personGroup: response?.unit?.booklet?.person?.group ?? null
  };
}

function createCodingJobUnitRepository(
  codingJobUnit: Record<string, unknown>
): Repository<CodingJobUnit> {
  const totalCountQueryBuilder = chainableQueryBuilder({
    getCount: jest.fn().mockResolvedValue(1)
  });
  const unitsBatchQueryBuilder = chainableQueryBuilder({
    getMany: jest.fn().mockResolvedValue([codingJobUnit]),
    getRawMany: jest.fn().mockResolvedValue([toDetailedRawRow(codingJobUnit)])
  });

  return {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(totalCountQueryBuilder)
      .mockReturnValue(unitsBatchQueryBuilder)
  } as unknown as Repository<CodingJobUnit>;
}

describe('CodingExportService golden dataset: minimal-valid', () => {
  it('keeps detailed CSV output equal between monolithic and specialized exporters', async () => {
    const manifest = JSON.parse(readFixture('manifest.json')) as GoldenManifest;
    const expectedCsv = readFixture('expected-detailed.csv').trim();
    const codedAt = new Date(2026, 4, 17, 8, 30, 0);

    const goldenCodingJobUnit = {
      id: 1,
      code: Number(manifest.selectedCode.code),
      coding_issue_option: null,
      created_at: codedAt,
      notes: manifest.expectedExport.comment,
      response_id: 123,
      unit_name: manifest.unit.name,
      updated_at: codedAt,
      variable_id: manifest.variable.id,
      coding_job: {
        training_id: null,
        codingJobCoders: [{
          user: {
            id: manifest.coder.id,
            username: manifest.coder.name
          }
        }]
      },
      response: {
        unit: {
          name: manifest.unit.name,
          booklet: {
            bookletinfo: {
              name: manifest.person.booklet
            },
            person: {
              code: manifest.person.code,
              group: manifest.person.group,
              login: manifest.person.login
            }
          }
        }
      }
    };

    const codingListService = {
      getVariablePageMap: jest.fn().mockResolvedValue(new Map([[manifest.variable.id, manifest.variable.page]]))
    } as unknown as CodingListService;
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    const req = {
      protocol: 'http',
      get: jest.fn((name: string) => (name === 'host' ? 'localhost:4200' : undefined))
    };

    const monolithicService = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      createCodingJobUnitRepository(goldenCodingJobUnit),
      {} as Repository<CoderTrainingDiscussionResult>,
      {} as Repository<User>,
      codingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService
    );
    const specializedService = new CodingResultsExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      createCodingJobUnitRepository(goldenCodingJobUnit),
      codingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService
    );

    const monolithicCsv = normalizeCsv(await monolithicService.exportCodingResultsDetailed(
      manifest.workspaceId,
      false,
      true,
      false,
      false,
      'export-token',
      req as never
    ));
    const specializedCsv = normalizeCsv(await specializedService.exportCodingResultsDetailed(
      manifest.workspaceId,
      false,
      true,
      false,
      false,
      'export-token',
      req as never
    ));

    expect(monolithicCsv).toBe(expectedCsv);
    expect(specializedCsv).toBe(monolithicCsv);
    expect(codingListService.getVariablePageMap).toHaveBeenCalledWith(
      manifest.unit.name,
      manifest.workspaceId
    );
  });
});
