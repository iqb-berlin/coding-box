import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceTestResultsFacade } from './workspace-test-results-facade.service';
import { WorkspaceTestResultsOverviewService } from './workspace-test-results-overview.service';
import { WorkspaceTestResultsQueryService } from './workspace-test-results-query.service';
import { DuplicateResponseService } from './duplicate-response.service';

describe('WorkspaceTestResultsFacade', () => {
  let facade: WorkspaceTestResultsFacade;
  let overviewService: jest.Mocked<WorkspaceTestResultsOverviewService>;
  let queryService: jest.Mocked<WorkspaceTestResultsQueryService>;
  let duplicateService: jest.Mocked<DuplicateResponseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTestResultsFacade,
        {
          provide: WorkspaceTestResultsOverviewService,
          useValue: {
            getWorkspaceTestResultsOverview: jest.fn()
          }
        },
        {
          provide: WorkspaceTestResultsQueryService,
          useValue: {
            findPersonTestResults: jest.fn(),
            findTestResults: jest.fn(),
            findWorkspaceResponses: jest.fn()
          }
        },
        {
          provide: DuplicateResponseService,
          useValue: {
            resolveDuplicateResponses: jest.fn()
          }
        }
      ]
    }).compile();

    facade = module.get<WorkspaceTestResultsFacade>(
      WorkspaceTestResultsFacade
    );
    overviewService = module.get(WorkspaceTestResultsOverviewService);
    queryService = module.get(WorkspaceTestResultsQueryService);
    duplicateService = module.get(DuplicateResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getWorkspaceTestResultsOverview', () => {
    it('should delegate to overview service', async () => {
      const mockOverview = {
        testPersons: 10,
        testGroups: 2,
        uniqueBooklets: 5,
        uniqueUnits: 15,
        uniqueResponses: 100,
        responseStatusCounts: { COMPLETE: 80, INCOMPLETE: 20 },
        sessionBrowserCounts: { Chrome: 5 },
        sessionOsCounts: { Windows: 5 },
        sessionScreenCounts: { '1920x1080': 5 }
      };

      overviewService.getWorkspaceTestResultsOverview.mockResolvedValue(
        mockOverview
      );

      const result = await facade.getWorkspaceTestResultsOverview(1);

      expect(result).toEqual(mockOverview);
      expect(
        overviewService.getWorkspaceTestResultsOverview
      ).toHaveBeenCalledWith(1);
      expect(
        overviewService.getWorkspaceTestResultsOverview
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('findPersonTestResults', () => {
    it('should delegate to query service', async () => {
      const mockResults = [
        {
          id: 1,
          name: 'Booklet1',
          logs: [],
          units: []
        }
      ];

      queryService.findPersonTestResults.mockResolvedValue(mockResults);

      const result = await facade.findPersonTestResults(1, 1);

      expect(result).toEqual(mockResults);
      expect(queryService.findPersonTestResults).toHaveBeenCalledWith(1, 1);
      expect(queryService.findPersonTestResults).toHaveBeenCalledTimes(1);
    });
  });

  describe('findTestResults', () => {
    it('should delegate to query service with options', async () => {
      const mockResults = [
        {
          id: 1, group: 'A', login: 'user1', code: 'code1'
        }
      ];
      const options = { page: 1, limit: 10, searchText: 'test' };

      queryService.findTestResults.mockResolvedValue([mockResults, 1]);

      const result = await facade.findTestResults(1, options);

      expect(result).toEqual([mockResults, 1]);
      expect(queryService.findTestResults).toHaveBeenCalledWith(1, options);
      expect(queryService.findTestResults).toHaveBeenCalledTimes(1);
    });
  });

  describe('findWorkspaceResponses', () => {
    it('should delegate to query service with pagination', async () => {
      const mockResponses = [{ id: 1 }, { id: 2 }];
      const options = { page: 1, limit: 10 };

      queryService.findWorkspaceResponses.mockResolvedValue([
        mockResponses,
        2
      ]);

      const result = await facade.findWorkspaceResponses(1, options);

      expect(result).toEqual([mockResponses, 2]);
      expect(queryService.findWorkspaceResponses).toHaveBeenCalledWith(
        1,
        options
      );
    });

    it('should delegate to query service without pagination', async () => {
      const mockResponses = [{ id: 1 }];

      queryService.findWorkspaceResponses.mockResolvedValue([mockResponses, 1]);

      const result = await facade.findWorkspaceResponses(1);

      expect(result).toEqual([mockResponses, 1]);
      expect(queryService.findWorkspaceResponses).toHaveBeenCalledWith(1);
    });
  });

  describe('resolveDuplicateResponses', () => {
    it('should delegate to duplicate service', async () => {
      const resolutionMap = { key1: 100 };
      const mockResult = { resolvedCount: 2, success: true };

      duplicateService.resolveDuplicateResponses.mockResolvedValue(mockResult);

      const result = await facade.resolveDuplicateResponses(
        1,
        resolutionMap,
        'user123'
      );

      expect(result).toEqual(mockResult);
      expect(duplicateService.resolveDuplicateResponses).toHaveBeenCalledWith(
        1,
        resolutionMap,
        'user123'
      );
      expect(duplicateService.resolveDuplicateResponses).toHaveBeenCalledTimes(
        1
      );
    });
  });

  describe('service coordination', () => {
    it('should only call the appropriate service for each method', async () => {
      overviewService.getWorkspaceTestResultsOverview.mockResolvedValue({
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      });
      queryService.findPersonTestResults.mockResolvedValue([]);
      queryService.findTestResults.mockResolvedValue([[], 0]);
      queryService.findWorkspaceResponses.mockResolvedValue([[], 0]);
      duplicateService.resolveDuplicateResponses.mockResolvedValue({
        resolvedCount: 0,
        success: true
      });

      // Call overview method
      await facade.getWorkspaceTestResultsOverview(1);
      expect(overviewService.getWorkspaceTestResultsOverview).toHaveBeenCalled();
      expect(queryService.findPersonTestResults).not.toHaveBeenCalled();
      expect(duplicateService.resolveDuplicateResponses).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // Call query method
      await facade.findPersonTestResults(1, 1);
      expect(queryService.findPersonTestResults).toHaveBeenCalled();
      expect(overviewService.getWorkspaceTestResultsOverview).not.toHaveBeenCalled();
      expect(duplicateService.resolveDuplicateResponses).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // Call duplicate method
      await facade.resolveDuplicateResponses(1, {}, 'user');
      expect(duplicateService.resolveDuplicateResponses).toHaveBeenCalled();
      expect(overviewService.getWorkspaceTestResultsOverview).not.toHaveBeenCalled();
      expect(queryService.findPersonTestResults).not.toHaveBeenCalled();
    });
  });
});
