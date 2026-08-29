import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as Autocoder from '@iqb/responses';
import { Repository } from 'typeorm';
import { CodingProcessService } from './coding-process.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { ResponseManagementService } from '../test-results/response-management.service';
import { AutocoderSourceRevisionStaleError } from '../test-results/autocoder-source-revision-stale.error';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingReadinessService } from './coding-readiness.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { RuntimeConfigService } from '../../../config/runtime-config.service';

jest.mock('@iqb/responses', () => ({
  CodingSchemeFactory: {
    code: jest.fn().mockReturnValue([]),
    validate: jest.fn().mockReturnValue([]),
    getVariableDependencyTree: jest.fn().mockImplementation(
      variableCodings => jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      ).CodingSchemeFactory.getVariableDependencyTree(variableCodings)
    )
  }
}));

jest.mock('cheerio', () => ({
  load: jest.fn().mockImplementation(() => (selector: string) => ({
    text: jest.fn().mockReturnValue(
      selector === 'codingSchemeRef' ? 'test-scheme-ref' : ''
    )
  }))
}));

describe('CodingProcessService', () => {
  let service: CodingProcessService;
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let fileUploadRepository: Repository<FileUpload>;
  let mockUnits: Unit[];
  let mockResponses: ResponseEntity[];

  const mockJobQueueService = {
    getTestPersonCodingJob: jest.fn(),
    addTestPersonCodingJob: jest.fn().mockResolvedValue({ id: 'job-123' })
  };

  const mockResponseManagementService = {
    updateResponsesInDatabase: jest.fn().mockResolvedValue(true)
  };

  const mockWorkspaceFilesService = {
    getUnitVariableMap: jest.fn(),
    getVariableInfoForScheme: jest.fn().mockResolvedValue([])
  };

  const mockCodingReadinessService = {
    assertAutoCodingCanProcess: jest.fn().mockResolvedValue(undefined),
    filterResponsesCodeable: jest.fn(
      async (
        workspaceId: number,
        responses: ResponseEntity[],
        units: Unit[]
      ) => {
        const unitVariables = await mockWorkspaceFilesService.getUnitVariableMap(workspaceId);
        const unitIdToName = new Map(
          units.map(unit => [unit.id, unit.name.toUpperCase()])
        );

        return responses.filter(response => {
          const unitName = unitIdToName.get(response.unitid);
          const validVars = unitName ? unitVariables.get(unitName) : undefined;
          return validVars?.has(response.variableid) === true;
        });
      }
    )
  };

  const mockWorkspaceCoreService = {
    getIgnoredUnits: jest.fn().mockResolvedValue([])
  };

  const mockWorkspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  };

  const mockCodingStatisticsService = {
    refreshStatistics: jest.fn()
  };

  // Helper functions
  const createMockPerson = (id: number, workspaceId: number = 1) => ({
    id,
    workspace_id: workspaceId,
    group: 'test_group',
    login: `test_person_${id}`,
    code: `code_${id}`,
    consider: true,
    uploaded_at: new Date()
  });

  const createMockBooklet = (id: number, personId: number) => ({
    id,
    personid: personId
  });

  const createMockUnit = (id: number, bookletId: number, name: string = `unit_${id}`, alias: string = `alias_${id}`): Unit => ({
    id,
    bookletid: bookletId,
    name,
    alias
  } as Unit);

  const createMockResponse = (
    id: number,
    unitId: number,
    variableId: string,
    value: string = 'test_value',
    status: number = 3
  ): ResponseEntity => ({
    id,
    unitid: unitId,
    variableid: variableId,
    value,
    status,
    status_v1: status,
    status_v2: null,
    status_v3: null,
    code_v1: null,
    code_v2: null,
    code_v3: null,
    score_v1: null,
    score_v2: null,
    score_v3: null,
    is_autocoder_generated: false,
    autocoder_invalidated_version: null,
    inherits_v1_for_v2: false,
    subform: '',
    unit: undefined
  });

  const createMockFileUpload = (fileId: string, data: string) => ({
    file_id: fileId,
    data,
    filename: `${fileId}.xml`
  });

  interface MockQueryBuilder {
    select: jest.Mock;
    addSelect: jest.Mock;
    leftJoin: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    innerJoin: jest.Mock;
    innerJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    addGroupBy: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getRawMany: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
    getRawOne: jest.Mock;
  }

  let mockQueryBuilder: MockQueryBuilder;
  let mockUnitQueryBuilder: Partial<MockQueryBuilder>;
  let mockQueryRunner: {
    connect: jest.Mock;
    query: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
    isReleased: boolean;
    manager: {
      update: jest.Mock;
      query: jest.Mock;
      getRepository: jest.Mock;
    };
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getCount: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn()
    };

    mockUnitQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };

    mockQueryRunner = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
      startTransaction: jest.fn().mockImplementation(async () => {
        mockQueryRunner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        mockQueryRunner.isTransactionActive = false;
      }),
      release: jest.fn().mockImplementation(async () => {
        mockQueryRunner.isReleased = true;
      }),
      isTransactionActive: false,
      isReleased: false,
      manager: {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
        })
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingProcessService,
        {
          provide: WorkspaceExclusionService,
          useValue: mockWorkspaceExclusionService
        },
        {
          provide: getRepositoryToken(FileUpload),
          useValue: {
            find: jest.fn(),
            findBy: jest.fn(),
            findOne: jest.fn(),
            query: jest.fn()
          }
        },
        { provide: getRepositoryToken(Persons), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Unit), useValue: { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) } },
        { provide: getRepositoryToken(Booklet), useValue: { find: jest.fn(), createQueryBuilder: jest.fn() } },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            query: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockImplementation(() => mockQueryBuilder),
            manager: {
              connection: {
                createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
              }
            }
          }
        },
        { provide: JobQueueService, useValue: mockJobQueueService },
        { provide: ResponseManagementService, useValue: mockResponseManagementService },
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        { provide: CodingReadinessService, useValue: mockCodingReadinessService },
        { provide: CodingStatisticsService, useValue: mockCodingStatisticsService },
        { provide: WorkspaceCoreService, useValue: mockWorkspaceCoreService },
        {
          provide: RuntimeConfigService,
          useValue: { autocoderSchemaValidationMode: 'compatible' }
        }
      ]
    }).compile();

    service = module.get<CodingProcessService>(CodingProcessService);
    personsRepository = module.get<Repository<Persons>>(getRepositoryToken(Persons));
    bookletRepository = module.get<Repository<Booklet>>(getRepositoryToken(Booklet));
    unitRepository = module.get<Repository<Unit>>(getRepositoryToken(Unit));
    responseRepository = module.get<Repository<ResponseEntity>>(getRepositoryToken(ResponseEntity));
    fileUploadRepository = module.get<Repository<FileUpload>>(getRepositoryToken(FileUpload));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('autocoder persistence session', () => {
    it('holds a session lock without opening an idle transaction', async () => {
      const runner = await service.beginAutocoderPersistenceSession(7);

      expect(runner).toBe(mockQueryRunner);
      expect(mockQueryRunner.connect).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        "SET lock_timeout = '30s'"
      );
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_lock($1::int, $2::int)',
        [774020251, 7]
      );
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_lock($1::int, $2::int)',
        [774020252, 7]
      );
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();

      await service.releaseAutocoderPersistenceSession(runner, 7);
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::int, $2::int)',
        [774020252, 7]
      );
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1::int, $2::int)',
        [774020251, 7]
      );
      expect(mockQueryRunner.query).toHaveBeenCalledWith('RESET lock_timeout');
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('autocoder preflight cache preparation', () => {
    it('clears parsed file caches without an additional file fingerprint query', () => {
      const invalidateSpy = jest.spyOn(service, 'invalidateWorkspaceCaches');

      service.prepareAutocoderPreflight(7);

      expect(invalidateSpy).toHaveBeenCalledWith(7);
      expect(fileUploadRepository.query).not.toHaveBeenCalled();
    });
  });

  describe('codeUnitIds', () => {
    it('uses array parameters for large unit-scoped autocoding jobs', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { unitId: '1', personId: '1', groupName: 'Group A' },
        { unitId: '2', personId: '2', groupName: 'Group B' }
      ]);

      await service.codeUnitIds(1, [1, 2], 1, {
        source: 'coding-freshness',
        freshnessVersion: 'v1',
        freshnessStates: ['PENDING', 'STALE'],
        freshnessSourceRevision: 42
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.id = ANY(:unitIds)',
        { unitIds: [1, 2] }
      );
      expect(mockCodingReadinessService.assertAutoCodingCanProcess)
        .toHaveBeenCalledWith(1, {
          unitIds: [1, 2],
          autoCoderRun: 1
        });
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
        workspaceId: 1,
        personIds: ['1', '2'],
        unitIds: [1, 2],
        groupNames: 'Group A,Group B',
        autoCoderRun: 1,
        source: 'coding-freshness',
        freshnessVersion: 'v1',
        freshnessStates: ['PENDING', 'STALE'],
        freshnessSourceRevision: 42
      });
    });
  });

  describe('processTestPersonsBatch', () => {
    const workspaceId = 1;
    const personIds = ['1', '2'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue(undefined);
      mockResponseManagementService.updateResponsesInDatabase.mockImplementation(
        async () => {
          mockQueryRunner.isTransactionActive = false;
          mockQueryRunner.isReleased = true;
          return true;
        }
      );

      personsRepository.find = jest.fn().mockResolvedValue([
        createMockPerson(1),
        createMockPerson(2)
      ]);

      const mockBookletQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          createMockBooklet(1, 1),
          createMockBooklet(2, 2)
        ])
      };
      bookletRepository.createQueryBuilder = jest.fn().mockReturnValue(mockBookletQueryBuilder);

      mockUnits = [
        createMockUnit(1, 1, 'TEST_UNIT_1', 'ALIAS_1'),
        createMockUnit(2, 2, 'TEST_UNIT_2', 'ALIAS_2')
      ];

      mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];

      // Default query builder behavior
      mockQueryBuilder.getMany.mockResolvedValue([]);

      // The service converts unit names to uppercase when building the validVariableSets map
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1'])],
          ['TEST_UNIT_2', new Set(['var2'])]
        ])
      );

      fileUploadRepository.find = jest.fn()
        .mockResolvedValueOnce([ // coding schemes
          createMockFileUpload('SCHEME_1', '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'),
          createMockFileUpload('SCHEME_2', '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>')
        ])
        .mockResolvedValueOnce([ // test files
          createMockFileUpload('ALIAS_1', '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'),
          createMockFileUpload('ALIAS_2', '<xml><codingSchemeRef>SCHEME_2</codingSchemeRef></xml>')
        ])
        .mockResolvedValueOnce([]); // coding schemes again

      fileUploadRepository.findOne = jest.fn().mockImplementation(options => {
        if (options.where.file_id === 'SCHEME_1') {
          return Promise.resolve(createMockFileUpload('SCHEME_1', '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'));
        }
        if (options.where.file_id === 'SCHEME_2') {
          return Promise.resolve(createMockFileUpload('SCHEME_2', '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'));
        }
        return Promise.resolve(null);
      });
    });

    const configureDerivedSecondRun = (
      sourceResponse: ResponseEntity,
      derivedResponse: ResponseEntity,
      additionalResponses: ResponseEntity[] = [],
      variableCodings: object[] = [
        { id: 'source', sourceType: 'BASE' },
        {
          id: 'derived-target',
          alias: '_01',
          sourceType: 'CONCAT_CODE',
          deriveSources: ['source'],
          codeModel: 'MANUAL_AND_RULES',
          codes: [
            {
              id: 4,
              score: 0,
              ruleSets: [
                {
                  rules: [
                    { method: 'MATCH', parameters: ['1'] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    ) => {
      const actualAutocoder = jest.requireActual<
      typeof import('@iqb/responses')
      >('@iqb/responses');
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockImplementation(
        actualAutocoder.CodingSchemeFactory.code
      );
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([[
          'TEST_UNIT_1',
          new Set([
            sourceResponse.variableid,
            derivedResponse.variableid,
            ...additionalResponses.map(response => response.variableid)
          ])
        ]])
      );
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([
          sourceResponse,
          derivedResponse,
          ...additionalResponses
        ]);
      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>TEST-SCHEME-REF</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'TEST-SCHEME-REF',
            JSON.stringify({
              version: '3.4',
              variableCodings
            })
          )
        ]);
    };

    it('should handle an empty person IDs array', async () => {
      // Override mocks to ensure no data is returned for empty array
      personsRepository.find = jest.fn().mockResolvedValue([]);
      const emptyBookletQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      bookletRepository.createQueryBuilder = jest.fn().mockReturnValue(emptyBookletQueryBuilder);
      mockUnitQueryBuilder = unitRepository.createQueryBuilder('unit') as unknown as MockQueryBuilder;
      (mockUnitQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);
      responseRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(workspaceId, [], autoCoderRun);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no persons found', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
      expect(mockQueryRunner.connect).not.toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
    });

    it('releases the connection even when rollback fails', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);
      mockResponseManagementService.updateResponsesInDatabase
        .mockRejectedValueOnce(new Error('update failed'));
      mockQueryRunner.rollbackTransaction.mockRejectedValueOnce(
        new Error('rollback failed')
      );

      await expect(
        service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun)
      ).rejects.toThrow('rollback failed');

      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it.each<[string, number]>([
      ['coding scheme extraction', 10],
      ['coding scheme loading', 12],
      ['response processing', 14]
    ])('does not open a transaction when cancelled during %s', async (
      _stage,
      pauseOnCheck
    ) => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      let cancellationChecks = 0;
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockImplementation(
        async () => ({
          data: { isPaused: false },
          getState: jest.fn().mockImplementation(async () => {
            cancellationChecks += 1;
            return cancellationChecks >= pauseOnCheck ? 'paused' : 'active';
          })
        })
      );

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(cancellationChecks).toBeGreaterThanOrEqual(pauseOnCheck);
      expect(mockQueryRunner.connect).not.toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('propagates persistence errors so the job fails', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);
      const persistenceError = new Error('update failed');
      mockResponseManagementService.updateResponsesInDatabase
        .mockRejectedValueOnce(persistenceError);

      await expect(service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      )).rejects.toBe(persistenceError);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('returns without rechecking mutable job state when persistence reports cancellation', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        data: { isPaused: false },
        getState: jest.fn().mockResolvedValue('active')
      });

      let cancellationChecksAtPersistence = 0;
      mockResponseManagementService.updateResponsesInDatabase
        .mockImplementationOnce(async () => {
          cancellationChecksAtPersistence =
            mockJobQueueService.getTestPersonCodingJob.mock.calls.length;
          await mockQueryRunner.rollbackTransaction();
          await mockQueryRunner.release();
          return false;
        });

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(cancellationChecksAtPersistence).toBeGreaterThan(0);
      expect(mockJobQueueService.getTestPersonCodingJob)
        .toHaveBeenCalledTimes(cancellationChecksAtPersistence);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
      expect(result.totalResponses).toBe(2);
    });

    it('should handle no booklets found', async () => {
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockUnits); // Units found initially
      const emptyBookletQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      bookletRepository.createQueryBuilder = jest.fn().mockReturnValue(emptyBookletQueryBuilder);

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('uses array parameters for batch booklets and scoped units', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId,
        [1, 2]
      );

      const bookletQueryBuilder =
        (bookletRepository.createQueryBuilder as jest.Mock).mock.results[0].value;
      expect(bookletQueryBuilder.where).toHaveBeenCalledWith(
        'booklet.personid = ANY(:personIds)',
        { personIds: [1, 2] }
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'unit.bookletid = ANY(:bookletIds)',
        { bookletIds: [1, 2] }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.id = ANY(:unitIds)',
        { unitIds: [1, 2] }
      );
    });

    it('should handle no units found', async () => {
      mockQueryBuilder.getMany.mockResolvedValueOnce([]); // No units found

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no responses found', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce([]); // No responses found

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should filter out invalid variables not defined in unit schema', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce([
          createMockResponse(1, 1, 'var1'), // valid
          createMockResponse(2, 1, 'invalid_var'), // invalid
          createMockResponse(3, 2, 'var2'), // valid
          createMockResponse(4, 2, 'another_invalid') // invalid
        ]);

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun);

      expect(result.totalResponses).toBe(2); // Only valid variables processed
    });

    it('should handle job cancellation during processing', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('paused'),
        data: { isPaused: true }
      });

      const result = await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun, undefined, jobId);

      expect(result.totalResponses).toBe(0); // Processing stopped early
    });

    it('should use v2 status for autoCoderRun = 2', async () => {
      const responsesWithV2 = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];
      responsesWithV2[0].status_v2 = 2;
      responsesWithV2[1].status_v2 = 1;

      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(responsesWithV2);

      const result = await service.processTestPersonsBatch(workspaceId, personIds, 2);

      expect(result.totalResponses).toBe(2);
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.any(Array),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1, 2],
            autoCoderRun: 2,
            markCurrentVersion: 'v3'
          })
        );
    });

    it('should select v2 code, score, and subform fields for the second autocoder run', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        expect.arrayContaining([
          'ResponseEntity.subform',
          'ResponseEntity.code_v1',
          'ResponseEntity.score_v1',
          'ResponseEntity.code_v2',
          'ResponseEntity.score_v2'
        ])
      );
    });

    it('passes the planned freshness revision into autocoder result updates', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2,
        undefined,
        undefined,
        undefined,
        42
      );

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.any(Array),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1, 2],
            autoCoderRun: 2,
            markCurrentVersion: 'v3',
            expectedSourceRevision: 42
          })
        );
    });

    it('propagates stale planned freshness revisions as job failures', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      const staleRevisionError = new AutocoderSourceRevisionStaleError(workspaceId, 42);
      mockResponseManagementService.updateResponsesInDatabase
        .mockRejectedValueOnce(staleRevisionError);

      await expect(service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2,
        undefined,
        undefined,
        undefined,
        42
      )).rejects.toBe(staleRevisionError);
    });

    it('should pass v2 code and score to the second autocoder run', async () => {
      const responsesWithV2 = [
        createMockResponse(1, 1, 'var1')
      ];
      responsesWithV2[0].status_v1 = 8;
      responsesWithV2[0].code_v1 = 1;
      responsesWithV2[0].score_v1 = 1;
      responsesWithV2[0].status_v2 = 5;
      responsesWithV2[0].code_v2 = 0;
      responsesWithV2[0].score_v2 = 0;

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce(responsesWithV2);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalled();
      const [inputResponses] = (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.calls[0];
      expect(inputResponses[0]).toEqual(expect.objectContaining({
        id: 'var1',
        status: 'CODING_COMPLETE',
        code: 0,
        score: 0
      }));
    });

    it('should preserve an explicit null v2 score for the second autocoder run', async () => {
      const responsesWithV2 = [
        createMockResponse(1, 1, 'var1')
      ];
      responsesWithV2[0].status_v1 = 8;
      responsesWithV2[0].code_v1 = 1;
      responsesWithV2[0].score_v1 = 1;
      responsesWithV2[0].status_v2 = 5;
      responsesWithV2[0].code_v2 = -17;
      responsesWithV2[0].score_v2 = null;

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce(responsesWithV2);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      const [inputResponses] = (
        Autocoder.CodingSchemeFactory.code as jest.Mock
      ).mock.calls[0];
      expect(inputResponses[0]).toEqual(expect.objectContaining({
        id: 'var1',
        status: 'CODING_COMPLETE',
        code: -17,
        score: undefined
      }));
    });

    it('should fall back to the complete v1 tuple for an open v2 placeholder', async () => {
      const responsesWithOpenV2Placeholder = [
        createMockResponse(1, 1, 'var1')
      ];
      responsesWithOpenV2Placeholder[0].status_v1 = 5;
      responsesWithOpenV2Placeholder[0].code_v1 = 1;
      responsesWithOpenV2Placeholder[0].score_v1 = 1;
      responsesWithOpenV2Placeholder[0].status_v2 = 8;
      responsesWithOpenV2Placeholder[0].code_v2 = null;
      responsesWithOpenV2Placeholder[0].score_v2 = null;

      (responseRepository.query as jest.Mock).mockResolvedValueOnce([
        { id: 1 }
      ]);

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce(responsesWithOpenV2Placeholder);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      const [inputResponses] = (
        Autocoder.CodingSchemeFactory.code as jest.Mock
      ).mock.calls[0];
      expect(inputResponses[0]).toEqual(expect.objectContaining({
        id: 'var1',
        status: 'CODING_COMPLETE',
        code: 1,
        score: 1
      }));
    });

    it('does not inherit v1 for an applied incomplete v2 result', async () => {
      const responseWithAppliedV2Result = createMockResponse(1, 1, 'var1');
      responseWithAppliedV2Result.status_v1 = 5;
      responseWithAppliedV2Result.code_v1 = 1;
      responseWithAppliedV2Result.score_v1 = 1;
      responseWithAppliedV2Result.status_v2 = 8;
      responseWithAppliedV2Result.code_v2 = null;
      responseWithAppliedV2Result.score_v2 = null;

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([responseWithAppliedV2Result]);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      expect(responseRepository.query).toHaveBeenCalledWith(
        expect.stringContaining("effective_status_applied_cj.status = 'results_applied'"),
        [[1]]
      );
      const [inputResponses] = (
        Autocoder.CodingSchemeFactory.code as jest.Mock
      ).mock.calls[0];
      expect(inputResponses[0]).toEqual(expect.objectContaining({
        id: 'var1',
        status: 'CODING_INCOMPLETE',
        code: undefined,
        score: undefined
      }));
    });

    it('should pass generated manual v2 responses to the second autocoder run', async () => {
      const baseResponse = createMockResponse(1, 1, 'var1');
      const generatedManualResponse = createMockResponse(2, 1, 'derived_var', '1_0');
      generatedManualResponse.is_autocoder_generated = true;
      generatedManualResponse.status_v1 = 8;
      generatedManualResponse.code_v1 = null;
      generatedManualResponse.score_v1 = null;
      generatedManualResponse.status_v2 = 5;
      generatedManualResponse.code_v2 = 0;
      generatedManualResponse.score_v2 = 0;
      generatedManualResponse.subform = null as unknown as string;

      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1', 'derived_var'])]
        ])
      );
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([baseResponse, generatedManualResponse]);

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalled();
      const [inputResponses] = (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.calls[0];
      expect(inputResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived_var',
          value: '1_0',
          status: 'CODING_COMPLETE',
          code: 0,
          score: 0,
          subform: undefined
        })
      ]));
    });

    it('recalculates a legacy generated INVALID derived response in run 2', async () => {
      const sourceResponse = createMockResponse(
        1,
        1,
        'source',
        'source-value'
      );
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 1;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 7;
      derivedResponse.code_v1 = null;
      derivedResponse.score_v1 = null;

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.calls[0][0]
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-target',
          status: 'UNSET',
          code: undefined,
          score: undefined
        })
      ]));

      expect(
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1]
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        })
      ]));
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 2 });
    });

    it('does not reinterpret an imported INVALID base response in run 2', async () => {
      const invalidBaseResponse = createMockResponse(1, 1, 'source', '');
      invalidBaseResponse.status_v1 = 7;
      invalidBaseResponse.code_v1 = null;
      invalidBaseResponse.score_v1 = null;
      const derivedResponse = createMockResponse(2, 1, '_01', '');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 7;

      configureDerivedSecondRun(invalidBaseResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1]
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          code_v3: null,
          status_v3: 'INVALID',
          score_v3: null
        })
      ]));
      expect(result.statusCounts).toEqual({ INVALID: 2 });
    });

    it('does not treat an output alias as a colliding derived technical ID', () => {
      const generatedResponse = createMockResponse(1, 1, '06', '');
      generatedResponse.is_autocoder_generated = true;
      generatedResponse.status_v1 = 7;
      const isLegacyGeneratedInvalidDerivedResponse = (
        service as unknown as {
          isLegacyGeneratedInvalidDerivedResponse: (
            response: ResponseEntity,
            inputStatus: number,
            inputCode: undefined,
            inputScore: undefined,
            variableCodings: object[]
          ) => boolean;
        }
      ).isLegacyGeneratedInvalidDerivedResponse.bind(service);

      expect(isLegacyGeneratedInvalidDerivedResponse(
        generatedResponse,
        7,
        undefined,
        undefined,
        [
          { id: 'base-06', alias: '06', sourceType: 'BASE' },
          {
            id: '06',
            alias: '07',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['base-06']
          }
        ]
      )).toBe(false);
    });

    it('preserves a complete manual v2 tuple for an unchanged independently derived value', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 1;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.code_v1 = null;
      derivedResponse.score_v1 = null;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;

      configureDerivedSecondRun(sourceResponse, derivedResponse);
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(() => [
          {
            id: '_01',
            value: '1',
            status: 'CODING_INCOMPLETE',
            subform: ''
          }
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              id: 2,
              code_v3: 4,
              status_v3: 'CODING_COMPLETE',
              score_v3: 0
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 2,
            markCurrentVersion: 'v3'
          })
        );
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 1 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
    });

    it('inherits a complete v1 tuple through a pre-existing v2 UNSET state', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 1;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 5;
      derivedResponse.code_v1 = 4;
      derivedResponse.score_v1 = 0;
      derivedResponse.status_v2 = 0;
      derivedResponse.code_v2 = null;
      derivedResponse.score_v2 = null;
      derivedResponse.autocoder_invalidated_version = null;

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          autocoderInvalidatedVersion: null,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        })
      ]));
      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.calls[0][0]
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-target',
          status: 'CODING_COMPLETE',
          code: 4,
          score: 0
        })
      ]));
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 2 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
    });

    it('does not preserve v1 through an applied incomplete v2 result', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 1;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 5;
      derivedResponse.code_v1 = 4;
      derivedResponse.score_v1 = 0;
      derivedResponse.status_v2 = 8;
      derivedResponse.code_v2 = null;
      derivedResponse.score_v2 = null;

      configureDerivedSecondRun(sourceResponse, derivedResponse);
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(() => [{
          id: '_01',
          value: '1',
          status: 'CODING_INCOMPLETE',
          subform: ''
        }]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: null,
          status_v3: 'CODING_INCOMPLETE',
          score_v3: null
        })
      ]));
      const derivedUpdate = codedResponses.find(response => response.id === 2);
      expect(derivedUpdate).not.toHaveProperty('autocoderInvalidatedVersion');
      expect(derivedUpdate).not.toHaveProperty('code_v1');
      expect(result.statusCounts).toEqual({ CODING_INCOMPLETE: 1 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate complete tuples on non-generated responses', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 2;
      sourceResponse.score_v2 = 1;
      const importedResponse = createMockResponse(2, 1, '_01', '1');
      importedResponse.status_v1 = 8;
      importedResponse.status_v2 = 5;
      importedResponse.code_v2 = 4;
      importedResponse.score_v2 = 0;

      configureDerivedSecondRun(
        sourceResponse,
        importedResponse,
        [],
        [
          { id: 'source', sourceType: 'BASE' },
          {
            id: 'derived-target',
            alias: '_01',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['source'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [
              {
                id: 6,
                score: 1,
                ruleSets: [
                  {
                    rules: [
                      { method: 'MATCH', parameters: ['2'] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      );

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      const importedUpdate = codedResponses.find(response => response.id === 2);
      expect(importedUpdate).toEqual(expect.objectContaining({
        id: 2,
        code_v3: 4,
        status_v3: 'CODING_COMPLETE',
        score_v3: 0
      }));
      expect(importedUpdate).not.toHaveProperty('code_v2');
      expect(importedUpdate).not.toHaveProperty('status_v2');
      expect(importedUpdate).not.toHaveProperty('value');
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(1);
    });

    it('preserves downstream manual tuples after preserving their derived source', async () => {
      const baseResponse = createMockResponse(1, 1, 'base', 'base-value');
      baseResponse.status_v2 = 5;
      baseResponse.code_v2 = 1;
      baseResponse.score_v2 = 1;
      const firstDerivedResponse = createMockResponse(2, 1, 'A', '1');
      firstDerivedResponse.is_autocoder_generated = true;
      firstDerivedResponse.status_v1 = 8;
      firstDerivedResponse.status_v2 = 5;
      firstDerivedResponse.code_v2 = 7;
      firstDerivedResponse.score_v2 = 0;
      const secondDerivedResponse = createMockResponse(3, 1, 'B', '7');
      secondDerivedResponse.is_autocoder_generated = true;
      secondDerivedResponse.status_v1 = 8;
      secondDerivedResponse.status_v2 = 5;
      secondDerivedResponse.code_v2 = 9;
      secondDerivedResponse.score_v2 = 0;

      configureDerivedSecondRun(
        baseResponse,
        firstDerivedResponse,
        [secondDerivedResponse],
        [
          { id: 'base', sourceType: 'BASE' },
          {
            id: 'derived-a',
            alias: 'A',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['base'],
            codeModel: 'MANUAL_AND_RULES',
            codes: []
          },
          {
            id: 'derived-b',
            alias: 'B',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['derived-a'],
            codeModel: 'MANUAL_AND_RULES',
            codes: []
          }
        ]
      );

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 7,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        }),
        expect.objectContaining({
          id: 3,
          code_v3: 9,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        })
      ]));
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 3 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(3);
      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.results[1].value
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-a',
          value: '1',
          status: 'NO_CODING'
        })
      ]));
      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.results[2].value
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-b',
          value: '7',
          status: 'NO_CODING'
        })
      ]));
    });

    it('keeps run 2 behavior for circular schemes without complete derived tuples', async () => {
      const firstResponse = createMockResponse(1, 1, 'a', '1');
      const secondResponse = createMockResponse(2, 1, 'b', '2');

      configureDerivedSecondRun(
        firstResponse,
        secondResponse,
        [],
        [
          {
            id: 'a',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['b'],
            codes: []
          },
          {
            id: 'b',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['a'],
            codes: []
          }
        ]
      );

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(result.statusCounts).toEqual({ DERIVE_ERROR: 2 });
      expect(Autocoder.CodingSchemeFactory.getVariableDependencyTree)
        .not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({ id: 1, status_v3: 'DERIVE_ERROR' }),
            expect.objectContaining({ id: 2, status_v3: 'DERIVE_ERROR' })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.any(Object)
        );
    });

    it('keeps regular circular-scheme results when a complete derived tuple exists', async () => {
      const firstResponse = createMockResponse(1, 1, 'a', '1');
      firstResponse.is_autocoder_generated = true;
      firstResponse.status_v1 = 8;
      firstResponse.status_v2 = 5;
      firstResponse.code_v2 = 4;
      firstResponse.score_v2 = 0;
      const secondResponse = createMockResponse(2, 1, 'b', '2');

      configureDerivedSecondRun(
        firstResponse,
        secondResponse,
        [],
        [
          {
            id: 'a',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['b'],
            codes: []
          },
          {
            id: 'b',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['a'],
            codes: []
          }
        ]
      );

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(result.statusCounts).toEqual({
        CODING_COMPLETE: 1,
        DERIVE_ERROR: 1
      });
      expect(Autocoder.CodingSchemeFactory.getVariableDependencyTree)
        .toHaveBeenCalledTimes(1);
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              id: 1,
              code_v3: 4,
              score_v3: 0,
              status_v3: 'CODING_COMPLETE'
            }),
            expect.objectContaining({ id: 2, status_v3: 'DERIVE_ERROR' })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.any(Object)
        );
    });

    it.each(['v1', 'v2'] as const)(
      'does not resurrect an invalidated %s tuple when the dependency graph is circular',
      async invalidatedVersion => {
        const firstResponse = createMockResponse(1, 1, 'a', '1');
        firstResponse.is_autocoder_generated = true;
        firstResponse.autocoder_invalidated_version = invalidatedVersion;
        if (invalidatedVersion === 'v1') {
          firstResponse.status_v1 = 5;
          firstResponse.code_v1 = 4;
          firstResponse.score_v1 = 0;
        } else {
          firstResponse.status_v2 = 5;
          firstResponse.code_v2 = 4;
          firstResponse.score_v2 = 0;
        }
        const secondResponse = createMockResponse(2, 1, 'b', '2');

        configureDerivedSecondRun(
          firstResponse,
          secondResponse,
          [],
          [
            {
              id: 'a',
              sourceType: 'CONCAT_CODE',
              deriveSources: ['b'],
              codes: []
            },
            {
              id: 'b',
              sourceType: 'CONCAT_CODE',
              deriveSources: ['a'],
              codes: []
            }
          ]
        );

        const result = await service.processTestPersonsBatch(
          workspaceId,
          personIds,
          2
        );

        expect(result.statusCounts).toEqual({ DERIVE_ERROR: 2 });
        const regularAutocoderInput =
          (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.calls[0][0];
        expect(regularAutocoderInput).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: 'a',
            status: 'UNSET',
            code: undefined,
            score: undefined
          })
        ]));
        expect(mockResponseManagementService.updateResponsesInDatabase)
          .toHaveBeenCalledWith(
            workspaceId,
            expect.arrayContaining([
              expect.objectContaining({
                id: 1,
                code_v3: null,
                score_v3: null,
                status_v3: 'DERIVE_ERROR'
              }),
              expect.objectContaining({
                id: 2,
                status_v3: 'DERIVE_ERROR'
              })
            ]),
            expect.anything(),
            undefined,
            expect.any(Function),
            undefined,
            expect.any(Object),
            expect.any(Object)
          );
      }
    );

    it('rejects duplicate independently recalculated derived results', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 1;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.code_v1 = null;
      derivedResponse.score_v1 = null;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;
      const rawResult = {
        id: '_01',
        value: '1',
        status: 'CODING_INCOMPLETE',
        subform: ''
      };
      const recalculatedResult = {
        id: '_01',
        value: '1',
        status: 'CODING_COMPLETE',
        code: 4,
        score: 0,
        subform: ''
      };

      configureDerivedSecondRun(sourceResponse, derivedResponse);
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(() => [rawResult])
        .mockImplementationOnce(() => [
          recalculatedResult,
          recalculatedResult
        ]);

      await expect(service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      )).rejects.toThrow(
        'Autocoder returned multiple independently recalculated results'
      );
      expect(
        mockResponseManagementService.updateResponsesInDatabase
      ).not.toHaveBeenCalled();
    });

    it('preserves a complete manual v2 tuple when recalculation is incomplete', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = -98;
      sourceResponse.score_v2 = 0;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.code_v1 = null;
      derivedResponse.score_v1 = null;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;
      const warnSpy = jest.spyOn(
        (service as unknown as {
          logger: { warn: (message: string) => void };
        }).logger,
        'warn'
      );

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        })
      ]));
      const derivedUpdate = codedResponses.find(response => response.id === 2);
      expect(derivedUpdate).not.toHaveProperty('value');
      expect(derivedUpdate.autocoderInvalidatedVersion).toBeNull();
      expect(derivedUpdate).not.toHaveProperty('code_v2');
      expect(derivedUpdate).not.toHaveProperty('status_v2');
      expect(derivedUpdate).not.toHaveProperty('score_v2');
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 2 });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'independent recalculation did not produce a complete result'
        )
      );
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.results[0].value
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-target',
          value: '1',
          status: 'CODING_COMPLETE',
          code: 4
        })
      ]));
      expect(
        (Autocoder.CodingSchemeFactory.code as jest.Mock).mock.results[1].value
      ).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'derived-target',
          value: '-98',
          status: 'CODING_INCOMPLETE'
        })
      ]));
    });

    it('preserves a complete manual v2 tuple when recalculation has a derive error', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 4;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0
        })
      ]));
      const derivedUpdate = codedResponses.find(response => response.id === 2);
      expect(derivedUpdate).not.toHaveProperty('value');
      expect(derivedUpdate.autocoderInvalidatedVersion).toBeNull();
      expect(result.statusCounts).toEqual({
        CODING_COMPLETE: 1,
        DERIVE_ERROR: 1
      });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
    });

    it('restores an invalidated v2 tuple when recalculation still has a derive error', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 4;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;
      derivedResponse.autocoder_invalidated_version = 'v2';
      derivedResponse.status_v3 = 4;
      derivedResponse.code_v3 = null;
      derivedResponse.score_v3 = null;

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0,
          autocoderInvalidatedVersion: null
        })
      ]));
      expect(result.statusCounts).toEqual({
        CODING_COMPLETE: 1,
        DERIVE_ERROR: 1
      });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
    });

    it('restores an invalidated v2 tuple when recalculation is still incomplete', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = -98;
      sourceResponse.score_v2 = 0;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;
      derivedResponse.autocoder_invalidated_version = 'v2';
      derivedResponse.status_v3 = 8;
      derivedResponse.code_v3 = null;
      derivedResponse.score_v3 = null;

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 4,
          status_v3: 'CODING_COMPLETE',
          score_v3: 0,
          autocoderInvalidatedVersion: null
        })
      ]));
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 2 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(2);
    });

    it('does not replace a preserved value during another authoritative recalculation', async () => {
      const incompleteSource = createMockResponse(
        1,
        1,
        'incomplete-source',
        'source-value'
      );
      incompleteSource.status_v2 = 5;
      incompleteSource.code_v2 = -98;
      incompleteSource.score_v2 = 0;
      const preservedResponse = createMockResponse(2, 1, 'A', '1');
      preservedResponse.is_autocoder_generated = true;
      preservedResponse.status_v1 = 8;
      preservedResponse.status_v2 = 5;
      preservedResponse.code_v2 = 4;
      preservedResponse.score_v2 = 0;

      const changedSource = createMockResponse(
        3,
        1,
        'changed-source',
        'source-value'
      );
      changedSource.status_v2 = 5;
      changedSource.code_v2 = 2;
      changedSource.score_v2 = 1;
      const changedResponse = createMockResponse(4, 1, 'B', '1');
      changedResponse.is_autocoder_generated = true;
      changedResponse.status_v1 = 8;
      changedResponse.status_v2 = 5;
      changedResponse.code_v2 = 4;
      changedResponse.score_v2 = 0;

      configureDerivedSecondRun(
        incompleteSource,
        preservedResponse,
        [changedSource, changedResponse],
        [
          { id: 'incomplete-source', sourceType: 'BASE' },
          {
            id: 'derived-a',
            alias: 'A',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['incomplete-source'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [{
              id: 4,
              score: 0,
              ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['1'] }] }]
            }]
          },
          { id: 'changed-source', sourceType: 'BASE' },
          {
            id: 'derived-b',
            alias: 'B',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['changed-source'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [{
              id: 6,
              score: 1,
              ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['2'] }] }]
            }]
          }
        ]
      );

      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      const preservedUpdate = codedResponses.find(response => response.id === 2);
      expect(preservedUpdate).toEqual(expect.objectContaining({
        code_v3: 4,
        status_v3: 'CODING_COMPLETE',
        score_v3: 0,
        autocoderInvalidatedVersion: null
      }));
      expect(preservedUpdate).not.toHaveProperty('value');
      expect(preservedUpdate).not.toHaveProperty('status');
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 4,
          value: '2',
          autocoderInvalidatedVersion: 'v2',
          code_v3: 6,
          status_v3: 'CODING_COMPLETE',
          score_v3: 1
        })
      ]));
    });

    it('persists a changed derived value with its newly calculated tuple', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 2;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;

      configureDerivedSecondRun(
        sourceResponse,
        derivedResponse,
        [],
        [
          { id: 'source', sourceType: 'BASE' },
          {
            id: 'derived-target',
            alias: '_01',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['source'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [
              {
                id: 6,
                score: 1,
                ruleSets: [
                  {
                    rules: [
                      { method: 'MATCH', parameters: ['2'] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      );

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          value: '2',
          status: 3,
          autocoderInvalidatedVersion: 'v2',
          code_v3: 6,
          status_v3: 'CODING_COMPLETE',
          score_v3: 1
        })
      ]));
      const derivedUpdate = codedResponses.find(response => response.id === 2);
      expect(derivedUpdate).not.toHaveProperty('code_v2');
      expect(derivedUpdate).not.toHaveProperty('status_v2');
      expect(derivedUpdate).not.toHaveProperty('score_v2');
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 2 });
    });

    it('recalculates downstream results after a protected derived value changed', async () => {
      const baseResponse = createMockResponse(1, 1, 'base', 'base-value');
      baseResponse.status_v2 = 5;
      baseResponse.code_v2 = 2;
      baseResponse.score_v2 = 1;
      const protectedResponse = createMockResponse(2, 1, 'A', '1');
      protectedResponse.is_autocoder_generated = true;
      protectedResponse.status_v1 = 8;
      protectedResponse.status_v2 = 5;
      protectedResponse.code_v2 = 4;
      protectedResponse.score_v2 = 0;
      const downstreamResponse = createMockResponse(3, 1, 'B', '4');
      downstreamResponse.is_autocoder_generated = true;
      downstreamResponse.status_v1 = 8;
      downstreamResponse.status_v2 = 8;

      configureDerivedSecondRun(
        baseResponse,
        protectedResponse,
        [downstreamResponse],
        [
          { id: 'base', sourceType: 'BASE' },
          {
            id: 'derived-a',
            alias: 'A',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['base'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [{
              id: 6,
              score: 1,
              ruleSets: [{
                rules: [{ method: 'MATCH', parameters: ['2'] }]
              }]
            }]
          },
          {
            id: 'derived-b',
            alias: 'B',
            sourceType: 'CONCAT_CODE',
            deriveSources: ['derived-a'],
            codeModel: 'MANUAL_AND_RULES',
            codes: [
              {
                id: 8,
                score: 1,
                ruleSets: [{
                  rules: [{ method: 'MATCH', parameters: ['6'] }]
                }]
              },
              {
                id: 9,
                score: 0,
                ruleSets: [{
                  rules: [{ method: 'MATCH', parameters: ['4'] }]
                }]
              }
            ]
          }
        ]
      );

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          value: '2',
          autocoderInvalidatedVersion: 'v2',
          code_v3: 6,
          status_v3: 'CODING_COMPLETE',
          score_v3: 1
        }),
        expect.objectContaining({
          id: 3,
          value: '6',
          status: 3,
          code_v3: 8,
          status_v3: 'CODING_COMPLETE',
          score_v3: 1
        })
      ]));
      expect(codedResponses).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 3, code_v3: 9 })
      ]));
      expect(result.statusCounts).toEqual({ CODING_COMPLETE: 3 });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(3);
    });

    it('does not restore an invalidated manual tuple on a repeated run 2', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = 2;
      sourceResponse.score_v2 = 1;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 8;
      derivedResponse.status_v2 = 5;
      derivedResponse.code_v2 = 4;
      derivedResponse.score_v2 = 0;
      const variableCodings = [
        { id: 'source', sourceType: 'BASE' },
        {
          id: 'derived-target',
          alias: '_01',
          sourceType: 'CONCAT_CODE',
          deriveSources: ['source'],
          codeModel: 'MANUAL_AND_RULES',
          codes: [
            {
              id: 6,
              score: 1,
              ruleSets: [
                {
                  rules: [
                    { method: 'MATCH', parameters: ['2'] }
                  ]
                }
              ]
            }
          ]
        }
      ];

      configureDerivedSecondRun(
        sourceResponse,
        derivedResponse,
        [],
        variableCodings
      );
      await service.processTestPersonsBatch(workspaceId, personIds, 2);

      const firstRunResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      const firstRunDerived = firstRunResponses.find(
        response => response.id === derivedResponse.id
      );
      expect(firstRunDerived).toEqual(expect.objectContaining({
        value: '2',
        autocoderInvalidatedVersion: 'v2',
        code_v3: 6,
        status_v3: 'CODING_COMPLETE',
        score_v3: 1
      }));
      expect(firstRunDerived).not.toHaveProperty('code_v2');
      expect(firstRunDerived).not.toHaveProperty('status_v2');
      expect(firstRunDerived).not.toHaveProperty('score_v2');

      derivedResponse.value = firstRunDerived.value;
      derivedResponse.autocoder_invalidated_version =
        firstRunDerived.autocoderInvalidatedVersion;
      derivedResponse.code_v3 = firstRunDerived.code_v3;
      derivedResponse.status_v3 = 5;
      derivedResponse.score_v3 = firstRunDerived.score_v3;
      mockResponseManagementService.updateResponsesInDatabase.mockClear();
      mockQueryRunner.isReleased = false;
      configureDerivedSecondRun(
        sourceResponse,
        derivedResponse,
        [],
        variableCodings
      );

      const secondResult = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const secondRunResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(secondRunResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: 6,
          status_v3: 'CODING_COMPLETE',
          score_v3: 1
        })
      ]));
      expect(secondRunResponses).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 2, code_v3: 4 })
      ]));
      expect(secondResult.statusCounts).toEqual({ CODING_COMPLETE: 2 });
    });

    it('invalidates the inherited v1 tuple separately when its derived value changed', async () => {
      const sourceResponse = createMockResponse(1, 1, 'source', 'source-value');
      sourceResponse.status_v2 = 5;
      sourceResponse.code_v2 = -98;
      sourceResponse.score_v2 = 0;
      const derivedResponse = createMockResponse(2, 1, '_01', '1');
      derivedResponse.is_autocoder_generated = true;
      derivedResponse.status_v1 = 5;
      derivedResponse.code_v1 = 4;
      derivedResponse.score_v1 = 0;
      derivedResponse.status_v2 = null;
      derivedResponse.code_v2 = null;
      derivedResponse.score_v2 = null;
      const warnSpy = jest.spyOn(
        (service as unknown as {
          logger: { warn: (message: string) => void };
        }).logger,
        'warn'
      );

      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              id: 2,
              value: '-98',
              status: 3,
              autocoderInvalidatedVersion: 'v1',
              code_v3: null,
              status_v3: 'CODING_INCOMPLETE',
              score_v3: null
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 2,
            markCurrentVersion: 'v3'
          })
        );
      expect(result.statusCounts).toEqual({
        CODING_COMPLETE: 1,
        CODING_INCOMPLETE: 1
      });
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledTimes(3);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('complete V1 tuple')
      );

      const firstRunResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      const firstRunDerived = firstRunResponses.find(
        response => response.id === derivedResponse.id
      );
      expect(firstRunDerived).not.toHaveProperty('code_v1');
      expect(firstRunDerived).not.toHaveProperty('status_v1');
      expect(firstRunDerived).not.toHaveProperty('score_v1');
      derivedResponse.value = firstRunDerived.value;
      derivedResponse.autocoder_invalidated_version =
        firstRunDerived.autocoderInvalidatedVersion;
      derivedResponse.code_v3 = firstRunDerived.code_v3;
      derivedResponse.status_v3 = 8;
      derivedResponse.score_v3 = firstRunDerived.score_v3;
      mockResponseManagementService.updateResponsesInDatabase.mockClear();
      mockQueryRunner.isReleased = false;
      configureDerivedSecondRun(sourceResponse, derivedResponse);

      const secondResult = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      const secondRunResponses =
        mockResponseManagementService.updateResponsesInDatabase.mock.calls[0][1];
      expect(secondRunResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          code_v3: null,
          status_v3: 'CODING_INCOMPLETE',
          score_v3: null
        })
      ]));
      expect(secondRunResponses).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 2, code_v3: 4 })
      ]));
      expect(secondResult.statusCounts).toEqual({
        CODING_COMPLETE: 1,
        CODING_INCOMPLETE: 1
      });
    });

    it('should keep existing generated rows marked during repeated second autocoder runs', async () => {
      const generatedResponse = createMockResponse(88, 1, 'derived_var', '1_0');
      generatedResponse.is_autocoder_generated = true;
      generatedResponse.status_v1 = 8;
      generatedResponse.status_v2 = 5;
      generatedResponse.status_v3 = 5;
      generatedResponse.code_v2 = 0;
      generatedResponse.score_v2 = 0;
      generatedResponse.code_v3 = 1;
      generatedResponse.score_v3 = 1;
      generatedResponse.subform = 'elementCodes';

      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([
        {
          id: 'derived_var',
          value: '1_0',
          status: 'CODING_COMPLETE',
          code: 0,
          score: 0,
          subform: 'elementCodes'
        }
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['derived_var'])]
        ])
      );
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([generatedResponse]);

      await service.processTestPersonsBatch(workspaceId, ['1'], 2);

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              id: 88,
              isAutocoderGenerated: true,
              unitid: 1,
              variableid: 'derived_var',
              subform: 'elementCodes',
              code_v3: 0,
              status_v3: 'CODING_COMPLETE',
              score_v3: 0
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 2,
            markCurrentVersion: 'v3'
          })
        );
    });

    it('should exclude v3-only generated outputs from the second autocoder input query', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([mockResponses[0]]);

      await service.processTestPersonsBatch(workspaceId, ['1'], 2);

      type TestBracket = {
        whereFactory: (qb: { where: jest.Mock; orWhere: jest.Mock }) => void;
      };
      const createGeneratedFilterProbe = () => ({
        where: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis()
      });
      const generatedInputFilter = mockQueryBuilder.andWhere.mock.calls
        .map(([condition]) => condition)
        .find((condition): condition is TestBracket => {
          if (
            typeof condition !== 'object' ||
            condition === null ||
            !('whereFactory' in condition) ||
            typeof condition.whereFactory !== 'function'
          ) {
            return false;
          }

          const probe = createGeneratedFilterProbe();
          condition.whereFactory(probe);
          return probe.orWhere.mock.calls.some(
            ([, params]) => (
              params as { generatedWithSourceCoding?: boolean } | undefined
            )?.generatedWithSourceCoding === true
          );
        });
      expect(generatedInputFilter).toBeDefined();
      const generatedFilterQueryBuilder = createGeneratedFilterProbe();

      generatedInputFilter!.whereFactory(generatedFilterQueryBuilder);

      expect(generatedFilterQueryBuilder.where).toHaveBeenCalledWith(
        '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
      const generatedSourceCondition = String(generatedFilterQueryBuilder.orWhere.mock.calls[0][0]);
      expect(generatedSourceCondition).toContain('ResponseEntity.status_v1 IS NOT NULL');
      expect(generatedSourceCondition).toContain('ResponseEntity.status_v2 IS NOT NULL');
      expect(generatedSourceCondition).not.toContain('ResponseEntity.status_v3 IS NOT NULL');
      expect(generatedSourceCondition).not.toContain('ResponseEntity.code_v1 IS NOT NULL');
      expect(generatedSourceCondition).not.toContain('ResponseEntity.code_v2 IS NOT NULL');
      expect(generatedSourceCondition).not.toContain('ResponseEntity.score_v1 IS NOT NULL');
      expect(generatedSourceCondition).not.toContain('ResponseEntity.score_v2 IS NOT NULL');
      expect(generatedFilterQueryBuilder.orWhere).toHaveBeenCalledWith(
        expect.any(String),
        { generatedWithSourceCoding: true }
      );
    });

    it('should scope coding scheme cache entries by workspace', async () => {
      const getCodingSchemesWithCache = (
        service as unknown as {
          getCodingSchemesWithCache: (
            workspaceId: number,
            codingSchemeRefs: string[]
          ) => Promise<Map<string, unknown>>;
        }
      ).getCodingSchemesWithCache.bind(service);

      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload('SHARED_SCHEME', JSON.stringify({ variableCodings: [] }))
        ])
        .mockResolvedValueOnce([
          createMockFileUpload('SHARED_SCHEME', JSON.stringify({ variableCodings: [] }))
        ]);

      await getCodingSchemesWithCache(1, ['SHARED_SCHEME']);
      await getCodingSchemesWithCache(2, ['SHARED_SCHEME']);
      await getCodingSchemesWithCache(1, ['SHARED_SCHEME']);

      expect(fileUploadRepository.find).toHaveBeenCalledTimes(2);
      expect(fileUploadRepository.find).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ workspace_id: 1 })
        })
      );
      expect(fileUploadRepository.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({ workspace_id: 2 })
        })
      );
    });

    it('should reject unsupported autocoder runs before starting processing', async () => {
      await expect(
        service.processTestPersonsBatch(workspaceId, personIds, 3)
      ).rejects.toThrow('autoCoderRun must be 1 or 2');
    });

    it('should use the unit name as file id fallback when alias is missing', async () => {
      const unitWithoutAlias = createMockUnit(1, 1, 'TEST_UNIT_1', null as unknown as string);
      (fileUploadRepository.find as jest.Mock).mockReset().mockResolvedValue([]);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([unitWithoutAlias])
        .mockResolvedValueOnce([mockResponses[0]]);

      await service.processTestPersonsBatch(workspaceId, ['1'], 1);

      const fileFindArgs = (fileUploadRepository.find as jest.Mock).mock.calls[0][0];
      expect(fileFindArgs.where.workspace_id).toBe(workspaceId);
      expect(fileFindArgs.where.file_id.value).toContain('TEST_UNIT_1');
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.any(Array),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 1
          })
        );
    });

    it('should use the unit name as file id fallback when alias is blank', async () => {
      const unitWithBlankAlias = createMockUnit(1, 1, 'TEST_UNIT_1', '   ');
      (fileUploadRepository.find as jest.Mock).mockReset().mockResolvedValue([]);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([unitWithBlankAlias])
        .mockResolvedValueOnce([mockResponses[0]]);

      await service.processTestPersonsBatch(workspaceId, ['1'], 1);

      const fileFindArgs = (fileUploadRepository.find as jest.Mock).mock.calls[0][0];
      expect(fileFindArgs.where.workspace_id).toBe(workspaceId);
      expect(fileFindArgs.where.file_id.value).toContain('TEST_UNIT_1');
    });

    it('should mark generated autocoder outputs and exclude generated rows from the first run input query', async () => {
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([
        {
          id: 'derived_var',
          value: 'derived value',
          status: 'VALUE_CHANGED',
          code: 1,
          score: 1,
          subform: ''
        }
      ]);

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([mockResponses[0]]);

      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1'])]
        ])
      );

      await service.processTestPersonsBatch(workspaceId, ['1'], 1);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(ResponseEntity.is_autocoder_generated = :isAutocoderGenerated OR ResponseEntity.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              isNew: true,
              isAutocoderGenerated: true,
              variableid: 'derived_var',
              code_v1: 1,
              status_v1: 'VALUE_CHANGED',
              code_v2: null,
              status_v2: null,
              code_v3: null,
              status_v3: null
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 1,
            markCurrentVersion: 'v1'
          })
        );
    });

    it('should persist DERIVE_ERROR autocoder outputs without false-code completion', async () => {
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([
        {
          id: 'derived_var',
          value: null,
          status: 'DERIVE_ERROR',
          code: undefined,
          score: undefined,
          subform: ''
        }
      ]);

      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([mockResponses[0]]);

      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1'])]
        ])
      );

      await service.processTestPersonsBatch(workspaceId, ['1'], 1);

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              isNew: true,
              isAutocoderGenerated: true,
              variableid: 'derived_var',
              code_v1: null,
              score_v1: null,
              status_v1: 'DERIVE_ERROR',
              code_v2: null,
              score_v2: null,
              status_v2: null
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.objectContaining({
            unitIds: [1],
            autoCoderRun: 1,
            markCurrentVersion: 'v1'
          })
        );
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalledWith(
          workspaceId,
          expect.arrayContaining([
            expect.objectContaining({
              variableid: 'derived_var',
              code_v1: 0,
              status_v1: 'CODING_COMPLETE'
            })
          ]),
          expect.anything(),
          undefined,
          expect.any(Function),
          undefined,
          expect.any(Object),
          expect.any(Object)
        );
    });

    it('prefers exact DHB003 aliases over colliding technical variable IDs', () => {
      const response02 = createMockResponse(10, 1, '02');
      const response04 = createMockResponse(20, 1, '04');
      const response03 = createMockResponse(30, 1, '03');
      const response05 = createMockResponse(40, 1, '05');
      const generatedTechnical04 = createMockResponse(50, 1, '04');
      generatedTechnical04.is_autocoder_generated = true;
      const generatedTechnical05 = createMockResponse(60, 1, '05');
      generatedTechnical05.is_autocoder_generated = true;
      const technicalIdFallbackByAlias = new Map([
        ['02', '04'],
        ['04', '07'],
        ['03', '05'],
        ['05', '09']
      ]);
      const resolveResponse = (
        service as unknown as {
          findExistingResponseForAutocoderResult: (
            responses: ResponseEntity[],
            codedResultId: string,
            codedSubform: string,
            technicalIdFallbackByAlias: Map<string, string>
          ) => ResponseEntity | undefined;
        }
      ).findExistingResponseForAutocoderResult.bind(service);
      const responses = [
        response02,
        response04,
        response03,
        response05,
        generatedTechnical04,
        generatedTechnical05
      ];

      expect(resolveResponse(responses, '02', '', technicalIdFallbackByAlias))
        .toBe(response02);
      expect(resolveResponse(responses, '04', '', technicalIdFallbackByAlias))
        .toBe(response04);
      expect(resolveResponse(responses, '03', '', technicalIdFallbackByAlias))
        .toBe(response03);
      expect(resolveResponse(responses, '05', '', technicalIdFallbackByAlias))
        .toBe(response05);
    });

    it('limits the technical-ID fallback to legacy generated responses', () => {
      const importedTechnicalIdCollision = createMockResponse(
        20,
        1,
        'TECHNICAL_04'
      );
      const legacyGeneratedResponse = createMockResponse(
        30,
        1,
        'TECHNICAL_04'
      );
      legacyGeneratedResponse.is_autocoder_generated = true;
      const technicalIdFallbackByAlias = new Map([
        ['02', 'TECHNICAL_04']
      ]);
      const resolveResponse = (
        service as unknown as {
          findExistingResponseForAutocoderResult: (
            responses: ResponseEntity[],
            codedResultId: string,
            codedSubform: string,
            technicalIdFallbackByAlias: Map<string, string>
          ) => ResponseEntity | undefined;
        }
      ).findExistingResponseForAutocoderResult.bind(service);

      expect(resolveResponse(
        [importedTechnicalIdCollision],
        '02',
        '',
        technicalIdFallbackByAlias
      )).toBeUndefined();
      expect(resolveResponse(
        [importedTechnicalIdCollision, legacyGeneratedResponse],
        '02',
        '',
        technicalIdFallbackByAlias
      )).toBe(legacyGeneratedResponse);
    });

    it('excludes technical IDs that are also another output alias', () => {
      const serviceInternals = service as unknown as {
        createUnambiguousTechnicalIdFallbacks: (
          variableCodings: Array<{ id: string; alias?: string }>
        ) => Map<string, string>;
        findExistingResponseForAutocoderResult: (
          responses: ResponseEntity[],
          codedResultId: string,
          codedSubform: string,
          technicalIdFallbackByAlias: Map<string, string>
        ) => ResponseEntity | undefined;
      };
      const technicalIdFallbackByAlias =
        serviceInternals.createUnambiguousTechnicalIdFallbacks([
          { id: '04', alias: '02' },
          { id: '07', alias: '04' },
          { id: '05', alias: '03' },
          { id: '09', alias: '05' }
        ]);
      const generated04 = createMockResponse(50, 1, '04');
      generated04.is_autocoder_generated = true;

      expect(Array.from(technicalIdFallbackByAlias.entries())).toEqual([
        ['04', '07'],
        ['05', '09']
      ]);
      expect(serviceInternals.findExistingResponseForAutocoderResult(
        [generated04],
        '02',
        '',
        technicalIdFallbackByAlias
      )).toBeUndefined();
    });

    it('routes all DHB003 aliases correctly through response processing', async () => {
      const dhbResponses = [
        createMockResponse(10, 1, '02'),
        createMockResponse(20, 1, '04'),
        createMockResponse(40, 1, '05')
      ];
      const dhbVariableCodings = [
        { id: '04', alias: '02' },
        { id: '07', alias: '04' },
        { id: '05', alias: '03' },
        { id: '09', alias: '05' }
      ];
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([
        {
          id: '04',
          value: 'response 02',
          status: 'CODING_COMPLETE',
          code: 102,
          score: 1,
          subform: ''
        },
        {
          id: '07',
          value: 'response 04',
          status: 'CODING_COMPLETE',
          code: 104,
          score: 1,
          subform: ''
        },
        {
          id: '05',
          value: 'derived 03',
          status: 'CODING_COMPLETE',
          code: 103,
          score: 1,
          subform: ''
        },
        {
          id: '09',
          value: 'response 05',
          status: 'CODING_COMPLETE',
          code: 105,
          score: 1,
          subform: ''
        }
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['02', '04', '05'])]
        ])
      );
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce(dhbResponses);
      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>TEST-SCHEME-REF</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'TEST-SCHEME-REF',
            JSON.stringify({
              version: '3.4',
              variableCodings: dhbVariableCodings
            })
          )
        ]);

      await service.processTestPersonsBatch(workspaceId, ['1'], 1);

      const codedResponses =
        mockResponseManagementService.updateResponsesInDatabase
          .mock.calls[0][1];
      expect(codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 10, code_v1: 102 }),
        expect.objectContaining({ id: 20, code_v1: 104 }),
        expect.objectContaining({
          id: -1,
          isNew: true,
          variableid: '03',
          code_v1: 103
        }),
        expect.objectContaining({ id: 40, code_v1: 105 })
      ]));
      expect(codedResponses).toHaveLength(4);
    });

    it('rejects multiple autocoder results for the same persistence target', () => {
      const assertUniqueTargets = (
        service as unknown as {
          assertUniqueAutocoderPersistenceTargets: (
            responses: Array<{
              id: number;
              isNew?: boolean;
              unitid?: number;
              variableid?: string;
              subform?: string;
            }>
          ) => void;
        }
      ).assertUniqueAutocoderPersistenceTargets.bind(service);

      expect(() => assertUniqueTargets([
        { id: 10 },
        { id: 10 }
      ])).toThrow('Autocoder produced multiple updates for response:10');
      expect(() => assertUniqueTargets([
        {
          id: -1,
          isNew: true,
          unitid: 1,
          variableid: '03',
          subform: ''
        },
        {
          id: -1,
          isNew: true,
          unitid: 1,
          variableid: '03',
          subform: ''
        }
      ])).toThrow('Autocoder produced multiple updates for generated:1:03:');
    });

    it('rejects genuinely duplicate output aliases before coding', () => {
      const createNamespace = (
        service as unknown as {
          createAutocoderNamespace: (
            variableCodings: Array<{
              id: string;
              alias: string;
              sourceType: string;
            }>
          ) => unknown;
        }
      ).createAutocoderNamespace.bind(service);

      expect(() => createNamespace([
        { id: 'technical-a', alias: 'DUPLICATE', sourceType: 'BASE' },
        { id: 'technical-b', alias: 'DUPLICATE', sourceType: 'BASE' }
      ])).toThrow('duplicate output alias "DUPLICATE"');
      expect(Autocoder.CodingSchemeFactory.code).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a BASE_NO_VALUE variable with coding rules',
        [
          {
            id: 'structural-target',
            alias: '01',
            sourceType: 'BASE_NO_VALUE',
            codes: [{ id: 1, score: 1 }]
          },
          {
            id: '01',
            alias: '01',
            sourceType: 'SUM_SCORE',
            deriveSources: ['01a']
          }
        ]
      ],
      [
        'a derived technical ID different from the shared alias',
        [
          {
            id: 'structural-target',
            alias: '01',
            sourceType: 'BASE_NO_VALUE',
            codes: []
          },
          {
            id: 'derived-target',
            alias: '01',
            sourceType: 'SUM_SCORE',
            deriveSources: ['01a']
          }
        ]
      ],
      [
        'a BASE_NO_VALUE technical ID used as a derivation source',
        [
          {
            id: 'structural-target',
            alias: '01',
            sourceType: 'BASE_NO_VALUE',
            codes: []
          },
          {
            id: '01',
            alias: '01',
            sourceType: 'SUM_SCORE',
            deriveSources: ['structural-target']
          }
        ]
      ]
    ])('rejects unsafe BASE_NO_VALUE shadowing with %s', (_case, codings) => {
      const createNamespace = (
        service as unknown as {
          createAutocoderNamespace: (variableCodings: object[]) => unknown;
        }
      ).createAutocoderNamespace.bind(service);

      expect(() => createNamespace(codings)).toThrow(
        'duplicate output alias "01"'
      );
      expect(Autocoder.CodingSchemeFactory.code).not.toHaveBeenCalled();
    });

    it.each([
      ['public alias first', true],
      ['technical ID first', false]
    ])(
      'rejects canonical input collisions with %s',
      async (_description, aliasFirst) => {
        const publicAliasResponse = createMockResponse(
          6235425,
          1,
          '06',
          'public-alias-value'
        );
        const legacyTechnicalResponse = createMockResponse(
          6235426,
          1,
          'radio-group-images_1',
          'legacy-technical-value'
        );
        legacyTechnicalResponse.is_autocoder_generated = true;
        const orderedResponses = aliasFirst ?
          [publicAliasResponse, legacyTechnicalResponse] :
          [legacyTechnicalResponse, publicAliasResponse];

        mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
          new Map([[
            'TEST_UNIT_1',
            new Set(['06', 'radio-group-images_1'])
          ]])
        );
        mockQueryBuilder.getMany
          .mockResolvedValueOnce([mockUnits[0]])
          .mockResolvedValueOnce(orderedResponses);
        (fileUploadRepository.find as jest.Mock)
          .mockReset()
          .mockResolvedValueOnce([
            createMockFileUpload(
              'ALIAS_1',
              '<xml><codingSchemeRef>TEST-SCHEME-REF</codingSchemeRef></xml>'
            )
          ])
          .mockResolvedValueOnce([
            createMockFileUpload(
              'TEST-SCHEME-REF',
              JSON.stringify({
                version: '3.4',
                variableCodings: [{
                  id: 'radio-group-images_1',
                  alias: '06',
                  sourceType: 'BASE'
                }]
              })
            )
          ]);

        let collisionError: Error | undefined;
        try {
          await service.prepareAutocoderBatch(
            workspaceId,
            ['1'],
            2,
            undefined,
            'preflight-job',
            undefined,
            undefined,
            service.createAutocoderPreflightContext()
          );
        } catch (error) {
          collisionError = error as Error;
        }

        expect(collisionError?.message).toContain(
          'Autocoder input namespace collision for technical variable ' +
          '"radio-group-images_1"'
        );
        expect(collisionError?.message).toContain(
          'response:6235425 (stored variable "06", imported)'
        );
        expect(collisionError?.message).toContain(
          'response:6235426 (stored variable "radio-group-images_1", ' +
          'autocoder-generated)'
        );
        expect(Autocoder.CodingSchemeFactory.code).not.toHaveBeenCalled();
        expect(responseRepository.manager.connection.createQueryRunner)
          .not.toHaveBeenCalled();
        expect(mockResponseManagementService.updateResponsesInDatabase)
          .not.toHaveBeenCalled();
      }
    );

    it.each([
      {
        description: 'a lone ambiguous generated ID',
        storedIds: ['06'],
        expectedEvidence:
          'alias-only evidence: none; technical-only evidence: none'
      },
      {
        description: 'a technical-ID-encoded generated chain',
        storedIds: ['radio-group-images_1', '06', '07'],
        expectedEvidence:
          'alias-only evidence: none; technical-only evidence: ' +
          '"RADIO-GROUP-IMAGES_1"'
      },
      {
        description: 'an incomplete generated alias chain',
        storedIds: ['06', '08'],
        expectedEvidence:
          'alias-only evidence: "08"; technical-only evidence: none; ' +
          'missing output aliases: "07"'
      },
      {
        description: 'mixed alias and technical namespace evidence',
        storedIds: ['radio-group-images_1', '06', '07', '08'],
        expectedEvidence:
          'alias-only evidence: "08"; technical-only evidence: ' +
          '"RADIO-GROUP-IMAGES_1"'
      },
      {
        description: 'alias evidence supplied only by imported rows',
        storedIds: ['06', '07', '08'],
        generatedIds: ['06'],
        expectedEvidence:
          'alias-only evidence: none; technical-only evidence: none; ' +
          'missing output aliases: "07", "08"'
      }
    ])(
      'rejects $description',
      ({ storedIds, generatedIds = storedIds, expectedEvidence }) => {
        const codeResponses = (
          service as unknown as {
            codeAutocoderResponses: (
              responses: Array<{
                id: string;
                value: string;
                status: 'CODING_COMPLETE';
                subform?: string | null;
              }>,
              variableCodings: Array<{
                id: string;
                alias: string;
                sourceType: string;
              }>,
              inputOrigins: Array<{
                responseId: number;
                storedVariableId: string;
                isAutocoderGenerated: boolean;
              }>
            ) => unknown;
          }
        ).codeAutocoderResponses.bind(service);
        const responses = storedIds.map(id => ({
          id,
          value: `${id}-value`,
          status: 'CODING_COMPLETE' as const,
          subform: null
        }));
        const inputOrigins = storedIds.map((storedVariableId, index) => ({
          responseId: 6235425 + index,
          storedVariableId,
          isAutocoderGenerated: generatedIds.includes(storedVariableId)
        }));

        expect(() => codeResponses(responses, [
          {
            id: 'radio-group-images_1',
            alias: '06',
            sourceType: 'BASE'
          },
          { id: '06', alias: '07', sourceType: 'BASE' },
          { id: '07', alias: '08', sourceType: 'BASE' }
        ], inputOrigins)).toThrow(expectedEvidence);
        expect(Autocoder.CodingSchemeFactory.code).not.toHaveBeenCalled();
      }
    );

    it('accepts a lone ambiguous generated UNSET placeholder', () => {
      const codeResponses = (
        service as unknown as {
          codeAutocoderResponses: (
            responses: Array<{
              id: string;
              value: string;
              status: 'UNSET';
              subform?: string | null;
              code?: number | null;
              score?: number | null;
            }>,
            variableCodings: Array<{
              id: string;
              alias: string;
              sourceType: string;
            }>,
            inputOrigins: Array<{
              responseId: number;
              storedVariableId: string;
              isAutocoderGenerated: boolean;
            }>
          ) => unknown;
        }
      ).codeAutocoderResponses.bind(service);
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([]);

      expect(() => codeResponses([
        {
          id: '06',
          value: '',
          status: 'UNSET',
          subform: null,
          code: null,
          score: null
        }
      ], [
        {
          id: 'radio-group-images_1',
          alias: '06',
          sourceType: 'BASE'
        },
        { id: '06', alias: '07', sourceType: 'BASE' },
        { id: '07', alias: '08', sourceType: 'BASE' }
      ], [{
        responseId: 6235425,
        storedVariableId: '06',
        isAutocoderGenerated: true
      }])).not.toThrow();
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledWith(
        [expect.objectContaining({
          id: 'radio-group-images_1',
          subform: undefined
        })],
        expect.any(Array)
      );
    });

    it('keeps a real response status instead of an alias-chain placeholder', () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(actualAutocoder.CodingSchemeFactory.code);
      const codeResponses = (
        service as unknown as {
          codeAutocoderResponses: (
            responses: Array<{
              id: string;
              value: string;
              status: 'VALUE_CHANGED' | 'INVALID';
              subform?: string | null;
            }>,
            variableCodings: Array<{
              id: string;
              alias: string;
              sourceType: string;
              codeModel: string;
              codes: never[];
            }>
          ) => Array<{
            id: string;
            value: unknown;
            status: string;
            subform?: string;
          }>;
        }
      ).codeAutocoderResponses.bind(service);

      const results = codeResponses([
        {
          id: '07',
          value: 'answer',
          status: 'VALUE_CHANGED',
          subform: null
        },
        {
          id: '08',
          value: '',
          status: 'INVALID',
          subform: null
        }
      ], [
        {
          id: '08',
          alias: '07',
          sourceType: 'BASE',
          codeModel: 'MANUAL_AND_RULES',
          codes: []
        },
        {
          id: 'radio-group-images_1',
          alias: '08',
          sourceType: 'BASE',
          codeModel: 'MANUAL_AND_RULES',
          codes: []
        }
      ]);

      expect(results.filter(result => result.id === '08')).toEqual([
        expect.objectContaining({
          id: '08',
          value: '',
          status: 'INVALID',
          subform: undefined
        })
      ]);
      expect(results.filter(result => result.id === '07')).toHaveLength(1);
    });

    it('accepts generated output aliases from a previous run', async () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.validate as jest.Mock)
        .mockImplementationOnce(actualAutocoder.CodingSchemeFactory.validate);
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(actualAutocoder.CodingSchemeFactory.code);
      const response06 = createMockResponse(6235425, 1, '06', '');
      const response07 = createMockResponse(6235421, 1, '07', '');
      const response08 = createMockResponse(6235424, 1, '08', '');
      response06.subform = null as unknown as string;
      response07.subform = null as unknown as string;
      response08.subform = null as unknown as string;
      response06.is_autocoder_generated = true;
      response07.is_autocoder_generated = true;
      response08.is_autocoder_generated = true;
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT_1', new Set(['06', '07', '08'])]])
      );
      mockWorkspaceFilesService.getVariableInfoForScheme.mockResolvedValueOnce([
        {
          id: 'radio-group-images_1',
          alias: '06',
          type: 'string',
          multiple: false,
          nullable: true,
          format: '',
          valuePositionLabels: []
        },
        {
          id: '06',
          alias: '07',
          type: 'string',
          multiple: false,
          nullable: true,
          format: '',
          valuePositionLabels: []
        },
        {
          id: '07',
          alias: '08',
          type: 'string',
          multiple: false,
          nullable: true,
          format: '',
          valuePositionLabels: []
        }
      ]);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([response06, response07, response08]);
      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>TEST-SCHEME-REF</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'TEST-SCHEME-REF',
            JSON.stringify({
              version: '3.4',
              variableCodings: [
                {
                  id: 'radio-group-images_1',
                  alias: '06',
                  sourceType: 'BASE'
                },
                { id: '06', alias: '07', sourceType: 'BASE' },
                { id: '07', alias: '08', sourceType: 'BASE' }
              ]
            })
          )
        ]);

      const plan = await service.prepareAutocoderBatch(
        workspaceId,
        ['1'],
        2,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext()
      );

      expect(plan.autoCoderRun).toBe(2);
      expect(plan.codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 6235425,
          status_v3: expect.any(String)
        }),
        expect.objectContaining({
          id: 6235421,
          status_v3: expect.any(String)
        }),
        expect.objectContaining({
          id: 6235424,
          status_v3: expect.any(String)
        })
      ]));
      expect(plan.codedResponses).toHaveLength(3);
      expect(plan.codedResponses).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ isNew: true })
      ]));
      expect(Autocoder.CodingSchemeFactory.code).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'radio-group-images_1',
            subform: undefined
          }),
          expect.objectContaining({ id: '06', subform: undefined }),
          expect.objectContaining({ id: '07', subform: undefined })
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            id: 'radio-group-images_1',
            alias: 'radio-group-images_1'
          }),
          expect.objectContaining({ id: '06', alias: '06' }),
          expect.objectContaining({ id: '07', alias: '07' })
        ])
      );
      expect(responseRepository.manager.connection.createQueryRunner)
        .not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('resolves the supported base-to-derived shadow without first-wins behavior', async () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.validate as jest.Mock)
        .mockImplementationOnce(actualAutocoder.CodingSchemeFactory.validate);
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementationOnce(actualAutocoder.CodingSchemeFactory.code);
      const importedTarget = createMockResponse(379724, 1, '_01');
      importedTarget.subform = undefined;
      const sourceResponse = createMockResponse(379725, 1, 'source');
      sourceResponse.subform = '';
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT_1', new Set(['_01', 'source'])]])
      );
      mockWorkspaceFilesService.getVariableInfoForScheme.mockResolvedValueOnce([
        {
          id: '_01',
          alias: '_01',
          type: 'string',
          multiple: false,
          nullable: true,
          format: '',
          valuePositionLabels: []
        },
        {
          id: 'source',
          alias: 'source',
          type: 'string',
          multiple: false,
          nullable: true,
          format: '',
          valuePositionLabels: []
        }
      ]);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([importedTarget, sourceResponse]);
      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>DERIVED-SCHEME</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'TEST-SCHEME-REF',
            JSON.stringify({
              version: '3.4',
              variableCodings: [
                { id: '_01', sourceType: 'BASE' },
                { id: 'source', sourceType: 'BASE' },
                {
                  id: 'derived-_01',
                  alias: '_01',
                  sourceType: 'CONCAT_CODE',
                  deriveSources: ['source', '_01']
                }
              ]
            })
          )
        ]);

      const plan = await service.prepareAutocoderBatch(
        workspaceId,
        ['1'],
        1,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext()
      );

      expect(plan.codedResponses.filter(response => (
        response.id === 379724
      ))).toHaveLength(1);
      expect(plan.codedResponses).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 379724 }),
        expect.objectContaining({ id: 379725 })
      ]));
      expect(responseRepository.manager.connection.createQueryRunner)
        .not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('updates the existing MMB102 target through its BASE_NO_VALUE shadow', async () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementation(actualAutocoder.CodingSchemeFactory.code);
      const importedTarget = createMockResponse(6100, 1, '01', '', 7);
      importedTarget.status_v1 = 7;
      const sourceResponses = ['01a', '01b', '01c', '01d']
        .map((variableId, index) => {
          const response = createMockResponse(
            6101 + index,
            1,
            variableId,
            'selected',
            5
          );
          response.status_v1 = 5;
          response.code_v1 = 1;
          response.score_v1 = 1;
          return response;
        });
      const mmb102VariableCodings = [
        ...['01a', '01b', '01c', '01d'].map(id => ({
          id,
          sourceType: 'BASE'
        })),
        {
          id: 'M0_XX00_CMCa',
          alias: '01',
          sourceType: 'BASE_NO_VALUE',
          codes: []
        },
        {
          id: '01',
          sourceType: 'SUM_SCORE',
          deriveSources: ['01a', '01b', '01c', '01d'],
          codeModel: 'MANUAL_AND_RULES',
          codes: [{
            id: 1,
            score: 1,
            ruleSets: [{
              rules: [{ method: 'MATCH', parameters: ['4'] }]
            }]
          }]
        }
      ];
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([[
          'TEST_UNIT_1',
          new Set(['01', '01a', '01b', '01c', '01d'])
        ]])
      );
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([importedTarget, ...sourceResponses]);
      (fileUploadRepository.find as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>TEST-SCHEME-REF</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'TEST-SCHEME-REF',
            JSON.stringify({
              version: '3.4',
              variableCodings: mmb102VariableCodings
            })
          )
        ]);

      const plan = await service.prepareAutocoderBatch(
        workspaceId,
        ['1'],
        2,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext()
      );

      const targetUpdates = plan.codedResponses.filter(response => (
        response.id === importedTarget.id
      ));
      expect(targetUpdates).toEqual([
        expect.objectContaining({
          id: importedTarget.id,
          status_v3: 'CODING_COMPLETE',
          code_v3: 1,
          score_v3: 1
        })
      ]);
      expect(plan.codedResponses).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          isNew: true,
          variableid: '01'
        })
      ]));
      expect(plan.codedResponses.filter(response => (
        response.variableid === 'M0_XX00_CMCa'
      ))).toHaveLength(0);
      expect(responseRepository.manager.connection.createQueryRunner)
        .not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('accepts a run-1-generated MMB102 target through its BASE_NO_VALUE shadow', () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementation(actualAutocoder.CodingSchemeFactory.code);
      const codeResponses = (
        service as unknown as {
          codeAutocoderResponses: (
            responses: object[],
            variableCodings: object[],
            inputOrigins: object[]
          ) => Array<{
            id: string;
            status: string;
            code?: number;
            score?: number;
          }>;
        }
      ).codeAutocoderResponses.bind(service);
      const variableCodings = [
        { id: '01a', sourceType: 'BASE' },
        {
          id: 'M0_XX00_CMCa',
          alias: '01',
          sourceType: 'BASE_NO_VALUE',
          codes: []
        },
        {
          id: '01',
          sourceType: 'SUM_SCORE',
          deriveSources: ['01a'],
          codeModel: 'MANUAL_AND_RULES',
          codes: [{
            id: 1,
            score: 1,
            ruleSets: [{
              rules: [{ method: 'MATCH', parameters: ['1'] }]
            }]
          }]
        }
      ];

      const results = codeResponses([
        {
          id: '01a',
          value: 'selected',
          status: 'CODING_COMPLETE',
          code: 1,
          score: 1
        },
        {
          id: '01',
          value: null,
          status: 'INVALID'
        }
      ], variableCodings, [
        {
          responseId: 6101,
          storedVariableId: '01a',
          isAutocoderGenerated: false
        },
        {
          responseId: 6100,
          storedVariableId: '01',
          isAutocoderGenerated: true
        }
      ]);

      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: '01',
          status: 'CODING_COMPLETE',
          code: 1,
          score: 1
        })
      ]));
      expect(results.find(result => (
        result.id === 'M0_XX00_CMCa'
      ))).toBeUndefined();
    });

    it('keeps partial MMB102 sources invalid without leaking the structural target', () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementation(actualAutocoder.CodingSchemeFactory.code);
      const codeResponses = (
        service as unknown as {
          codeAutocoderResponses: (
            responses: object[],
            variableCodings: object[]
          ) => Array<{
            id: string;
            status: string;
            code?: number;
            score?: number;
          }>;
        }
      ).codeAutocoderResponses.bind(service);
      const variableCodings = [
        ...['01a', '01b', '01c', '01d'].map(id => ({
          id,
          sourceType: 'BASE'
        })),
        {
          id: 'M0_XX00_CMCa',
          alias: '01',
          sourceType: 'BASE_NO_VALUE',
          codes: []
        },
        {
          id: '01',
          sourceType: 'SUM_SCORE',
          deriveSources: ['01a', '01b', '01c', '01d'],
          codeModel: 'MANUAL_AND_RULES',
          codes: []
        }
      ];
      const sourceResponses = ['01a', '01b', '01c'].map(id => ({
        id,
        value: 'selected',
        status: 'CODING_COMPLETE',
        code: 1,
        score: 1
      }));

      const results = codeResponses([
        ...sourceResponses,
        {
          id: '01d',
          value: null,
          status: 'DISPLAYED'
        },
        {
          id: '01',
          value: null,
          status: 'INVALID'
        }
      ], variableCodings);

      expect(results.filter(result => result.id === '01')).toEqual([
        expect.objectContaining({
          id: '01',
          status: 'INVALID'
        })
      ]);
      expect(results.filter(result => (
        result.id === 'M0_XX00_CMCa'
      ))).toHaveLength(0);
    });

    it('derives MZV005 item 02 only from its own source pair', () => {
      const actualAutocoder = jest.requireActual<typeof import('@iqb/responses')>(
        '@iqb/responses'
      );
      (Autocoder.CodingSchemeFactory.code as jest.Mock)
        .mockImplementation(actualAutocoder.CodingSchemeFactory.code);
      const codeResponses = (
        service as unknown as {
          codeAutocoderResponses: (
            responses: object[],
            variableCodings: object[]
          ) => Array<{
            id: string;
            value: unknown;
            status: string;
            code?: number;
          }>;
        }
      ).codeAutocoderResponses.bind(service);
      const derivedCoding = (
        id: string,
        alias: string,
        deriveSources: string[]
      ) => ({
        id,
        alias,
        sourceType: 'CONCAT_CODE',
        deriveSources,
        codeModel: 'MANUAL_AND_RULES',
        codes: [{
          id: 1,
          score: 1,
          ruleSets: [{
            rules: [{ method: 'MATCH', parameters: ['1_1'] }]
          }]
        }]
      });
      const sourceCodings = [
        ['text-field-simple_1766055524921_1', '01a'],
        ['text-field-simple_1766054982415_1', '01b'],
        ['text-field-simple_1766055021100_1', '02a'],
        ['text-field-simple_1766055537277_1', '02b']
      ].map(([id, alias]) => ({ id, alias, sourceType: 'BASE' }));
      const variableCodings = [
        ...sourceCodings,
        derivedCoding('d_1752498297171', '01', [
          'text-field-simple_1766055524921_1',
          'text-field-simple_1766054982415_1'
        ]),
        derivedCoding('d_1752498377846', '02', [
          'text-field-simple_1766055021100_1',
          'text-field-simple_1766055537277_1'
        ])
      ];
      const responses = ['01a', '01b', '02a', '02b'].map(id => ({
        id,
        value: 'selected',
        status: 'CODING_COMPLETE',
        code: id === '01b' ? 9 : 1,
        score: 1
      }));

      const results = codeResponses(responses, variableCodings);

      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: '02',
          value: '1_1',
          status: 'CODING_COMPLETE',
          code: 1
        })
      ]));
      expect(results.find(result => result.id === '01')?.value).toBe('1_9');
    });

    it('does not open a transaction during a successful preflight', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      const result = await service.prepareAutocoderBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext()
      );

      expect(result?.statistics.totalResponses).toBe(2);
      expect(responseRepository.manager.connection.createQueryRunner)
        .not.toHaveBeenCalled();
      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('routes all PostgreSQL preflight reads through the locked entity manager', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);
      const preflightManager = {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === Persons) return personsRepository;
          if (entity === Booklet) return bookletRepository;
          if (entity === Unit) return unitRepository;
          if (entity === ResponseEntity) return responseRepository;
          if (entity === FileUpload) return fileUploadRepository;
          throw new Error('Unexpected preflight repository');
        })
      };

      await service.prepareAutocoderBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext(),
        Number.MAX_SAFE_INTEGER,
        preflightManager as never
      );

      expect(preflightManager.getRepository).toHaveBeenCalledWith(Persons);
      expect(preflightManager.getRepository).toHaveBeenCalledWith(Booklet);
      expect(preflightManager.getRepository).toHaveBeenCalledWith(Unit);
      expect(preflightManager.getRepository).toHaveBeenCalledWith(ResponseEntity);
      expect(preflightManager.getRepository).toHaveBeenCalledWith(FileUpload);
      expect(mockWorkspaceExclusionService.resolveExclusionsForQueries)
        .toHaveBeenCalledWith(workspaceId, preflightManager);
      expect(mockCodingReadinessService.filterResponsesCodeable)
        .toHaveBeenCalledWith(
          workspaceId,
          mockResponses,
          mockUnits,
          preflightManager
        );
      expect(responseRepository.manager.connection.createQueryRunner)
        .not.toHaveBeenCalled();
    });

    it('stops building a batch plan when its response budget is exhausted', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([mockUnits[0]])
        .mockResolvedValueOnce([mockResponses[0]]);
      (Autocoder.CodingSchemeFactory.code as jest.Mock).mockReturnValueOnce([
        {
          id: 'var1',
          value: 'first',
          status: 'CODING_COMPLETE',
          code: 1,
          score: 1,
          subform: ''
        },
        {
          id: 'derived-var',
          value: 'second',
          status: 'CODING_COMPLETE',
          code: 1,
          score: 1,
          subform: ''
        }
      ]);

      await expect(service.prepareAutocoderBatch(
        workspaceId,
        ['1'],
        autoCoderRun,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        service.createAutocoderPreflightContext(),
        1
      )).rejects.toThrow(
        'remaining in-memory plan budget of 1 responses'
      );

      expect(mockResponseManagementService.updateResponsesInDatabase)
        .not.toHaveBeenCalled();
    });

    it('reuses coding-scheme validation across person batches', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);
      const preflightContext = service.createAutocoderPreflightContext();

      await service.prepareAutocoderBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        preflightContext
      );
      await service.prepareAutocoderBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        'preflight-job',
        undefined,
        undefined,
        preflightContext
      );

      expect(mockWorkspaceFilesService.getVariableInfoForScheme)
        .toHaveBeenCalledTimes(2);
    });

    it('should call progress callback at appropriate intervals', async () => {
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockUnits)
        .mockResolvedValueOnce(mockResponses);

      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });

      const progressCallback = jest.fn();

      await service.processTestPersonsBatch(workspaceId, personIds, autoCoderRun, progressCallback, jobId);

      expect(progressCallback).toHaveBeenCalledWith(0);
      // Validating just a few main points to ensure callback is called
      expect(progressCallback).toHaveBeenCalledWith(100);
    });
  });
});
