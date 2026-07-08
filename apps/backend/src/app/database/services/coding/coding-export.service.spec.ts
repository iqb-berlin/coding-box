import { Repository } from 'typeorm';
import { Readable } from 'stream';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodingExportService } from './coding-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { CodingListService } from './coding-list.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { statusStringToNumber } from '../../utils/response-status-converter';

jest.mock('./coding-list.service', () => ({
  CodingListService: function MockCodingListService() {}
}));
jest.mock('../workspace/workspace-core.service', () => ({
  WorkspaceCoreService: function MockWorkspaceCoreService() {}
}));

type MockedRepo<T> = Partial<Record<keyof Repository<T>, jest.Mock>>;

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf-8'));
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function createServiceWithDetailedMocks(
  codingIssueOption: number,
  overrides: {
    unit?: Record<string, unknown>,
    units?: Record<string, unknown>[],
    discussionResults?: Record<string, unknown>[],
    users?: Record<string, unknown>[],
    totalCount?: number,
    missingsProfilesService?: { getMissingByIdForProfileOrDefault: jest.Mock }
  } = {}
) {
  const defaultUnit = {
    code: 7,
    coding_issue_option: codingIssueOption,
    notes: '',
    updated_at: new Date('2026-04-14T10:00:00.000Z'),
    response_id: 123,
    unit_name: 'U1',
    variable_id: 'V1',
    coding_job: {
      training_id: null,
      codingJobCoders: [{ user: { username: 'coder1' } }]
    },
    response: {
      status_v1: 8,
      unit: {
        name: 'U1',
        booklet: {
          person: {
            login: 'p-login',
            code: 'p-code',
            group: 'G1'
          },
          bookletinfo: {
            name: 'B1'
          }
        }
      }
    }
  };

  const toDetailedRawRow = (unit: Record<string, unknown>) => {
    const codingJob = unit.coding_job as {
      training_id?: number | null;
      missings_profile_id?: number | null;
      codingJobCoders?: Array<{ user?: { username?: string } }>;
    } | undefined;
    const response = unit.response as {
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
      id: unit.id ?? 1,
      createdAt: unit.created_at ?? new Date('2026-04-14T09:00:00.000Z'),
      trainingId: codingJob?.training_id ?? null,
      missingsProfileId: codingJob?.missings_profile_id ?? null,
      responseId: unit.response_id ?? null,
      unitName: unit.unit_name ?? null,
      responseUnitName: response?.unit?.name ?? null,
      variableId: unit.variable_id ?? '',
      code: unit.code ?? null,
      notes: unit.notes ?? null,
      codingIssueOption: unit.coding_issue_option ?? null,
      updatedAt: unit.updated_at ?? null,
      coderName: unit.coderName ?? unit.coder_name ?? codingJob?.codingJobCoders?.[0]?.user?.username ?? null,
      statusV1: response?.status_v1 ?? null,
      bookletName: response?.unit?.booklet?.bookletinfo?.name ?? null,
      personLogin: response?.unit?.booklet?.person?.login ?? null,
      personCode: response?.unit?.booklet?.person?.code ?? null,
      personGroup: response?.unit?.booklet?.person?.group ?? null
    };
  };

  const rawRows = (overrides.units || [overrides.unit || defaultUnit]).map(toDetailedRawRow);
  const unitIdRows = Array.from(
    new Map(rawRows.map(row => [String(row.id), row])).values()
  );
  let idOffsetValue = 0;
  let idLimitValue = unitIdRows.length;
  let currentBatchIds: number[] = [];

  const totalCountQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(overrides.totalCount ?? unitIdRows.length)
  };

  const unitIdsBatchQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    offset: jest.fn((value: number) => {
      idOffsetValue = value;
      return unitIdsBatchQueryBuilder;
    }),
    limit: jest.fn((value: number) => {
      idLimitValue = value;
      return unitIdsBatchQueryBuilder;
    }),
    getRawMany: jest.fn().mockImplementation(() => Promise.resolve(
      unitIdRows
        .slice(idOffsetValue, idOffsetValue + idLimitValue)
        .map(row => ({ id: row.id }))
    ))
  };

  const captureBatchIds = (
    _condition: string,
    params?: { batchIds?: number[] }
  ) => {
    if (params?.batchIds) {
      currentBatchIds = params.batchIds;
    }
    return unitsBatchQueryBuilder;
  };

  const unitsBatchQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn(captureBatchIds),
    andWhere: jest.fn(captureBatchIds),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(overrides.units || [overrides.unit || defaultUnit]),
    getRawMany: jest.fn().mockImplementation(() => Promise.resolve(
      currentBatchIds.length > 0 ?
        rawRows.filter(row => currentBatchIds.includes(Number(row.id))) :
        rawRows
    ))
  };

  let codingJobUnitQueryBuilderCalls = 0;
  const codingJobUnitRepository: MockedRepo<CodingJobUnit> = {
    createQueryBuilder: jest.fn(() => {
      codingJobUnitQueryBuilderCalls += 1;
      if (codingJobUnitQueryBuilderCalls === 1) return totalCountQueryBuilder;
      return codingJobUnitQueryBuilderCalls % 2 === 0 ?
        unitIdsBatchQueryBuilder :
        unitsBatchQueryBuilder;
    })
  };

  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  } as unknown as WorkspaceExclusionService;

  const discussionResultRepository = {
    find: jest.fn().mockResolvedValue(overrides.discussionResults || [])
  };
  const userRepository = {
    findBy: jest.fn().mockResolvedValue(overrides.users || [])
  };

  const service = new CodingExportService(
    {} as Repository<ResponseEntity>,
    {} as Repository<CodingJob>,
    {} as Repository<CodingJobVariable>,
    codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
    discussionResultRepository as unknown as Repository<CoderTrainingDiscussionResult>,
    userRepository as unknown as Repository<User>,
    {} as CodingListService,
    {} as WorkspaceCoreService,
    workspaceExclusionService,
    overrides.missingsProfilesService as never
  );

  return {
    service,
    totalCountQueryBuilder,
    unitIdsBatchQueryBuilder,
    unitsBatchQueryBuilder
  };
}

