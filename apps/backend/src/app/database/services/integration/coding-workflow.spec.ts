import { Response } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  SelectQueryBuilder,
  QueryRunner
} from 'typeorm';
import { Queue, Job } from 'bull';
import { getQueueToken } from '@nestjs/bull';
import { CodingProcessService } from '../coding/coding-process.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { CodingResultsExportService } from '../coding/coding-results-export.service';
import { CodingListService } from '../coding/coding-list.service';
import {
  JobQueueService,
  TestPersonCodingJobData
} from '../../../job-queue/job-queue.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { ResponseManagementService } from '../test-results/response-management.service';
import { CacheService } from '../../../cache/cache.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';

// Mock Autocoder
jest.mock('@iqb/responses', () => ({
  CodingFactory: {
    code: jest.fn().mockImplementation(() => ({
      code: 1,
      status: 'CODING_COMPLETE',
      score: 1
    }))
  }
}));

// Mock cheerio for XML parsing
jest.mock('cheerio', () => ({
  load: jest.fn().mockImplementation(() => ({
    find: jest.fn().mockImplementation((selector: string) => ({
      text: jest
        .fn()
        .mockReturnValue(selector === 'codingSchemeRef' ? 'TEST_SCHEME' : '')
    }))
  }))
}));

describe('Coding Workflow Integration', () => {
  let moduleRef: TestingModule;
  let codingProcessService: CodingProcessService;
  let codingValidationService: CodingValidationService;
  let codingResultsExportService: CodingResultsExportService;
  let jobQueueService: JobQueueService;

  // Repository mocks
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let fileUploadRepository: Repository<FileUpload>;
  let codingJobRepository: Repository<CodingJob>;
  let codingJobUnitRepository: Repository<CodingJobUnit>;
  let codingJobVariableRepository: Repository<CodingJobVariable>;

  // Service mocks
  let workspaceFilesService: jest.Mocked<WorkspaceFilesService>;
  let workspaceCoreService: jest.Mocked<WorkspaceCoreService>;
  let responseManagementService: jest.Mocked<ResponseManagementService>;
  let codingListService: jest.Mocked<CodingListService>;
  let cacheService: jest.Mocked<CacheService>;
  let testPersonCodingQueue: jest.Mocked<Queue<TestPersonCodingJobData>>;

  const WORKSPACE_ID = 1;

  // Helper: Create mock person
  const createMockPerson = (
    id: number,
    group: string = 'test_group'
  ): Persons => ({
    id,
    workspace_id: WORKSPACE_ID,
    group,
    login: `test_person_${id}`,
    code: `code_${id}`,
    consider: true,
    uploaded_at: new Date(),
    source: 'test',
    booklets: [],
    booklets_relation: []
  });

  // Helper: Create mock booklet
  const createMockBooklet = (id: number, personId: number): Booklet => ({
    id,
    infoid: 1,
    personid: personId,
    lastts: 0,
    firstts: 0,
    person: createMockPerson(personId),
    units: [],
    sessions: [],
    bookletLogs: [],
    bookletinfo: {
      id: 1,
      name: `booklet_${id}`,
      size: 0
    } as BookletInfo
  });

  // Helper: Create mock job
  const createMockJob = (
    jobId: string,
    data: TestPersonCodingJobData
  ): Job<TestPersonCodingJobData> => ({
    id: jobId,
    data,
    getState: jest.fn().mockResolvedValue('waiting'),
    remove: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined)
  }) as unknown as Job<TestPersonCodingJobData>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup queue mock
    testPersonCodingQueue = {
      add: jest
        .fn()
        .mockImplementation(data => Promise.resolve(
          createMockJob('test-job-id', data as TestPersonCodingJobData)
        )
        ),
      getJob: jest.fn().mockImplementation((jobId: string) => Promise.resolve(
        createMockJob(jobId, {
          workspaceId: WORKSPACE_ID,
          personIds: ['1', '2'],
          groupNames: 'test_group'
        })
      )
      ),
      getJobs: jest.fn().mockImplementation(() => Promise.resolve([])),
      client: {
        ping: jest.fn().mockResolvedValue('PONG')
      } as unknown as Record<string, unknown>,
      isReady: jest.fn().mockResolvedValue(true),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0
      })
    } as unknown as jest.Mocked<Queue<TestPersonCodingJobData>>;

    // Setup service mocks
    workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(
        new Map([
          ['UNIT_1', new Set(['var1', 'var2'])],
          ['UNIT_2', new Set(['var3', 'var4'])]
        ])
      ),
      getTestFile: jest.fn().mockResolvedValue({
        file_id: 'ALIAS_1',
        data: '<test><codingSchemeRef>TEST_SCHEME</codingSchemeRef></test>',
        filename: 'test.xml'
      })
    } as unknown as jest.Mocked<WorkspaceFilesService>;

    workspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<WorkspaceCoreService>;

    responseManagementService = {
      updateResponsesInDatabase: jest.fn().mockResolvedValue(true)
    } as unknown as jest.Mocked<ResponseManagementService>;

    codingListService = {
      getCodingListVariables: jest.fn().mockResolvedValue([
        { unitName: 'unit_1', variableId: 'var1' },
        { unitName: 'unit_1', variableId: 'var2' },
        { unitName: 'unit_2', variableId: 'var3' }
      ]),
      getVariablePageMap: jest.fn().mockResolvedValue(new Map([['var1', '1']])),
      getCodingResultsByVersionCsvStream: jest.fn().mockReturnValue({
        pipe: jest.fn().mockReturnValue(undefined)
      }),
      getCodingResultsByVersionAsExcel: jest
        .fn()
        .mockResolvedValue(Buffer.from('mock-excel-data'))
    } as unknown as jest.Mocked<CodingListService>;

    cacheService = {
      generateValidationCacheKey: jest.fn().mockReturnValue('test-cache-key'),
      getPaginatedValidationResults: jest.fn().mockResolvedValue(null),
      storeValidationResults: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<CacheService>;

    // Create mock query runner
    const mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue([])
          })
        })
      }
    };

    // Create base repository mock with manager.connection for CodingProcessService
    const createMockRepository = () => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue([]),
        getRawMany: jest.fn().mockResolvedValue([])
      }),
      save: jest
        .fn()
        .mockImplementation(entities => Promise.resolve(entities)),
      update: jest
        .fn()
        .mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] }),
      query: jest.fn().mockResolvedValue([{ applied_count: '5' }]),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
        }
      }
    });

    personsRepository =
      createMockRepository() as unknown as Repository<Persons>;
    bookletRepository =
      createMockRepository() as unknown as Repository<Booklet>;
    unitRepository = createMockRepository() as unknown as Repository<Unit>;
    responseRepository =
      createMockRepository() as unknown as Repository<ResponseEntity>;
    fileUploadRepository =
      createMockRepository() as unknown as Repository<FileUpload>;
    codingJobRepository =
      createMockRepository() as unknown as Repository<CodingJob>;
    codingJobUnitRepository =
      createMockRepository() as unknown as Repository<CodingJobUnit>;
    codingJobVariableRepository =
      createMockRepository() as unknown as Repository<CodingJobVariable>;

    moduleRef = await Test.createTestingModule({
      providers: [
        CodingProcessService,
        CodingValidationService,
        CodingResultsExportService,
        JobQueueService,
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
          }
        },
        {
          provide: getQueueToken('test-person-coding'),
          useValue: testPersonCodingQueue
        },
        {
          provide: getQueueToken('coding-statistics'),
          useValue: testPersonCodingQueue
        },
        {
          provide: getQueueToken('data-export'),
          useValue: testPersonCodingQueue
        },
        {
          provide: getQueueToken('flat-response-filter-options'),
          useValue: testPersonCodingQueue
        },
        {
          provide: getQueueToken('test-results-upload'),
          useValue: testPersonCodingQueue
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: personsRepository
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: bookletRepository
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: unitRepository
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: responseRepository
        },
        {
          provide: getRepositoryToken(FileUpload),
          useValue: fileUploadRepository
        },
        {
          provide: getRepositoryToken(CodingJob),
          useValue: codingJobRepository
        },
        {
          provide: getRepositoryToken(CodingJobUnit),
          useValue: codingJobUnitRepository
        },
        {
          provide: getRepositoryToken(CodingJobVariable),
          useValue: codingJobVariableRepository
        },
        {
          provide: WorkspaceFilesService,
          useValue: workspaceFilesService
        },
        {
          provide: WorkspaceCoreService,
          useValue: workspaceCoreService
        },
        {
          provide: ResponseManagementService,
          useValue: responseManagementService
        },
        {
          provide: CodingListService,
          useValue: codingListService
        },
        {
          provide: CacheService,
          useValue: cacheService
        }
      ]
    }).compile();

    codingProcessService =
      moduleRef.get<CodingProcessService>(CodingProcessService);
    codingValidationService = moduleRef.get<CodingValidationService>(
      CodingValidationService
    );
    codingResultsExportService = moduleRef.get<CodingResultsExportService>(
      CodingResultsExportService
    );
    jobQueueService = moduleRef.get<JobQueueService>(JobQueueService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('Job Creation and Distribution', () => {
    it('should create a coding job for test persons by IDs', async () => {
      const mockPersons = [createMockPerson(1), createMockPerson(2)];
      jest.spyOn(personsRepository, 'find').mockResolvedValue(mockPersons);

      const result = await codingProcessService.codeTestPersons(
        WORKSPACE_ID,
        '1,2',
        1
      );

      expect(result.jobId).toBeDefined();
      expect(testPersonCodingQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          personIds: expect.arrayContaining(['1', '2']),
          autoCoderRun: 1
        }),
        undefined
      );
    });

    it('should create a coding job for test persons by group names', async () => {
      const mockPersons = [
        createMockPerson(1, 'group_a'),
        createMockPerson(2, 'group_a'),
        createMockPerson(3, 'group_b')
      ];
      jest
        .spyOn(personsRepository, 'find')
        .mockResolvedValue(mockPersons.slice(0, 2));

      const result = await codingProcessService.codeTestPersons(
        WORKSPACE_ID,
        'group_a',
        1
      );

      expect(result.jobId).toBeDefined();
      expect(testPersonCodingQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          groupNames: 'group_a'
        }),
        undefined
      );
    });

    it('should handle empty person list gracefully', async () => {
      jest.spyOn(personsRepository, 'find').mockResolvedValue([]);

      const result = await codingProcessService.codeTestPersons(
        WORKSPACE_ID,
        'empty_group',
        1
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle invalid workspace ID', async () => {
      const result = await codingProcessService.codeTestPersons(0, '1,2', 1);

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should support multiple autocoder runs', async () => {
      const mockPersons = [createMockPerson(1)];
      jest.spyOn(personsRepository, 'find').mockResolvedValue(mockPersons);

      await codingProcessService.codeTestPersons(WORKSPACE_ID, '1', 2);

      expect(testPersonCodingQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({ autoCoderRun: 2 }),
        undefined
      );
    });

    it('should retrieve job status', async () => {
      const mockJob = createMockJob('test-job-id', {
        workspaceId: WORKSPACE_ID,
        personIds: ['1', '2']
      });
      jest.spyOn(testPersonCodingQueue, 'getJob').mockResolvedValue(mockJob);
      jest.spyOn(mockJob, 'getState').mockResolvedValue('completed');

      const job = await jobQueueService.getTestPersonCodingJob('test-job-id');
      const state = await job.getState();

      expect(state).toBe('completed');
    });
  });

  describe('Coding Process Execution', () => {
    it('should handle missing persons', async () => {
      jest.spyOn(personsRepository, 'find').mockResolvedValue([]);

      const result = await codingProcessService.processTestPersonsBatch(
        WORKSPACE_ID,
        ['999'],
        1
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle missing booklets', async () => {
      const mockPersons = [createMockPerson(1)];
      jest.spyOn(personsRepository, 'find').mockResolvedValue(mockPersons);
      jest.spyOn(bookletRepository, 'find').mockResolvedValue([]);

      const result = await codingProcessService.processTestPersonsBatch(
        WORKSPACE_ID,
        ['1'],
        1
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should handle missing units', async () => {
      const mockPersons = [createMockPerson(1)];
      const mockBooklets = [createMockBooklet(1, 1)];
      jest.spyOn(personsRepository, 'find').mockResolvedValue(mockPersons);
      jest.spyOn(bookletRepository, 'find').mockResolvedValue(mockBooklets);
      jest.spyOn(unitRepository, 'find').mockResolvedValue([]);

      const result = await codingProcessService.processTestPersonsBatch(
        WORKSPACE_ID,
        ['1'],
        1
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should handle job cancellation during processing', async () => {
      const mockJob = createMockJob('cancelled-job', {
        workspaceId: WORKSPACE_ID,
        personIds: ['1'],
        isPaused: true
      });
      jest.spyOn(testPersonCodingQueue, 'getJob').mockResolvedValue(mockJob);

      const progressCallback = jest.fn();
      const result = await codingProcessService.processTestPersonsBatch(
        WORKSPACE_ID,
        ['1'],
        1,
        progressCallback,
        'cancelled-job'
      );

      expect(result).toBeDefined();
    });
  });

  describe('Results Application', () => {
    it('should apply coding results to responses', async () => {
      jest
        .spyOn(responseManagementService, 'updateResponsesInDatabase')
        .mockResolvedValue(true);

      const result = await responseManagementService.updateResponsesInDatabase(
        [
          {
            id: 1,
            code_v1: 1,
            status_v1: 'CODING_COMPLETE',
            score_v1: 1
          }
        ],
        {} as unknown as QueryRunner,
        undefined,
        jest.fn().mockResolvedValue(false),
        jest.fn(),
        {}
      );

      expect(result).toBe(true);
    });

    it('should validate coding completeness', async () => {
      const expectedCombinations = [
        {
          unit_key: 'unit_1',
          login_name: 'test_person_1',
          login_code: 'code_1',
          booklet_id: 'booklet_1',
          variable_id: 'var1'
        }
      ];

      const mockQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1)
      };
      jest
        .spyOn(responseRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
        );

      const result = await codingValidationService.validateCodingCompleteness(
        WORKSPACE_ID,
        expectedCombinations,
        1,
        50
      );

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should get CODING_INCOMPLETE variables', async () => {
      const mockRawResults = [
        { unitName: 'unit_1', variableId: 'var1', responseCount: '5' }
      ];

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockRawResults)
      };
      jest
        .spyOn(responseRepository, 'createQueryBuilder')
        .mockReturnValue(
          mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
        );

      const result =
        await codingValidationService.getCodingIncompleteVariables(
          WORKSPACE_ID
        );

      expect(Array.isArray(result)).toBe(true);
    });

    it('should invalidate cache for incomplete variables', async () => {
      await codingValidationService.invalidateIncompleteVariablesCache(
        WORKSPACE_ID
      );

      expect(cacheService.delete).toHaveBeenCalledWith(
        `coding_incomplete_variables_v2:${WORKSPACE_ID}`
      );
    });

    it('should get applied results count', async () => {
      const incompleteVariables = [
        { unitName: 'unit_1', variableId: 'var1' },
        { unitName: 'unit_1', variableId: 'var2' }
      ];

      const result = await codingValidationService.getAppliedResultsCount(
        WORKSPACE_ID,
        incompleteVariables
      );

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Export Generation', () => {
    it('should export coding results by version as CSV', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        pipe: jest.fn()
      } as unknown as Response;

      await codingResultsExportService.exportCodingResultsByVersionAsCsv(
        WORKSPACE_ID,
        'v1',
        'auth-token',
        'http://localhost',
        false,
        mockResponse
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        expect.stringContaining('csv')
      );
    });

    it('should export coding results by version as Excel', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn()
      } as unknown as Response;
      jest
        .spyOn(codingListService, 'getCodingResultsByVersionAsExcel')
        .mockResolvedValue(Buffer.from('mock-excel'));

      await codingResultsExportService.exportCodingResultsByVersionAsExcel(
        WORKSPACE_ID,
        'v1',
        'auth-token',
        'http://localhost',
        false,
        mockResponse
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        expect.stringContaining('spreadsheet')
      );
    });

    it('should export aggregated results with most-frequent method', async () => {
      const mockCodingJobUnits = [
        {
          id: 1,
          unit_name: 'unit_1',
          variable_id: 'var1',
          coding_job: {
            workspace_id: WORKSPACE_ID,
            codingJobCoders: [{ user: { username: 'coder1' } }]
          },
          response: {
            code_v3: 1,
            unit: {
              booklet: {
                person: { login: 'person1', code: 'code1', group: 'group1' },
                bookletinfo: { name: 'booklet1' }
              }
            }
          }
        }
      ];

      jest
        .spyOn(codingJobUnitRepository, 'find')
        .mockResolvedValue(mockCodingJobUnits as unknown as CodingJobUnit[]);

      const buffer =
        await codingResultsExportService.exportCodingResultsAggregated(
          WORKSPACE_ID,
          false,
          false,
          false,
          false,
          'most-frequent',
          false,
          false
        );

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle empty coding jobs for export', async () => {
      jest.spyOn(codingJobUnitRepository, 'find').mockResolvedValue([]);

      await expect(
        codingResultsExportService.exportCodingResultsAggregated(WORKSPACE_ID)
      ).rejects.toThrow('No coding jobs found');
    });

    it('should support anonymized coder export', async () => {
      const mockCodingJobUnits = [
        {
          id: 1,
          unit_name: 'unit_1',
          variable_id: 'var1',
          coding_job: {
            workspace_id: WORKSPACE_ID,
            codingJobCoders: [{ user: { username: 'coder1' } }]
          },
          response: {
            code_v3: 1,
            unit: {
              booklet: {
                person: { login: 'person1', code: 'code1', group: 'group1' },
                bookletinfo: { name: 'booklet1' }
              }
            }
          }
        }
      ];

      jest
        .spyOn(codingJobUnitRepository, 'find')
        .mockResolvedValue(mockCodingJobUnits as unknown as CodingJobUnit[]);

      const buffer =
        await codingResultsExportService.exportCodingResultsAggregated(
          WORKSPACE_ID,
          false,
          false,
          true,
          false
        );

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });
});
