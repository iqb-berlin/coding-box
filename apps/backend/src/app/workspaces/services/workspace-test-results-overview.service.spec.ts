import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceTestResultsOverviewService } from './workspace-test-results-overview.service';
import { Persons, Unit, ResponseEntity } from '../../common';
import { Booklet } from '../entities/booklet.entity';
import { Session } from '../entities/session.entity';

describe('WorkspaceTestResultsOverviewService', () => {
  let service: WorkspaceTestResultsOverviewService;
  let personsRepository: jest.Mocked<Repository<Persons>>;
  let unitRepository: jest.Mocked<Repository<Unit>>;
  let bookletRepository: jest.Mocked<Repository<Booklet>>;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let sessionRepository: jest.Mocked<Repository<Session>>;

  const createMockQueryBuilder = (mockData: unknown) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(mockData),
    getCount: jest.fn().mockResolvedValue(mockData)
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTestResultsOverviewService,
        {
          provide: getRepositoryToken(Persons),
          useValue: {
            count: jest.fn(),
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(Session),
          useValue: {
            createQueryBuilder: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<WorkspaceTestResultsOverviewService>(
      WorkspaceTestResultsOverviewService
    );
    personsRepository = module.get(getRepositoryToken(Persons));
    unitRepository = module.get(getRepositoryToken(Unit));
    bookletRepository = module.get(getRepositoryToken(Booklet));
    responseRepository = module.get(getRepositoryToken(ResponseEntity));
    sessionRepository = module.get(getRepositoryToken(Session));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getWorkspaceTestResultsOverview', () => {
    it('should return comprehensive overview statistics', async () => {
      const workspaceId = 1;

      // Mock test persons count
      personsRepository.count.mockResolvedValue(10);

      // Mock test groups
      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          createMockQueryBuilder([{ group: 'A' }, { group: 'B' }])
        );

      // Mock unique booklets
      bookletRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          createMockQueryBuilder([{ name: 'Booklet1' }, { name: 'Booklet2' }])
        );

      // Mock unique units
      unitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(
          createMockQueryBuilder([{ unitKey: 'Unit1' }, { unitKey: 'Unit2' }])
        );

      // Mock unique responses count
      responseRepository.createQueryBuilder = jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(50)
      });

      // Mock response status counts
      const statusQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { status: 1, count: 30 },
          { status: 2, count: 20 }
        ])
      };
      responseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(statusQueryBuilder);

      // Mock session counts
      const sessionQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { value: 'Chrome', count: 5 },
          { value: 'Firefox', count: 3 }
        ])
      };
      sessionRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(sessionQueryBuilder);

      const result = await service.getWorkspaceTestResultsOverview(workspaceId);

      expect(result).toEqual({
        testPersons: 10,
        testGroups: 2,
        uniqueBooklets: 2,
        uniqueUnits: 2,
        uniqueResponses: 50,
        responseStatusCounts: expect.any(Object),
        sessionBrowserCounts: expect.any(Object),
        sessionOsCounts: expect.any(Object),
        sessionScreenCounts: expect.any(Object)
      });

      expect(personsRepository.count).toHaveBeenCalledWith({
        where: { workspace_id: workspaceId, consider: true }
      });
    });

    it('should throw error for invalid workspace ID', async () => {
      await expect(
        service.getWorkspaceTestResultsOverview(0)
      ).rejects.toThrow('Invalid workspaceId provided');

      await expect(
        service.getWorkspaceTestResultsOverview(-1)
      ).rejects.toThrow('Invalid workspaceId provided');
    });

    it('should handle empty workspace gracefully', async () => {
      const workspaceId = 1;

      personsRepository.count.mockResolvedValue(0);
      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([]));
      bookletRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([]));
      unitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([]));
      responseRepository.createQueryBuilder = jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      });
      sessionRepository.createQueryBuilder = jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      });

      const result = await service.getWorkspaceTestResultsOverview(workspaceId);

      expect(result.testPersons).toBe(0);
      expect(result.testGroups).toBe(0);
      expect(result.uniqueBooklets).toBe(0);
      expect(result.uniqueUnits).toBe(0);
      expect(result.uniqueResponses).toBe(0);
    });

    it('should map session counts correctly', async () => {
      const workspaceId = 1;

      personsRepository.count.mockResolvedValue(5);
      personsRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([{ group: 'A' }]));
      bookletRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([{ name: 'B1' }]));
      unitRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder([{ unitKey: 'U1' }]));
      responseRepository.createQueryBuilder = jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(10),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      });

      const sessionQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { value: 'Chrome', count: '5' },
          { value: null, count: '2' },
          { value: '', count: '1' }
        ])
      };
      sessionRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(sessionQueryBuilder);

      const result = await service.getWorkspaceTestResultsOverview(workspaceId);

      expect(result.sessionBrowserCounts).toEqual({
        Chrome: 5,
        unknown: 3 // null and empty string mapped to 'unknown'
      });
    });
  });
});