describe('CodingExportService (WS-Admin export smoke)', () => {
  it('uses TypeORM distinct flag for manual job variable references', async () => {
    const manualJobVariablesQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ unitName: 'UNIT', variableId: 'VAR' }])
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(manualJobVariablesQuery)
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      {} as Repository<CoderTrainingDiscussionResult>,
      {} as Repository<User>,
      codingListService as unknown as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const references = await (service as unknown as {
      getManualCodingVariableReferences: (
        workspaceId: number,
        jobDefinitionIds?: number[],
        coderTrainingIds?: number[],
        coderIds?: number[]
      ) => Promise<Array<{ unitName: string; variableId: string; includeDeriveError?: boolean }>>
    }).getManualCodingVariableReferences(13);

    expect(references).toEqual([{ unitName: 'UNIT', variableId: 'VAR', includeDeriveError: undefined }]);
    expect(manualJobVariablesQuery.select).toHaveBeenCalledWith('cju.unit_name', 'unitName');
    expect(manualJobVariablesQuery.select).not.toHaveBeenCalledWith(
      expect.stringContaining('DISTINCT'),
      expect.anything()
    );
    expect(manualJobVariablesQuery.distinct).toHaveBeenCalledWith(true);
  });

  it('includes selected training job variables in manual-only export references', async () => {
    const trainingOnlyVariable = {
      unitName: 'TRAINING_UNIT',
      // Keep an id ending in 0 because these can be absent from the coding-list-derived manual set.
      variableId: '10'
    };
    const manualJobVariablesQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([trainingOnlyVariable])
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(manualJobVariablesQuery)
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      {} as Repository<CoderTrainingDiscussionResult>,
      {} as Repository<User>,
      codingListService as unknown as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const references = await (service as unknown as {
      getManualCodingVariableReferences: (
        workspaceId: number,
        jobDefinitionIds?: number[],
        coderTrainingIds?: number[],
        coderIds?: number[]
      ) => Promise<Array<{ unitName: string; variableId: string; includeDeriveError?: boolean }>>
    }).getManualCodingVariableReferences(13, undefined, [21]);

    expect(references).toEqual([{ ...trainingOnlyVariable, includeDeriveError: undefined }]);
    expect(manualJobVariablesQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('cj.training_id IN (:...coderTrainingIds)'),
      { coderTrainingIds: [21] }
    );
    expect(manualJobVariablesQuery.andWhere).not.toHaveBeenCalledWith('cj.training_id IS NULL');
  });

  it('keeps code value and writes code hint when coding_issue_option is set', async () => {
    const { service, totalCountQueryBuilder, unitsBatchQueryBuilder } = createServiceWithDetailedMocks(1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"Code";"Code-Hinweis"');
    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
    expect(totalCountQueryBuilder.leftJoin).toHaveBeenCalledWith('cju.response', 'countResp');
    expect(totalCountQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(countResp.status_v1 IS NULL OR countResp.status_v1 NOT IN (:...excludedStatuses))',
      { excludedStatuses: [0, 1, 2, 10] }
    );
    expect(unitsBatchQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(resp.status_v1 IS NULL OR resp.status_v1 NOT IN (:...excludedStatuses))',
      { excludedStatuses: [0, 1, 2, 10] }
    );
  });

  it('paginates detailed raw export batches without repeating rows', async () => {
    const units = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      code: index % 10,
      coding_issue_option: 0,
      notes: '',
      updated_at: new Date('2026-04-14T10:00:00.000Z'),
      response_id: 1000 + index,
      unit_name: 'U1',
      variable_id: `V${index + 1}`,
      coding_job: {
        training_id: null,
        codingJobCoders: [{ user: { username: 'coder1' } }]
      },
      response: {
        status_v1: 8,
        unit: {
          name: 'U1',
          booklet: {
            person: {
              login: `p-login-${index + 1}`,
              code: `p-code-${index + 1}`,
              group: 'G1'
            },
            bookletinfo: {
              name: 'B1'
            }
          }
        }
      }
    }));
    const { service, unitIdsBatchQueryBuilder, unitsBatchQueryBuilder } = createServiceWithDetailedMocks(0, {
      units,
      totalCount: units.length
    });

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const dataRows = buffer.toString('utf-8').trimEnd().split('\n').slice(1);

    expect(dataRows).toHaveLength(501);
    expect(new Set(dataRows).size).toBe(501);
    expect(unitsBatchQueryBuilder.getRawMany).toHaveBeenCalledTimes(2);
    expect(unitIdsBatchQueryBuilder.getRawMany).toHaveBeenCalledTimes(2);
    expect(unitIdsBatchQueryBuilder.offset).toHaveBeenNthCalledWith(1, 0);
    expect(unitIdsBatchQueryBuilder.offset).toHaveBeenNthCalledWith(2, 500);
    expect(unitIdsBatchQueryBuilder.limit).toHaveBeenCalledWith(500);
    expect(unitsBatchQueryBuilder.offset).not.toHaveBeenCalled();
    expect(unitsBatchQueryBuilder.limit).not.toHaveBeenCalled();
    expect(unitsBatchQueryBuilder.skip).not.toHaveBeenCalled();
    expect(unitsBatchQueryBuilder.take).not.toHaveBeenCalled();
  });

  it('exports all detailed rows when coding-unit batches fan out through assigned coders', async () => {
    const units = Array.from({ length: 300 }, (_, index) => [
      'coder-a',
      'coder-b'
    ].map(coderName => ({
      id: index + 1,
      coderName,
      code: index % 10,
      coding_issue_option: 0,
      notes: '',
      updated_at: new Date('2026-04-14T10:00:00.000Z'),
      response_id: 2000 + index,
      unit_name: 'U1',
      variable_id: `V${index + 1}`,
      coding_job: {
        training_id: null,
        codingJobCoders: [{ user: { username: coderName } }]
      },
      response: {
        status_v1: 8,
        unit: {
          name: 'U1',
          booklet: {
            person: {
              login: `p-login-${index + 1}`,
              code: `p-code-${index + 1}`,
              group: 'G1'
            },
            bookletinfo: {
              name: 'B1'
            }
          }
        }
      }
    }))).flat();
    const { service, unitIdsBatchQueryBuilder, unitsBatchQueryBuilder } = createServiceWithDetailedMocks(0, {
      units,
      totalCount: 300
    });

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const dataRows = buffer.toString('utf-8').trimEnd().split('\n').slice(1);

    expect(dataRows).toHaveLength(600);
    expect(new Set(dataRows).size).toBe(600);
    expect(dataRows.filter(row => row.includes('"coder-a"'))).toHaveLength(300);
    expect(dataRows.filter(row => row.includes('"coder-b"'))).toHaveLength(300);
    expect(unitIdsBatchQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    expect(unitsBatchQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
  });

  it('emits one training manager row when a case spans detailed export batches', async () => {
    const units = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      code: 7,
      coding_issue_option: 0,
      notes: '',
      updated_at: new Date('2026-04-14T10:00:00.000Z'),
      response_id: 123,
      unit_name: 'U1',
      variable_id: `V${index + 1}`,
      coding_job: {
        training_id: 5,
        codingJobCoders: [{ user: { username: 'coder1' } }]
      },
      response: {
        status_v1: 8,
        unit: {
          name: 'U1',
          booklet: {
            person: {
              login: 'p-login',
              code: 'p-code',
              group: 'G1'
            },
            bookletinfo: {
              name: 'B1'
            }
          }
        }
      }
    }));
    const { service, unitIdsBatchQueryBuilder } = createServiceWithDetailedMocks(0, {
      units,
      totalCount: units.length,
      discussionResults: [{
        training_id: 5,
        response_id: 123,
        code: 4,
        score: 2,
        notes: 'Manager note',
        manager_user_id: 2,
        manager_name: 'stored-manager',
        updated_at: new Date('2026-04-14T11:00:00.000Z')
      }],
      users: [{ id: 2, username: 'manager1' }]
    });

    const buffer = await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );
    const dataRows = buffer.toString('utf-8').trimEnd().split('\n').slice(1);

    expect(dataRows).toHaveLength(502);
    expect(dataRows.filter(row => row.includes('"coder1"'))).toHaveLength(501);
    expect(dataRows.filter(row => row.includes('"manager1"'))).toHaveLength(1);
    expect(unitIdsBatchQueryBuilder.offset).toHaveBeenNthCalledWith(1, 0);
    expect(unitIdsBatchQueryBuilder.offset).toHaveBeenNthCalledWith(2, 500);
  });

  it('does not resolve manual missing profiles for regular detailed export codes', async () => {
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockRejectedValue(new Error('unexpected missing lookup'))
    };
    const { service } = createServiceWithDetailedMocks(1, {
      missingsProfilesService,
      unit: {
        code: 7,
        score: 2,
        coding_issue_option: 1,
        notes: '',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        response_id: 123,
        unit_name: 'U1',
        variable_id: 'V1',
        coding_job: {
          training_id: null,
          missings_profile_id: 77,
          codingJobCoders: [{ user: { username: 'coder1' } }]
        },
        response: {
          status_v1: 8,
          unit: {
            name: 'U1',
            booklet: {
              person: {
                login: 'p-login',
                code: 'p-code',
                group: 'G1'
              },
              bookletinfo: {
                name: 'B1'
              }
            }
          }
        }
      }
    });

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).not.toHaveBeenCalled();
  });

  it('skips detailed coding rows with excluded response statuses defensively', async () => {
    const { service } = createServiceWithDetailedMocks(1, {
      unit: {
        code: 7,
        coding_issue_option: 1,
        notes: '',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        response_id: 123,
        unit_name: 'U1',
        variable_id: 'V1',
        coding_job: {
          training_id: null,
          codingJobCoders: [{ user: { username: 'coder1' } }]
        },
        response: {
          status_v1: 2,
          unit: {
            name: 'U1',
            booklet: {
              person: {
                login: 'p-login',
                code: 'p-code',
                group: 'G1'
              },
              bookletinfo: {
                name: 'B1'
              }
            }
          }
        }
      }
    });

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"Person Login";"Person Code";"Person Group"');
    expect(csv).not.toContain('"p-login"');
  });

  it('normalizes negative coding_issue_option values in detailed export', async () => {
    const { service } = createServiceWithDetailedMocks(-1);

    const buffer = await service.exportCodingResultsDetailed(1, false, false, false, false);
    const csv = buffer.toString('utf-8');

    expect(csv).toContain('"7";"Code-Vergabe unsicher"');
  });

  it('emits detailed discussion rows even when the coder unit has no code', async () => {
    const { service } = createServiceWithDetailedMocks(0, {
      unit: {
        code: null,
        coding_issue_option: null,
        notes: '',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        response_id: 123,
        unit_name: 'U1',
        variable_id: 'V1',
        coding_job: {
          training_id: 5,
          codingJobCoders: [{ user: { username: 'coder1' } }]
        },
        response: {
          unit: {
            name: 'U1',
            booklet: {
              person: {
                login: 'p-login',
                code: 'p-code',
                group: 'G1'
              },
              bookletinfo: {
                name: 'B1'
              }
            }
          }
        }
      },
      discussionResults: [{
        training_id: 5,
        response_id: 123,
        code: 4,
        score: 2,
        notes: 'Replay note',
        manager_user_id: 2,
        manager_name: 'stored-manager',
        updated_at: new Date('2026-04-14T11:00:00.000Z')
      }],
      users: [{ id: 2, username: 'manager1' }]
    });

    const buffer = await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );
    const csv = buffer.toString('utf-8');

    expect(csv).not.toContain('"coder1";"U1";"V1"');
    const managerRow = csv.split('\n').find(row => row.includes('"manager1";"U1";"V1"'));
    expect(managerRow?.split(';')).toEqual([
      '"p-login"',
      '"p-code"',
      '"G1"',
      '"manager1"',
      '"U1"',
      '"V1"',
      '"Replay note"',
      expect.any(String),
      '"4"',
      '""'
    ]);
  });

  it('leaves training discussion results empty when no manager result was stored', async () => {
    const { service } = createServiceWithDetailedMocks(0, {
      unit: {
        code: 7,
        coding_issue_option: null,
        notes: '',
        updated_at: new Date('2026-04-14T10:00:00.000Z'),
        response_id: 123,
        unit_name: 'U1',
        variable_id: 'V1',
        coding_job: {
          training_id: 5,
          codingJobCoders: [{ user: { username: 'coder1' } }]
        },
        response: {
          status_v1: 8,
          unit: {
            name: 'U1',
            booklet: {
              person: {
                login: 'p-login',
                code: 'p-code',
                group: 'G1'
              },
              bookletinfo: {
                name: 'B1'
              }
            }
          }
        }
      },
      discussionResults: [],
      users: []
    });

    const buffer = await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );
    const csv = buffer.toString('utf-8');
    const rows = csv.trim().split('\n');

    expect(rows).toHaveLength(2);
    expect(csv).toContain('"p-login";"p-code";"G1";"coder1";"U1";"V1";"";');
    expect(csv).not.toContain('"manager1"');
    expect(csv).not.toContain('"stored-manager"');
  });

  it('rejects detailed export when scoped filters match no coding rows', async () => {
    const { service } = createServiceWithDetailedMocks(0, { totalCount: 0 });

    await expect(service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      [123]
    )).rejects.toThrow('Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter');
  });

  it('checks cancellation throughout detailed coding result batches', async () => {
    const { service, unitsBatchQueryBuilder } = createServiceWithDetailedMocks(1);
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    await service.exportCodingResultsDetailed(
      1,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      checkCancellation
    );

    expect(unitsBatchQueryBuilder.getRawMany).toHaveBeenCalled();
    expect(checkCancellation.mock.calls.length).toBeGreaterThan(3);
  });

  it('ignores invalid job/training/coder filter ids', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as { applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void }).applyJobFilters(
      queryBuilder,
      [Number.NaN, -2, 0],
      [Number.NaN, -1],
      [0, -3]
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
  });

  it('applies normalized scoped filters for job/training/coder ids', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as { applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void }).applyJobFilters(
      queryBuilder,
      [1, 1, Number.NaN, -1],
      [3, 3, 0],
      [7, 7, Number.NaN]
    );

    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('cj.job_definition_id IN (:...jobDefinitionIds)'),
      { jobDefinitionIds: [1], coderTrainingIds: [3] }
    );
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('coding_job_variable_bundle');
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('cj.training_id IN (:...coderTrainingIds)');
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('EXISTS'),
      { coderIds: [7] }
    );
  });

  it('applies only job-definition filter when only job ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, [11], undefined, undefined);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('coding_job_variable_bundle'),
      { jobDefinitionIds: [11] }
    );
  });

  it('narrows legacy bundle job-definition filters to the current coding-job unit when an alias is provided', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (
        query: unknown,
        jobDefinitionIds?: number[],
        coderTrainingIds?: number[],
        coderIds?: number[],
        codingJobUnitAlias?: string
      ) => void
    }).applyJobFilters(queryBuilder, [11], undefined, undefined, 'cju');

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('scope_vb.variables'),
      { jobDefinitionIds: [11] }
    );
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('variable_bundle scope_vb');
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('cju.unit_name');
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('cju.variable_id');
  });

  it('applies only training filter when only training ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, undefined, [22], undefined);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.training_id IN (:...coderTrainingIds))',
      { coderTrainingIds: [22] }
    );
  });

  it('applies only coder filter when only coder ids are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, undefined, undefined, [33]);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS'),
      { coderIds: [33] }
    );
  });

  it('keeps uncertain codes visible in most-frequent aggregated export', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const variableRecordsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'VAR',
      bookletName: 'BOOKLET-A'
    }]);
    const manualCodingQuery = createQueryBuilder([
      {
        personId: '10',
        unitName: 'UNIT',
        variableId: 'VAR',
        cju_code: '7',
        coding_issue_option: '-1',
        code_v1: null,
        code_v2: null,
        code_v3: null,
        notes: null,
        username: 'Coder A',
        jobId: '1',
        trainingId: null,
        responseId: '100'
      },
      {
        personId: '10',
        unitName: 'UNIT',
        variableId: 'VAR',
        cju_code: '7',
        coding_issue_option: '-2',
        code_v1: null,
        code_v2: null,
        code_v3: null,
        notes: null,
        username: 'Coder B',
        jobId: '2',
        trainingId: null,
        responseId: '100'
      },
      {
        personId: '10',
        unitName: 'UNIT',
        variableId: 'VAR',
        cju_code: '8',
        coding_issue_option: null,
        code_v1: null,
        code_v2: null,
        code_v3: null,
        notes: null,
        username: 'Coder C',
        jobId: '3',
        trainingId: null,
        responseId: '100'
      },
      {
        personId: '10',
        unitName: 'UNIT',
        variableId: 'VAR',
        cju_code: '8',
        coding_issue_option: '-3',
        code_v1: null,
        code_v2: null,
        code_v3: null,
        notes: null,
        username: 'Coder D',
        jobId: '4',
        trainingId: null,
        responseId: '100'
      }
    ]);
    const personResultsQuery = createQueryBuilder([{
      id: '10',
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A'
    }]);
    const autoVariablesQuery = createQueryBuilder([]);
    const autoCodingQuery = createQueryBuilder([]);

    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(variableRecordsQuery)
        .mockReturnValueOnce(manualCodingQuery)
    };
    const responseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(autoVariablesQuery)
        .mockReturnValueOnce(personResultsQuery)
        .mockReturnValueOnce(autoCodingQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const buffer = await service.exportCodingResultsAggregated(
      7,
      false,
      false,
      false,
      false,
      'most-frequent',
      false,
      true
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Coding Results');

    expect(worksheet?.getRow(1).getCell(4).value).toBe('UNIT_VAR');
    expect(worksheet?.getRow(1).getCell(5).value).toBe('UNIT_VAR Modalwert-Gleichstand');
    expect(worksheet?.getRow(1).getCell(6).value).toBe('UNIT_VAR Modalwert-Kandidaten');
    expect(worksheet?.getRow(2).getCell(4).value).toBe('7 (unsicher; neuer Code nötig)');
    expect(worksheet?.getRow(2).getCell(5).value).toBe('Ja');
    expect(worksheet?.getRow(2).getCell(6).value).toBe('7 (unsicher; neuer Code nötig),8 (ungültig)');
    expect(manualCodingQuery.addSelect).toHaveBeenCalledWith(
      'cju.coding_issue_option',
      'coding_issue_option'
    );
  });

  it('exports profile-specific manual missing scores in score-bearing aggregated export', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const variableRecordsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'VAR',
      bookletName: 'BOOKLET-A'
    }]);
    const manualCodingQuery = createQueryBuilder([{
      personId: '10',
      unitName: 'UNIT',
      variableId: 'VAR',
      cju_code: '-3',
      cju_score: null,
      coding_issue_option: null,
      code_v1: null,
      score_v1: null,
      code_v2: null,
      score_v2: null,
      code_v3: null,
      score_v3: null,
      notes: null,
      username: 'Coder A',
      jobId: '1',
      trainingId: null,
      missingsProfileId: '77',
      responseId: '100'
    }]);
    const coderRecordsQuery = createQueryBuilder([{ userName: 'Coder A' }]);
    const autoVariablesQuery = createQueryBuilder([]);
    const personResultsQuery = createQueryBuilder([{
      id: '10',
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A'
    }]);
    const autoCodingQuery = createQueryBuilder([]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(autoVariablesQuery)
        .mockReturnValueOnce(personResultsQuery)
        .mockReturnValueOnce(autoCodingQuery)
    };
    const codingJobRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(coderRecordsQuery)
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(variableRecordsQuery)
        .mockReturnValueOnce(manualCodingQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const missingsProfilesService = {
      getMissingByIdForProfileOrDefault: jest.fn().mockResolvedValue({
        id: 'mir',
        label: 'MIR',
        code: -97,
        score: null
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      codingJobRepository as unknown as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService,
      missingsProfilesService as never
    );

    const buffer = await service.exportCodingResultsAggregated(
      7,
      false,
      false,
      false,
      false,
      'new-row-per-variable'
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Coding Results')!;
    const headerValues = worksheet.getRow(1).values as unknown[];
    const codeColumn = headerValues.findIndex(value => value === 'Coder A Code');
    const scoreColumn = headerValues.findIndex(value => value === 'Coder A Score');

    expect(missingsProfilesService.getMissingByIdForProfileOrDefault).toHaveBeenCalledWith(7, 77, 'mir');
    expect(worksheet.getRow(2).getCell(codeColumn).value).toBe('-97');
    expect(worksheet.getRow(2).getCell(scoreColumn).value).toBe('NA');
  });

  it('does not fall back to response scores for discussion manager rows without stored score', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => ({
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawRows)
    });

    const variableRecordsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'VAR',
      bookletName: 'BOOKLET-A'
    }]);
    const coderRecordsQuery = createQueryBuilder([{ userName: 'Coder A' }]);
    const personResultsQuery = createQueryBuilder([{
      id: '10',
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A'
    }]);
    const manualCodingQuery = createQueryBuilder([{
      personId: '10',
      unitName: 'UNIT',
      variableId: 'VAR',
      cju_code: '7',
      cju_score: '1',
      coding_issue_option: null,
      code_v1: '3',
      score_v1: '9',
      code_v2: null,
      score_v2: null,
      code_v3: null,
      score_v3: null,
      notes: null,
      username: 'Coder A',
      jobId: '1',
      trainingId: '5',
      missingsProfileId: null,
      responseId: '100'
    }]);
    const discussionResult = {
      training_id: 5,
      response_id: 100,
      code: 4,
      score: null,
      notes: 'Stored note',
      manager_user_id: 2,
      manager_name: null,
      updated_at: new Date('2026-04-14T11:00:00.000Z')
    };

    const service = new CodingExportService(
      { createQueryBuilder: jest.fn().mockReturnValue(personResultsQuery) } as unknown as Repository<ResponseEntity>,
      { createQueryBuilder: jest.fn().mockReturnValue(coderRecordsQuery) } as unknown as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      {
        createQueryBuilder: jest.fn()
          .mockReturnValueOnce(variableRecordsQuery)
          .mockReturnValueOnce(manualCodingQuery)
      } as unknown as Repository<CodingJobUnit>,
      { find: jest.fn().mockResolvedValue([discussionResult]) } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn().mockResolvedValue([{ id: 2, username: 'manager1' }]) } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({
          globalIgnoredUnits: [],
          ignoredBooklets: [],
          testletIgnoredUnits: []
        })
      } as unknown as WorkspaceExclusionService
    );

    const buffer = await service.exportCodingResultsAggregated(
      7,
      false,
      false,
      false,
      false,
      'new-row-per-variable',
      true,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Coding Results')!;
    const headerValues = worksheet.getRow(1).values as unknown[];
    const managerCodeColumn = headerValues.findIndex(value => value === 'manager1 Code');
    const managerScoreColumn = headerValues.findIndex(value => value === 'manager1 Score');
    const managerNoteColumn = headerValues.findIndex(value => value === 'manager1 Note');

    expect(worksheet.getRow(2).getCell(managerCodeColumn).value).toBe('4');
    expect(worksheet.getRow(2).getCell(managerScoreColumn).value).toBeNull();
    expect(worksheet.getRow(2).getCell(managerNoteColumn).value).toBe('Stored note');
  });

  it('keeps stored discussion manager names when manager users cannot be resolved', async () => {
    const discussionResult = {
      training_id: 5,
      response_id: 100,
      code: 2,
      score: 1,
      notes: 'Stored note',
      manager_user_id: 12,
      manager_name: 'Stored Manager',
      updated_at: new Date('2026-04-14T11:00:00.000Z')
    };
    const discussionResultRepository = {
      find: jest.fn().mockResolvedValue([discussionResult])
    };
    const userRepository = {
      findBy: jest.fn().mockResolvedValue([])
    };

    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      {} as Repository<CodingJobUnit>,
      discussionResultRepository as unknown as Repository<CoderTrainingDiscussionResult>,
      userRepository as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      {} as WorkspaceExclusionService
    );

    const discussionResults = await (service as unknown as {
      getTrainingDiscussionResultsMap: (
        workspaceId: number,
        trainingIds?: number[],
        responseIds?: number[]
      ) => Promise<Map<string, { code: number | null; managerUsername: string | null; updatedAt: Date }>>
    }).getTrainingDiscussionResultsMap(7, [5], [100]);

    expect(discussionResults.get('5|100')).toMatchObject({
      code: 2,
      score: 1,
      notes: 'Stored note',
      managerUsername: 'Stored Manager',
      updatedAt: discussionResult.updated_at
    });
    expect(userRepository.findBy).toHaveBeenCalledTimes(1);
  });

  it('scopes variable export helper queries to the current workspace', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const combinationsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'VAR',
      bookletName: 'BOOKLET-A'
    }]);
    const personIdsQuery = createQueryBuilder([{ pId: 10 }]);
    const managerCasesQuery = createQueryBuilder([]);
    const dataQuery = createQueryBuilder([{
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A',
      cju_code: '1',
      coding_issue_option: null,
      code_v1: '1',
      code_v2: null,
      code_v3: null,
      status_v1: 8,
      username: 'Coder A',
      notes: null,
      pId: '10',
      trainingId: '5',
      responseId: '100'
    }]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(combinationsQuery)
        .mockReturnValueOnce(personIdsQuery)
        .mockReturnValueOnce(managerCasesQuery)
        .mockReturnValueOnce(dataQuery)
    };
    const coderQuery = createQueryBuilder([{ username: 'Coder A' }]);
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(coderQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    await service.exportCodingResultsByVariable(
      7,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      [5]
    );

    expect(personIdsQuery.innerJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
    expect(personIdsQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(personIdsQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });

    expect(managerCasesQuery.innerJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
    expect(managerCasesQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(managerCasesQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });

    expect(dataQuery.andWhere).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 7 });
    expect(dataQuery.andWhere).toHaveBeenCalledWith('person.consider = :consider', { consider: true });
    expect(dataQuery.andWhere).toHaveBeenCalledWith('cj.workspace_id = :workspaceId', { workspaceId: 7 });
  });

  it('rejects oversized by-variable exports with a compact-export recommendation', async () => {
    const originalLimit = process.env.EXPORT_MAX_WORKSHEETS;
    process.env.EXPORT_MAX_WORKSHEETS = '2';
    const combinationsQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { unitName: 'UNIT_1', variableId: 'VAR_1' },
        { unitName: 'UNIT_2', variableId: 'VAR_2' },
        { unitName: 'UNIT_3', variableId: 'VAR_3' }
      ])
    };
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(combinationsQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      {} as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    try {
      await service.exportCodingResultsByVariable(7);
      throw new Error('Expected oversized by-variable export to fail.');
    } catch (error) {
      expect((error as Error).message).toContain(
        'Bitte die Auswahl einschraenken oder den kompakten Nach-Variable-Export verwenden.'
      );
      expect((error as Error).message).not.toContain('EXPORT_MAX_WORKSHEETS');
    } finally {
      if (originalLimit === undefined) {
        delete process.env.EXPORT_MAX_WORKSHEETS;
      } else {
        process.env.EXPORT_MAX_WORKSHEETS = originalLimit;
      }
    }
  });

  it('streams compact by-variable export rows from batched coding-unit queries', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const firstBatchQuery = createQueryBuilder([
      {
        cjuId: '1',
        unitName: 'UNIT',
        variableId: 'VAR',
        login: 'login-a',
        personCode: 'code-a',
        personGroup: 'group-a',
        bookletName: 'BOOKLET-A',
        cju_code: '5',
        coding_issue_option: null,
        updatedAt: new Date('2026-04-14T10:00:00.000Z'),
        code_v1: null,
        code_v2: null,
        code_v3: null,
        status_v1: 8,
        username: 'Coder A',
        notes: 'note-a',
        pId: '10',
        trainingId: null,
        responseId: '100'
      },
      {
        cjuId: '2',
        unitName: 'UNIT',
        variableId: 'VAR',
        login: 'login-a',
        personCode: 'code-a',
        personGroup: 'group-a',
        bookletName: 'BOOKLET-A',
        cju_code: '7',
        coding_issue_option: null,
        updatedAt: new Date('2026-04-14T10:05:00.000Z'),
        code_v1: null,
        code_v2: null,
        code_v3: null,
        status_v1: 8,
        username: 'Coder B',
        notes: 'note-b',
        pId: '10',
        trainingId: null,
        responseId: '100'
      }
    ]);
    const emptyBatchQuery = createQueryBuilder([]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(firstBatchQuery)
        .mockReturnValueOnce(emptyBatchQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const csv = await streamToString(service.exportCodingResultsByVariableCompactAsCsvStream(
      7,
      true,
      true,
      true
    ));

    expect(csv).toContain('"Unit";"Variable";"Test Person Login"');
    expect(csv).toContain('"Häufigster Wert";"Anzahl der Abweichungen";"Modalwert-Gleichstand";"Modalwert-Kandidaten";"Doppelkodierung"');
    expect(csv).toContain('"UNIT";"VAR";"login-a";"code-a";"group-a";"Coder A";"5";"note-a";');
    expect(csv).toContain('"UNIT";"VAR";"login-a";"code-a";"group-a";"Coder B";"7";"note-b";');
    expect(csv).toContain('"5";"1";"Ja";"5,7";"Ja"');
    expect(csv).toContain('"Ja"');
    expect(responseRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(codingJobUnitRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(firstBatchQuery.offset).toHaveBeenCalledWith(0);
    expect(emptyBatchQuery.offset).toHaveBeenCalledWith(2);
  });

  it('limits compact by-variable export rows and anonymization mapping to selected coders', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const coderMappingQuery = createQueryBuilder([{ username: 'Coder A' }]);
    const firstBatchQuery = createQueryBuilder([
      {
        cjuId: '1',
        unitName: 'UNIT',
        variableId: 'VAR',
        login: 'login-a',
        personCode: 'code-a',
        personGroup: 'group-a',
        bookletName: 'BOOKLET-A',
        cju_code: '5',
        coding_issue_option: null,
        updatedAt: new Date('2026-04-14T10:00:00.000Z'),
        code_v1: null,
        code_v2: null,
        code_v3: null,
        status_v1: 8,
        username: 'Coder A',
        notes: null,
        pId: '10',
        trainingId: null,
        responseId: '100'
      }
    ]);
    const emptyBatchQuery = createQueryBuilder([]);
    const responseRepository = {
      createQueryBuilder: jest.fn()
    };
    const codingJobRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(coderMappingQuery)
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(firstBatchQuery)
        .mockReturnValueOnce(emptyBatchQuery)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      codingJobRepository as unknown as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const csv = await streamToString(service.exportCodingResultsByVariableCompactAsCsvStream(
      7,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      '',
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      [101]
    ));

    expect(csv).toContain('"UNIT";"VAR";"login-a";"code-a";"group-a";"K1";"5"');
    expect(firstBatchQuery.andWhere).toHaveBeenCalledWith(
      'cjc.user_id IN (:...selectedCoderIds)',
      { selectedCoderIds: [101] }
    );
    expect(coderMappingQuery.andWhere).toHaveBeenCalledWith(
      'cjc.user_id IN (:...selectedCoderIds)',
      { selectedCoderIds: [101] }
    );
  });

  it('combines job/training scope with coder filter when all are selected', () => {
    const { service } = createServiceWithDetailedMocks(1);
    const queryBuilder = {
      andWhere: jest.fn().mockReturnThis()
    };

    (service as unknown as {
      applyJobFilters: (query: unknown, jobDefinitionIds?: number[], coderTrainingIds?: number[], coderIds?: number[]) => void
    }).applyJobFilters(queryBuilder, [44], [55], [66]);

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(3);
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      '(cj.job_type IS NULL OR cj.job_type != :codingExportReviewJobType)',
      { codingExportReviewJobType: 'coding_issue_review' }
    );
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('cj.job_definition_id IN (:...jobDefinitionIds)'),
      { jobDefinitionIds: [44], coderTrainingIds: [55] }
    );
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('coding_job_variable_bundle');
    expect(queryBuilder.andWhere.mock.calls[1][0]).toContain('cj.training_id IN (:...coderTrainingIds)');
    expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('EXISTS'),
      { coderIds: [66] }
    );
  });

  it('includes DERIVE_ERROR job-only variables in the active manual-only aggregated export', async () => {
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const manualJobVariablesQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'DERIVED'
    }]);
    const variableRecordsQuery = createQueryBuilder([{
      unitName: 'UNIT',
      variableId: 'DERIVED',
      bookletName: 'BOOKLET-A'
    }]);
    const manualCodingQuery = createQueryBuilder([{
      personId: '10',
      unitName: 'UNIT',
      variableId: 'DERIVED',
      cju_code: '4',
      coding_issue_option: null,
      code_v1: null,
      code_v2: null,
      code_v3: null,
      notes: null,
      username: 'Coder A',
      jobId: '1',
      trainingId: null,
      missingsProfileId: null,
      responseId: '100'
    }]);
    const personResultsQuery = createQueryBuilder([{
      id: '10',
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A'
    }]);
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValueOnce(personResultsQuery)
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(manualJobVariablesQuery)
        .mockReturnValueOnce(variableRecordsQuery)
        .mockReturnValueOnce(manualCodingQuery)
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      codingListService as unknown as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const buffer = await service.exportCodingResultsAggregated(
      7,
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
    const worksheet = workbook.getWorksheet('Coding Results');

    expect(statusStringToNumber('DERIVE_ERROR')).not.toBeNull();
    expect(codingListService.getCodingListVariables).toHaveBeenCalledWith(7);
    expect(manualJobVariablesQuery.andWhere).toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(variableRecordsQuery.andWhere).toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(manualCodingQuery.andWhere).toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(worksheet?.getRow(1).getCell(4).value).toBe('UNIT_DERIVED');
    expect(worksheet?.getRow(1).getCell(5).value).toBeNull();
    expect(worksheet?.getRow(2).getCell(4).value).toBe('4');
  });

  it('includes selected training job variables in the manual-only aggregated export', async () => {
    const trainingOnlyVariable = {
      unitName: 'TRAINING_UNIT',
      // Keep an id ending in 0 because these can be absent from the coding-list-derived manual set.
      variableId: '10'
    };
    const createQueryBuilder = (rawRows: unknown[] = []) => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows)
      };
      return qb;
    };

    const manualJobVariablesQuery = createQueryBuilder([{
      unitName: trainingOnlyVariable.unitName,
      variableId: trainingOnlyVariable.variableId
    }]);
    const variableRecordsQuery = createQueryBuilder([{
      unitName: trainingOnlyVariable.unitName,
      variableId: trainingOnlyVariable.variableId,
      bookletName: 'BOOKLET-A'
    }]);
    const manualCodingQuery = createQueryBuilder([{
      personId: '10',
      unitName: trainingOnlyVariable.unitName,
      variableId: trainingOnlyVariable.variableId,
      cju_code: '1',
      coding_issue_option: null,
      code_v1: null,
      code_v2: null,
      code_v3: null,
      notes: null,
      username: 'Coder A',
      jobId: '1',
      trainingId: '21',
      missingsProfileId: null,
      responseId: '100'
    }]);
    const personResultsQuery = createQueryBuilder([{
      id: '10',
      login: 'login-a',
      code: 'code-a',
      group: 'group-a',
      bookletName: 'BOOKLET-A'
    }]);
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValueOnce(personResultsQuery)
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(manualJobVariablesQuery)
        .mockReturnValueOnce(variableRecordsQuery)
        .mockReturnValueOnce(manualCodingQuery)
    };
    const codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([])
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      responseRepository as unknown as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      codingListService as unknown as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    const buffer = await service.exportCodingResultsAggregated(
      7,
      false,
      false,
      false,
      false,
      'most-frequent',
      false,
      false,
      '',
      undefined,
      true,
      undefined,
      undefined,
      [21]
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Coding Results');

    expect(codingListService.getCodingListVariables).toHaveBeenCalledWith(7);
    expect(manualJobVariablesQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('cj.training_id IN (:...coderTrainingIds)'),
      { coderTrainingIds: [21] }
    );
    expect(manualJobVariablesQuery.andWhere).not.toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(variableRecordsQuery.andWhere).not.toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(manualCodingQuery.andWhere).not.toHaveBeenCalledWith('cj.training_id IS NULL');
    expect(worksheet?.getRow(1).getCell(4).value).toBe('TRAINING_UNIT_10');
    expect(worksheet?.getRow(2).getCell(4).value).toBe('1');
  });

  it('rejects coding-times export when scoped filters match no coded units', async () => {
    const codingTimesQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(codingTimesQueryBuilder)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };

    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );

    await expect(service.exportCodingTimesReport(
      1,
      false,
      false,
      false,
      undefined,
      [123]
    )).rejects.toThrow('Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter');
    expect(codingTimesQueryBuilder.andWhere).toHaveBeenCalledWith('cj.training_id IS NULL');
  });

  it('writes coding-times reports through the streaming file path', async () => {
    const codingTimesQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          variableId: 'VAR',
          updatedAt: new Date('2026-04-14T10:00:00.000Z'),
          unitName: 'UNIT',
          bookletName: 'BOOKLET-A',
          coderAssignmentId: 100,
          coderName: 'Coder A'
        }
      ])
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(codingTimesQueryBuilder)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-times-export-'));
    const filePath = path.join(tempDir, 'coding-times.xlsx');

    try {
      await service.exportCodingTimesReportToFile(filePath, 1);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.getWorksheet('Kodierzeiten-Bericht');

      expect(worksheet?.getRow(1).getCell(1).font?.bold).toBe(true);
      expect(worksheet?.getRow(2).getCell(1).value).toBe('UNIT');
      expect(worksheet?.getRow(2).getCell(2).value).toBe('VAR');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('checks cancellation throughout coding-times raw batch export', async () => {
    const firstBatch = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      variableId: 'VAR',
      updatedAt: new Date(`2026-04-14T10:${String(index % 60).padStart(2, '0')}:00.000Z`),
      unitName: `UNIT_${index}`,
      bookletName: 'BOOKLET-A',
      coderAssignmentId: 100,
      coderName: 'Coder A'
    }));
    const codingTimesQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(firstBatch)
    };
    const codingJobUnitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(codingTimesQueryBuilder)
    };
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    };
    const service = new CodingExportService(
      {} as Repository<ResponseEntity>,
      {} as Repository<CodingJob>,
      {} as Repository<CodingJobVariable>,
      codingJobUnitRepository as unknown as Repository<CodingJobUnit>,
      { find: jest.fn() } as unknown as Repository<CoderTrainingDiscussionResult>,
      { findBy: jest.fn() } as unknown as Repository<User>,
      {} as CodingListService,
      {} as WorkspaceCoreService,
      workspaceExclusionService as unknown as WorkspaceExclusionService
    );
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    await service.exportCodingTimesReport(
      1,
      false,
      false,
      false,
      checkCancellation
    );

    expect(codingTimesQueryBuilder.getRawMany).toHaveBeenCalledTimes(1);
    expect(checkCancellation.mock.calls.length).toBeGreaterThan(4);
  });
});
