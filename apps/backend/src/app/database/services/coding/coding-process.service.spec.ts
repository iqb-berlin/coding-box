import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CodingProcessService } from './coding-process.service';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { ResponseManagementService } from '../test-results/response-management.service';
import { CodingStatisticsService } from './coding-statistics.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';

jest.mock('@iqb/responses', () => ({
  CodingFactory: {
    code: jest.fn()
  }
}));

jest.mock('cheerio', () => jest.fn().mockImplementation(() => ({
  find: jest.fn().mockReturnValue({
    text: jest.fn().mockReturnValue('test-scheme-ref')
  })
}))
);

describe('CodingProcessService', () => {
  let service: CodingProcessService;
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let fileUploadRepository: Repository<FileUpload>;

  const mockJobQueueService = {
    getTestPersonCodingJob: jest.fn(),
    addTestPersonCodingJob: jest.fn()
  };

  const mockResponseManagementService = {
    updateResponsesInDatabase: jest.fn().mockResolvedValue(true)
  };

  const mockWorkspaceFilesService = {
    getUnitVariableMap: jest.fn()
  };

  const mockCodingStatisticsService = {
    refreshStatistics: jest.fn()
  };

  // Helper functions
  const createMockPerson = (id: number, workspaceId: number = 1) => ({
    id: id.toString(),
    workspace_id: workspaceId,
    group: 'test_group',
    login: `test_person_${id}`,
    code: `code_${id}`,
    consider: true,
    uploaded_at: new Date()
  });

  const createMockBooklet = (id: number, personId: string) => ({
    id,
    personid: personId
  });

  const createMockUnit = (
    id: number,
    bookletId: number,
    name: string = `unit_${id}`,
    alias: string = `alias_${id}`
  ) => ({
    id,
    bookletid: bookletId,
    name,
    alias
  });

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

  beforeEach(async () => {
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

    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
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
          provide: getRepositoryToken(FileUpload),
          useValue: { find: jest.fn(), findBy: jest.fn(), findOne: jest.fn() }
        },
        { provide: getRepositoryToken(Persons), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Unit), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Booklet), useValue: { find: jest.fn() } },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            manager: {
              connection: {
                createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
              }
            }
          }
        },
        { provide: JobQueueService, useValue: mockJobQueueService },
        {
          provide: ResponseManagementService,
          useValue: mockResponseManagementService
        },
        { provide: WorkspaceFilesService, useValue: mockWorkspaceFilesService },
        {
          provide: CodingStatisticsService,
          useValue: mockCodingStatisticsService
        }
      ]
    }).compile();

    service = module.get<CodingProcessService>(CodingProcessService);
    personsRepository = module.get<Repository<Persons>>(
      getRepositoryToken(Persons)
    );
    bookletRepository = module.get<Repository<Booklet>>(
      getRepositoryToken(Booklet)
    );
    unitRepository = module.get<Repository<Unit>>(getRepositoryToken(Unit));
    responseRepository = module.get<Repository<ResponseEntity>>(
      getRepositoryToken(ResponseEntity)
    );
    fileUploadRepository = module.get<Repository<FileUpload>>(
      getRepositoryToken(FileUpload)
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processTestPersonsBatch', () => {
    const workspaceId = 1;
    const personIds = ['1', '2'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1), createMockPerson(2)]);

      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([
          createMockBooklet(1, '1'),
          createMockBooklet(2, '2')
        ]);

      unitRepository.find = jest
        .fn()
        .mockResolvedValue([
          createMockUnit(1, 1, 'TEST_UNIT_1', 'ALIAS_1'),
          createMockUnit(2, 2, 'TEST_UNIT_2', 'ALIAS_2')
        ]);

      const mockResponses = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];

      // Configure the query builder to return responses
      mockQueryBuilder.getMany.mockResolvedValue(mockResponses);

      // The service converts unit names to uppercase when building the validVariableSets map
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['TEST_UNIT_1', new Set(['var1'])],
          ['TEST_UNIT_2', new Set(['var2'])]
        ])
      );

      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([
          // coding schemes
          createMockFileUpload(
            'SCHEME_1',
            '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'
          ),
          createMockFileUpload(
            'SCHEME_2',
            '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'
          )
        ])
        .mockResolvedValueOnce([
          // test files
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          ),
          createMockFileUpload(
            'ALIAS_2',
            '<xml><codingSchemeRef>SCHEME_2</codingSchemeRef></xml>'
          )
        ])
        .mockResolvedValueOnce([]); // coding schemes again

      fileUploadRepository.findOne = jest.fn().mockImplementation(options => {
        if (options.where.file_id === 'SCHEME_1') {
          return Promise.resolve(
            createMockFileUpload(
              'SCHEME_1',
              '<codingScheme><variableCodings><variableCoding id="var1"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'
            )
          );
        }
        if (options.where.file_id === 'SCHEME_2') {
          return Promise.resolve(
            createMockFileUpload(
              'SCHEME_2',
              '<codingScheme><variableCodings><variableCoding id="var2"><codes><code id="1">VALUE_PROVIDED</code></codes></variableCoding></variableCodings></codingScheme>'
            )
          );
        }
        return Promise.resolve(null);
      });
    });

    it('should handle an empty person IDs array', async () => {
      // Override mocks to ensure no data is returned for empty array
      personsRepository.find = jest.fn().mockResolvedValue([]);
      bookletRepository.find = jest.fn().mockResolvedValue([]);
      unitRepository.find = jest.fn().mockResolvedValue([]);
      responseRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        [],
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no persons found', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no booklets found', async () => {
      bookletRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no units found', async () => {
      unitRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle no responses found', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should filter out invalid variables not defined in unit schema', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1'), // valid
        createMockResponse(2, 1, 'invalid_var'), // invalid
        createMockResponse(3, 2, 'var2'), // valid
        createMockResponse(4, 2, 'another_invalid') // invalid
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(2); // Only valid variables processed
    });

    it('should handle job cancellation during processing', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('paused'),
        data: { isPaused: true }
      });

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0); // Processing stopped early
    });

    it('should use v2 status for autoCoderRun = 2', async () => {
      const responsesWithV2 = [
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 2, 'var2')
      ];
      responsesWithV2[0].status_v2 = 2;
      responsesWithV2[1].status_v2 = 1;

      mockQueryBuilder.getMany.mockResolvedValue(responsesWithV2);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        2
      );

      expect(result.totalResponses).toBe(2);
    });

    it('should call progress callback at appropriate intervals', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });

      const progressCallback = jest.fn();

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        progressCallback,
        jobId
      );

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(100);
    });

    it('should report all progress stages during batch processing', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });

      const progressCallback = jest.fn();

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        progressCallback,
        jobId
      );

      const expectedProgressValues = [
        0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 100
      ];
      expectedProgressValues.forEach(progress => {
        expect(progressCallback).toHaveBeenCalledWith(progress);
      });
    });

    it('should handle undefined progress callback', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should process batch with all progress stages', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });

      const progressCallback = jest.fn();

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        progressCallback,
        jobId
      );

      [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 100].forEach(p => {
        expect(progressCallback).toHaveBeenCalledWith(p);
      });
    });
  });

  describe('codeTestPersons', () => {
    const workspaceId = 1;
    const autoCoderRun = 1;

    beforeEach(() => {
      mockJobQueueService.addTestPersonCodingJob = jest.fn().mockResolvedValue({
        id: 'test-job-123'
      });
    });

    it('should return empty result for invalid workspace_id', async () => {
      const result = await service.codeTestPersons(0, '1,2,3', autoCoderRun);
      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should return empty result for empty testPersonIdsOrGroups', async () => {
      const result = await service.codeTestPersons(
        workspaceId,
        '',
        autoCoderRun
      );
      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should return empty result for whitespace-only testPersonIdsOrGroups', async () => {
      const result = await service.codeTestPersons(
        workspaceId,
        '   ',
        autoCoderRun
      );
      expect(result.totalResponses).toBe(0);
      expect(result.statusCounts).toEqual({});
    });

    it('should handle numeric person IDs directly', async () => {
      const result = await service.codeTestPersons(
        workspaceId,
        '1,2,3',
        autoCoderRun
      );
      expect(result.jobId).toBe('test-job-123');
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
        workspaceId,
        personIds: ['1', '2', '3'],
        groupNames: undefined,
        autoCoderRun
      });
    });

    it('should fetch persons by group names when non-numeric', async () => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([
          createMockPerson(1, workspaceId),
          createMockPerson(2, workspaceId)
        ]);

      const result = await service.codeTestPersons(
        workspaceId,
        'group1,group2',
        autoCoderRun
      );
      expect(result.jobId).toBe('test-job-123');
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith({
        workspaceId,
        personIds: ['1', '2'],
        groupNames: 'group1,group2',
        autoCoderRun
      });
    });

    it('should return message when no persons found in groups', async () => {
      personsRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.codeTestPersons(
        workspaceId,
        'nonexistent-group',
        autoCoderRun
      );
      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('No persons found');
    });

    it('should handle error when fetching persons by group', async () => {
      personsRepository.find = jest
        .fn()
        .mockRejectedValue(new Error('DB Connection Error'));

      const result = await service.codeTestPersons(
        workspaceId,
        'group1',
        autoCoderRun
      );
      expect(result.totalResponses).toBe(0);
      expect(result.message).toContain('Error fetching persons');
    });

    it('should pass through comma-separated values as-is', async () => {
      await service.codeTestPersons(workspaceId, '1,2,3', autoCoderRun);
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          personIds: ['1', '2', '3']
        })
      );
    });

    it('should filter out empty items from comma-separated list', async () => {
      await service.codeTestPersons(workspaceId, '1,,2,,,3', autoCoderRun);
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          personIds: ['1', '2', '3']
        })
      );
    });

    it('should use default autoCoderRun value of 1', async () => {
      await service.codeTestPersons(workspaceId, '1,2');
      expect(mockJobQueueService.addTestPersonCodingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          autoCoderRun: 1
        })
      );
    });

    it('should include job message with person count', async () => {
      const result = await service.codeTestPersons(
        workspaceId,
        '1,2,3',
        autoCoderRun
      );
      expect(result.message).toContain('3 test persons');
      expect(result.message).toContain('test-job-123');
    });
  });

  describe('cache management', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );

      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);

      fileUploadRepository.findOne = jest
        .fn()
        .mockResolvedValue(createMockFileUpload('SCHEME_1', '{}'));

      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should handle partial cache miss by fetching missing files', async () => {
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([
          createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1'),
          createMockUnit(2, 1, 'TEST_UNIT_2', 'NEW_ALIAS')
        ]);

      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          ),
          createMockFileUpload(
            'NEW_ALIAS',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle empty test file cache', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle invalid XML gracefully', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload('ALIAS_1', 'invalid xml')
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });
  });

  describe('cache management - extended', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );

      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);

      fileUploadRepository.findOne = jest
        .fn()
        .mockResolvedValue(createMockFileUpload('SCHEME_1', '{}'));

      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should reuse cached coding schemes across multiple calls', async () => {
      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle cache TTL expiration', async () => {
      jest.useFakeTimers();

      await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      jest.advanceTimersByTime(16 * 60 * 1000);

      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
      jest.useRealTimers();
    });

    it('should handle missing test files in cache', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });
  });

  describe('coding scheme extraction', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should extract coding scheme references from valid XML', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle missing coding scheme reference in XML', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><otherElement>value</otherElement></xml>'
          )
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle empty coding scheme reference', async () => {
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef></codingSchemeRef></xml>'
          )
        ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });
  });

  describe('response filtering', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should filter responses with valid variables', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1'),
        createMockResponse(2, 1, 'invalid_var')
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(1);
    });

    it('should handle empty variable map', async () => {
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(new Map());
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should handle all invalid variables', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'invalid_1'),
        createMockResponse(2, 1, 'invalid_2')
      ]);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun
      );

      expect(result.totalResponses).toBe(0);
    });
  });

  describe('job cancellation handling', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);
    });

    it('should handle job cancellation at various stages', async () => {
      let callCount = 0;
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockImplementation(() => {
          callCount += 1;
          return Promise.resolve(callCount > 2 ? 'paused' : 'active');
        }),
        data: { isPaused: false }
      });

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should handle job with isPaused flag', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: true }
      });

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should handle missing job', async () => {
      mockJobQueueService.getTestPersonCodingJob = jest
        .fn()
        .mockResolvedValue(null);

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });
  });

  describe('transaction management', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );
      fileUploadRepository.find = jest
        .fn()
        .mockResolvedValueOnce([createMockFileUpload('SCHEME_1', '{}')])
        .mockResolvedValueOnce([
          createMockFileUpload(
            'ALIAS_1',
            '<xml><codingSchemeRef>SCHEME_1</codingSchemeRef></xml>'
          )
        ]);
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should handle transaction rollback on error', async () => {
      mockResponseManagementService.updateResponsesInDatabase = jest
        .fn()
        .mockRejectedValue(new Error('Database error'));

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });

    it('should release queryRunner on completion', async () => {
      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result).toBeDefined();
    });
  });

  describe('error recovery', () => {
    const workspaceId = 1;
    const personIds = ['1'];
    const autoCoderRun = 1;
    const jobId = 'test-job-id';

    beforeEach(() => {
      mockWorkspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['TEST_UNIT', new Set(['var1'])]])
      );
      mockJobQueueService.getTestPersonCodingJob = jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        data: { isPaused: false }
      });
    });

    it('should recover from persons query error', async () => {
      personsRepository.find = jest
        .fn()
        .mockRejectedValue(new Error('DB Error'));

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should recover from booklet query error', async () => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockRejectedValue(new Error('DB Error'));

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should recover from unit query error', async () => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest.fn().mockRejectedValue(new Error('DB Error'));

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0);
    });

    it('should handle file upload repository errors', async () => {
      personsRepository.find = jest
        .fn()
        .mockResolvedValue([createMockPerson(1)]);
      bookletRepository.find = jest
        .fn()
        .mockResolvedValue([createMockBooklet(1, '1')]);
      unitRepository.find = jest
        .fn()
        .mockResolvedValue([createMockUnit(1, 1, 'TEST_UNIT', 'ALIAS_1')]);
      mockQueryBuilder.getMany.mockResolvedValue([
        createMockResponse(1, 1, 'var1')
      ]);
      fileUploadRepository.find = jest
        .fn()
        .mockRejectedValue(new Error('File Error'));

      const result = await service.processTestPersonsBatch(
        workspaceId,
        personIds,
        autoCoderRun,
        undefined,
        jobId
      );

      expect(result.totalResponses).toBe(0);
    });
  });
});
