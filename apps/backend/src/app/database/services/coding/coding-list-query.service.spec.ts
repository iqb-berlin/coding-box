import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Setting } from '../../entities/setting.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { WorkspaceFilesService, WorkspaceCoreService } from '../workspace';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { CodingListQueryService } from './coding-list-query.service';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';

type QueryBuilderMock = {
  innerJoin: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawMany: jest.Mock;
};

type VariableRow = {
  unitName: string;
  variableId: string;
  statusV1: number;
};

type CreateServiceOptions = {
  rawVariableRows?: VariableRow[];
  unitVariableMap?: Map<string, Set<string>>;
  trainingRequiredMap?: Map<string, Set<string>>;
  derivedVariablesBySourceMap?: Map<string, Set<string>>;
  manualInstructionMap?: Map<string, Set<string>>;
  replayAnchorMap?: Map<string, string>;
  includeDeriveErrorInManualCoding?: boolean;
  onQueryBuilderCreated?: (queryBuilder: QueryBuilderMock) => void;
};

describe('CodingListQueryService', () => {
  function createQueryBuilder(
    responses: ResponseEntity[],
    total: number,
    rawVariableRows: VariableRow[] = []
  ): QueryBuilderMock {
    const queryBuilder = {
      innerJoin: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      leftJoin: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([responses, total]),
      getRawMany: jest.fn().mockResolvedValue(rawVariableRows)
    };

    queryBuilder.innerJoin.mockReturnValue(queryBuilder);
    queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
    queryBuilder.leftJoin.mockReturnValue(queryBuilder);
    queryBuilder.select.mockReturnValue(queryBuilder);
    queryBuilder.addSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);

    return queryBuilder;
  }

  function createFile(fileId: string, data: unknown): Partial<FileUpload> {
    return {
      file_id: fileId,
      file_type: 'Resource',
      workspace_id: 1,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    };
  }

  function createFileRepository(files: Record<string, Partial<FileUpload>>) {
    return {
      findOne: jest.fn(({ where }: { where: { file_id: string } }) => (
        Promise.resolve(files[where.file_id] ?? null)
      ))
    } as unknown as Repository<FileUpload> & { findOne: jest.Mock };
  }

  function createService(
    responses: ResponseEntity[],
    fileRepository: Repository<FileUpload>,
    options: CreateServiceOptions = {}
  ): CodingListQueryService {
    const queryBuilder = createQueryBuilder(
      responses,
      responses.length,
      options.rawVariableRows
    );
    options.onQueryBuilderCreated?.(queryBuilder);
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    } as unknown as Repository<ResponseEntity>;
    const fileCacheService = new CodingFileCacheService(fileRepository);
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(
        options.unitVariableMap ??
          new Map([['UNIT', new Set(['VAR_WITH_OVERRIDE', 'VAR_ON_ONLY_PAGE'])]])
      ),
      getIntendedIncompleteSchemeVariableMap: jest.fn().mockResolvedValue(new Map()),
      getCoderTrainingRequiredVariableMap: jest.fn().mockResolvedValue(
        options.trainingRequiredMap ?? new Map()
      ),
      getDerivedVariablesBySourceMap: jest.fn().mockResolvedValue(
        options.derivedVariablesBySourceMap ?? new Map()
      ),
      getManualInstructionVariableMap: jest.fn().mockResolvedValue(
        options.manualInstructionMap ?? new Map()
      )
    } as unknown as WorkspaceFilesService;
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    const replayAnchorService = {
      getVariableAnchorMaps: jest.fn().mockImplementation(
        async (unitNames: string[]) => new Map(
          unitNames.map(unitName => [
            unitName,
            options.replayAnchorMap ?? new Map<string, string>()
          ])
        )
      )
    } as unknown as CodingReplayAnchorService;
    const settingRepository = {
      findOne: jest.fn().mockResolvedValue(
        options.includeDeriveErrorInManualCoding ?
          {
            key: 'workspace-1-include-derive-error-in-manual-coding',
            content: JSON.stringify({ enabled: true })
          } :
          null
      )
    } as unknown as Repository<Setting>;

    return new CodingListQueryService(
      responseRepository,
      fileCacheService,
      workspaceFilesService,
      {} as unknown as WorkspaceCoreService,
      workspaceExclusionService,
      replayAnchorService,
      settingRepository
    );
  }

  it('uses VOCS page overrides for coding-list variable_page and replay URL', async () => {
    const fileRepository = createFileRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_ON_FIRST_AUTO_PAGE' }] }] },
          { sections: [{ elements: [{ id: 'VAR_ON_SECOND_AUTO_PAGE' }] }] },
          { sections: [{ elements: [{ id: 'VAR_WITH_OVERRIDE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_WITH_OVERRIDE', page: '2' }
        ]
      })
    });
    const response = {
      id: 1,
      variableid: 'VAR_WITH_OVERRIDE',
      value: 'Antwort',
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      unit: {
        name: 'UNIT',
        alias: 'Unit Alias',
        booklet: {
          person: {
            login: 'login',
            code: 'code',
            group: 'group'
          },
          bookletinfo: {
            name: 'BOOKLET'
          }
        }
      }
    } as unknown as ResponseEntity;
    const service = createService([response], fileRepository);

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      variable_id: 'VAR_WITH_OVERRIDE',
      variable_page: '1',
      variable_anchor: 'VAR_WITH_OVERRIDE',
      url: 'https://iqb-kodierbox.de/#/replay/login@code@group@BOOKLET/UNIT/1/VAR_WITH_OVERRIDE?auth=token'
    });
  });

  it('keeps single-page coding-list replay URLs on page 0', async () => {
    const fileRepository = createFileRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_ON_ONLY_PAGE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_ON_ONLY_PAGE', page: '1' }
        ]
      })
    });
    const response = {
      id: 1,
      variableid: 'VAR_ON_ONLY_PAGE',
      value: 'Antwort',
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      unit: {
        name: 'UNIT',
        alias: 'Unit Alias',
        booklet: {
          person: {
            login: 'login',
            code: 'code',
            group: 'group'
          },
          bookletinfo: {
            name: 'BOOKLET'
          }
        }
      }
    } as unknown as ResponseEntity;
    const service = createService([response], fileRepository);

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      variable_id: 'VAR_ON_ONLY_PAGE',
      variable_page: '0',
      variable_anchor: 'VAR_ON_ONLY_PAGE',
      url: 'https://iqb-kodierbox.de/#/replay/login@code@group@BOOKLET/UNIT/0/VAR_ON_ONLY_PAGE?auth=token'
    });
  });

  it('encodes replay anchor overrides in coding-list replay URLs', async () => {
    const fileRepository = createFileRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_WITH_OVERRIDE' }] }] }
        ]
      })
    });
    const response = {
      id: 1,
      variableid: 'VAR_WITH_OVERRIDE',
      value: 'Antwort',
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      unit: {
        name: 'UNIT',
        alias: 'Unit Alias',
        booklet: {
          person: {
            login: 'login',
            code: 'code',
            group: 'group'
          },
          bookletinfo: {
            name: 'BOOKLET'
          }
        }
      }
    } as unknown as ResponseEntity;
    const service = createService([response], fileRepository, {
      replayAnchorMap: new Map([['VAR_WITH_OVERRIDE', 'TEXT/Anchor 1']])
    });

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items[0]).toMatchObject({
      variable_anchor: 'TEXT/Anchor 1',
      url: 'https://iqb-kodierbox.de/#/replay/login@code@group@BOOKLET/UNIT/0/TEXT%2FAnchor%201?auth=token'
    });
  });

  it('does not include DERIVE_ERROR responses in the default coding list selection', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['DERIVE_VAR', 'INCOMPLETE_VAR'])
    ]]);
    const responses = [
      {
        id: 1,
        variableid: 'DERIVE_VAR',
        value: 'O',
        status_v1: statusStringToNumber('DERIVE_ERROR'),
        unit: {
          name: 'UNIT',
          alias: 'Unit Alias',
          booklet: {
            person: {
              login: 'login',
              code: 'code',
              group: 'group'
            },
            bookletinfo: {
              name: 'BOOKLET'
            }
          }
        }
      },
      {
        id: 2,
        variableid: 'INCOMPLETE_VAR',
        value: 'Antwort',
        status_v1: statusStringToNumber('CODING_INCOMPLETE'),
        unit: {
          name: 'UNIT',
          alias: 'Unit Alias',
          booklet: {
            person: {
              login: 'login',
              code: 'code',
              group: 'group'
            },
            bookletinfo: {
              name: 'BOOKLET'
            }
          }
        }
      }
    ] as unknown as ResponseEntity[];
    const service = createService(responses, createFileRepository({}), {
      unitVariableMap
    });

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items.map(item => item.variable_id)).toEqual(['INCOMPLETE_VAR']);
  });

  it('includes scoped DERIVE_ERROR responses when manual coding is enabled', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['SOURCE_VAR', 'DERIVED_VAR'])
    ]]);
    const derivedVariablesBySourceMap = new Map([
      [getManualCodingScopeKey('UNIT', 'SOURCE_VAR'), new Set(['DERIVED_VAR'])]
    ]);
    const manualInstructionMap = new Map([[
      'UNIT',
      new Set(['DERIVED_VAR'])
    ]]);
    const createResponse = (
      id: number,
      variableId: string
    ): ResponseEntity => ({
      id,
      variableid: variableId,
      value: 'O',
      status_v1: statusStringToNumber('DERIVE_ERROR'),
      unit: {
        name: 'UNIT',
        alias: 'Unit Alias',
        booklet: {
          person: {
            login: 'login',
            code: 'code',
            group: 'group'
          },
          bookletinfo: {
            name: 'BOOKLET'
          }
        }
      }
    }) as unknown as ResponseEntity;
    const service = createService(
      [
        createResponse(1, 'SOURCE_VAR'),
        createResponse(2, 'DERIVED_VAR')
      ],
      createFileRepository({}),
      {
        unitVariableMap,
        derivedVariablesBySourceMap,
        manualInstructionMap,
        includeDeriveErrorInManualCoding: true
      }
    );

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        variable_id: 'DERIVED_VAR',
        status_v1: 'DERIVE_ERROR'
      })
    ]);
    expect(result.total).toBe(1);
  });

  it('excludes intended incomplete coding-list responses without manual instruction', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['MANUAL_VAR', 'AUTO_ONLY_VAR'])
    ]]);
    const manualInstructionMap = new Map([[
      'UNIT',
      new Set(['MANUAL_VAR'])
    ]]);
    const responses = [
      {
        id: 1,
        variableid: 'MANUAL_VAR',
        value: 'Antwort',
        status_v1: statusStringToNumber('INTENDED_INCOMPLETE'),
        unit: {
          name: 'UNIT',
          alias: 'Unit Alias',
          booklet: {
            person: {
              login: 'login',
              code: 'code',
              group: 'group'
            },
            bookletinfo: {
              name: 'BOOKLET'
            }
          }
        }
      },
      {
        id: 2,
        variableid: 'AUTO_ONLY_VAR',
        value: 'Antwort',
        status_v1: statusStringToNumber('INTENDED_INCOMPLETE'),
        unit: {
          name: 'UNIT',
          alias: 'Unit Alias',
          booklet: {
            person: {
              login: 'login',
              code: 'code',
              group: 'group'
            },
            bookletinfo: {
              name: 'BOOKLET'
            }
          }
        }
      }
    ] as unknown as ResponseEntity[];
    const service = createService(responses, createFileRepository({}), {
      unitVariableMap,
      manualInstructionMap
    });

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items.map(item => item.variable_id)).toEqual(['MANUAL_VAR']);
  });

  it('excludes intended source variables only when their derived variable remains in the same manual scope', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['BASE_VAR', 'DERIVED_VAR', 'STANDALONE_VAR'])
    ]]);
    const trainingRequiredMap = new Map([[
      'UNIT',
      new Set(['BASE_VAR', 'STANDALONE_VAR'])
    ]]);
    const derivedVariablesBySourceMap = new Map([
      [getManualCodingScopeKey('UNIT', 'BASE_VAR'), new Set(['DERIVED_VAR'])]
    ]);
    const manualInstructionMap = new Map([[
      'UNIT',
      new Set(['BASE_VAR', 'STANDALONE_VAR'])
    ]]);
    const rawVariableRows = [
      {
        unitName: 'UNIT',
        variableId: 'DERIVED_VAR',
        statusV1: statusStringToNumber('CODING_INCOMPLETE')
      },
      {
        unitName: 'UNIT',
        variableId: 'BASE_VAR',
        statusV1: statusStringToNumber('INTENDED_INCOMPLETE')
      },
      {
        unitName: 'UNIT',
        variableId: 'STANDALONE_VAR',
        statusV1: statusStringToNumber('INTENDED_INCOMPLETE')
      }
    ];
    const service = createService([], createFileRepository({}), {
      rawVariableRows,
      unitVariableMap,
      trainingRequiredMap,
      derivedVariablesBySourceMap,
      manualInstructionMap
    });

    await expect(service.getCodingListVariables(1)).resolves.toEqual([
      { unitName: 'UNIT', variableId: 'DERIVED_VAR' },
      { unitName: 'UNIT', variableId: 'STANDALONE_VAR' }
    ]);
    await expect(service.getCodingListVariables(1, true)).resolves.toEqual([
      { unitName: 'UNIT', variableId: 'BASE_VAR' },
      { unitName: 'UNIT', variableId: 'STANDALONE_VAR' }
    ]);
  });

  it('does not include DERIVE_ERROR variables in default coding-list variable selection', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['DERIVE_VAR', 'INCOMPLETE_VAR'])
    ]]);
    const rawVariableRows = [
      {
        unitName: 'UNIT',
        variableId: 'DERIVE_VAR',
        statusV1: statusStringToNumber('DERIVE_ERROR')
      },
      {
        unitName: 'UNIT',
        variableId: 'INCOMPLETE_VAR',
        statusV1: statusStringToNumber('CODING_INCOMPLETE')
      }
    ];
    const service = createService([], createFileRepository({}), {
      rawVariableRows,
      unitVariableMap
    });

    await expect(service.getCodingListVariables(1)).resolves.toEqual([
      { unitName: 'UNIT', variableId: 'INCOMPLETE_VAR' }
    ]);
  });

  it('includes DERIVE_ERROR variables when manual coding is enabled', async () => {
    const unitVariableMap = new Map([[
      'UNIT',
      new Set(['DERIVE_VAR', 'INCOMPLETE_VAR'])
    ]]);
    const rawVariableRows = [
      {
        unitName: 'UNIT',
        variableId: 'DERIVE_VAR',
        statusV1: statusStringToNumber('DERIVE_ERROR')
      },
      {
        unitName: 'UNIT',
        variableId: 'INCOMPLETE_VAR',
        statusV1: statusStringToNumber('CODING_INCOMPLETE')
      }
    ];
    const service = createService([], createFileRepository({}), {
      rawVariableRows,
      unitVariableMap,
      includeDeriveErrorInManualCoding: true
    });

    await expect(service.getCodingListVariables(1)).resolves.toEqual([
      { unitName: 'UNIT', variableId: 'DERIVE_VAR' },
      { unitName: 'UNIT', variableId: 'INCOMPLETE_VAR' }
    ]);
  });

  it('uses the shared response candidate filters for coding-list variables', async () => {
    let queryBuilder: QueryBuilderMock | undefined;
    const service = createService([], createFileRepository({}), {
      rawVariableRows: [],
      unitVariableMap: new Map(),
      onQueryBuilderCreated: createdQueryBuilder => {
        queryBuilder = createdQueryBuilder;
      }
    });

    await service.getCodingListVariables(1);

    const conditions = queryBuilder?.andWhere.mock.calls
      .map(([condition]) => String(condition)) ?? [];
    expect(conditions).toContain(
      "response.value IS NOT NULL AND response.value ~ '[^[:space:]]'"
    );
    expect(conditions).toEqual(expect.arrayContaining([
      expect.stringContaining("response.variableid NOT ILIKE '%image%'"),
      expect.stringContaining("response.variableid NOT ILIKE '%\\_0%'")
    ]));
  });
});
