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

jest.mock('@iqb/responses', () => ({
  CodingSchemeFactory: {
    code: jest.fn().mockReturnValue([])
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
    getUnitVariableMap: jest.fn()
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
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
    isReleased: boolean;
    manager: {
      update: jest.Mock;
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
          useValue: {
            resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
          }
        },
        { provide: getRepositoryToken(FileUpload), useValue: { find: jest.fn(), findBy: jest.fn(), findOne: jest.fn() } },
        { provide: getRepositoryToken(Persons), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Unit), useValue: { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) } },
        { provide: getRepositoryToken(Booklet), useValue: { find: jest.fn(), createQueryBuilder: jest.fn() } },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
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
        { provide: WorkspaceCoreService, useValue: mockWorkspaceCoreService }
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
          subform: null
        })
      ]));
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
