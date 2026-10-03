import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { DataSource, Repository } from 'typeorm';
import { of, throwError } from 'rxjs';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { ImportOptionsDto } from '../../../../../../../api-dto/files/import-options.dto';
import { TestcenterService } from './testcenter.service';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { Person, Response, Log } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingAnalysisService } from '../coding/coding-analysis.service';
import { TestcenterImportRun } from '../../entities/testcenter-import-run.entity';

describe('TestCenterService', () => {
  let service: TestcenterService;
  let httpService: { put: jest.Mock; axiosRef: { get: jest.Mock } };
  let personService: DeepMocked<PersonService>;
  let workspaceFilesService: DeepMocked<WorkspaceFilesService>;
  let cacheService: DeepMocked<CacheService>;
  let workspaceTestResultsService: DeepMocked<WorkspaceTestResultsService>;
  let codingFreshnessService: DeepMocked<CodingFreshnessService>;
  let codingAnalysisService: DeepMocked<CodingAnalysisService>;
  let connection: DataSource;
  let importRunRepository: DeepMocked<Repository<TestcenterImportRun>>;

  beforeEach(async () => {
    const runs = new Map<string, TestcenterImportRun>();
    const runKey = (run: { workspace_id?: number; import_run_id?: string }) => `${run.workspace_id}:${run.import_run_id}`;
    importRunRepository = createMock<Repository<TestcenterImportRun>>({
      findOneBy: jest.fn().mockImplementation(async key => structuredClone(runs.get(runKey(key)) || null)),
      insert: jest.fn().mockImplementation(async run => {
        if (runs.has(runKey(run))) throw new Error('Duplicate run');
        runs.set(runKey(run), structuredClone(run));
        return { identifiers: [], generatedMaps: [], raw: [] };
      }),
      update: jest.fn().mockImplementation(async (key, patch) => {
        const previous = runs.get(runKey(key));
        if (!previous) return { affected: 0, generatedMaps: [], raw: [] };
        runs.set(runKey(key), structuredClone({ ...previous, ...patch }));
        return { affected: 1, generatedMaps: [], raw: [] };
      })
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestcenterService,
        {
          provide: HttpService,
          useValue: {
            put: jest.fn(),
            axiosRef: {
              get: jest.fn()
            }
          }
        },
        {
          provide: PersonService,
          useValue: createMock<PersonService>()
        },
        {
          provide: WorkspaceFilesService,
          useValue: createMock<WorkspaceFilesService>()
        },
        {
          provide: CacheService,
          useValue: createMock<CacheService>({
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(true)
          })
        },
        {
          provide: WorkspaceTestResultsService,
          useValue: createMock<WorkspaceTestResultsService>({
            invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined),
            invalidateCodingStatisticsCache: jest.fn().mockResolvedValue(undefined),
            invalidateCodingAvailabilityCache: jest.fn().mockResolvedValue(undefined)
          })
        },
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn().mockReturnValue(importRunRepository),
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn().mockResolvedValue(undefined),
              query: jest.fn().mockResolvedValue([{ locked: true }]),
              release: jest.fn().mockResolvedValue(undefined)
            })
          }
        },
        {
          provide: CodingFreshnessService,
          useValue: createMock<CodingFreshnessService>({
            markUnitsPendingAfterImport: jest.fn().mockResolvedValue(undefined),
            markResponsesPendingAfterImport: jest.fn().mockResolvedValue(undefined),
            markUnitsStaleAfterResultChange: jest.fn().mockResolvedValue(undefined),
            getSummary: jest.fn().mockResolvedValue({
              workspaceId: 123,
              currentRevision: 1,
              items: []
            })
          })
        },
        {
          provide: CodingAnalysisService,
          useValue: createMock<CodingAnalysisService>({
            invalidateCache: jest.fn().mockResolvedValue(undefined)
          })
        }
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
    httpService = module.get(HttpService);
    personService = module.get(PersonService);
    workspaceFilesService = module.get(WorkspaceFilesService);
    cacheService = module.get(CacheService);
    workspaceTestResultsService = module.get(WorkspaceTestResultsService);
    codingFreshnessService = module.get(CodingFreshnessService);
    codingAnalysisService = module.get(CodingAnalysisService);
    connection = module.get(DataSource);
    personService.filterLogRowsForPerson.mockImplementation((rows, person) => (
      (rows || []).filter(row => row.groupname === person.group &&
        row.loginname === person.login &&
        row.code === person.code)
    ));
    personService.getLogCoverageStats.mockResolvedValue({
      bookletsWithLogs: 0,
      totalBooklets: 0,
      unitsWithLogs: 0,
      totalUnits: 0,
      bookletDetails: [],
      unitDetails: []
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Testcenter data import', () => {
    describe('authenticate', () => {
      const mockCredentials = {
        username: 'admin',
        password: 'secret',
        server: 'demo',
        url: ''
      };

      it('should authenticate successfully with server name', async () => {
        const mockResponse: AxiosResponse = {
          data: { token: 'auth-token-123', user: 'admin' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as InternalAxiosRequestConfig
        };
        httpService.put.mockReturnValue(of(mockResponse) as never);

        const result = await service.authenticate(mockCredentials);

        expect(result).toEqual(mockResponse.data);
      });

      it('should authenticate successfully with custom URL', async () => {
        const credentialsWithUrl = {
          ...mockCredentials,
          url: 'https://custom.testcenter.de',
          server: ''
        };
        const mockResponse: AxiosResponse = {
          data: { token: 'auth-token-456' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as InternalAxiosRequestConfig
        };
        httpService.put.mockReturnValue(of(mockResponse) as never);

        const result = await service.authenticate(credentialsWithUrl);

        expect(result).toEqual(mockResponse.data);
      });

      it('should throw error on authentication failure', async () => {
        httpService.put.mockReturnValue(
          throwError(() => new Error('Invalid credentials')) as never
        );

        await expect(service.authenticate(mockCredentials)).rejects.toThrow(
          'Authentication error'
        );
      });
    });

    describe('getTestgroups', () => {
      const mockAuthToken = 'test-token';
      const mockWorkspaceId = '123';
      const mockTcWorkspace = 'ws-456';

      it('should fetch test groups successfully', async () => {
        const mockGroups: TestGroupsInfoDto[] = [
          {
            groupName: 'group1',
            groupLabel: 'Group 1',
            bookletsStarted: 10,
            numUnitsMin: 5,
            numUnitsMax: 10,
            numUnitsTotal: 50,
            numUnitsAvg: 7.5,
            lastChange: Date.now()
          }
        ];

        httpService.axiosRef.get.mockResolvedValue({
          data: mockGroups
        } as AxiosResponse);
        personService.getWorkspaceGroups.mockResolvedValue([]);
        personService.getGroupsWithBookletLogs.mockResolvedValue(new Map());

        const result = await service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken
        );

        expect(result).toHaveLength(1);
        expect(result[0].groupName).toBe('group1');
        expect(result[0].existsInDatabase).toBe(false);
        expect(personService.getGroupsWithBookletLogs)
          .toHaveBeenCalledWith(123, []);
      });

      it('should mark groups as existing in database', async () => {
        const mockGroups: TestGroupsInfoDto[] = [
          {
            groupName: 'existing-group',
            groupLabel: 'Existing Group',
            bookletsStarted: 5,
            numUnitsMin: 3,
            numUnitsMax: 8,
            numUnitsTotal: 25,
            numUnitsAvg: 5.5,
            lastChange: Date.now()
          }
        ];

        httpService.axiosRef.get.mockResolvedValue({
          data: mockGroups
        } as AxiosResponse);
        personService.getWorkspaceGroups.mockResolvedValue(['existing-group']);
        personService.getGroupsWithBookletLogs.mockResolvedValue(new Map());

        const result = await service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken
        );

        expect(result[0].existsInDatabase).toBe(true);
        expect(personService.getGroupsWithBookletLogs)
          .toHaveBeenCalledWith(123, ['existing-group']);
      });

      it('should record progress while fetching and preparing test groups', async () => {
        const mockGroups: TestGroupsInfoDto[] = [
          {
            groupName: 'existing-group',
            groupLabel: 'Existing Group',
            bookletsStarted: 5,
            numUnitsMin: 3,
            numUnitsMax: 8,
            numUnitsTotal: 25,
            numUnitsAvg: 5.5,
            lastChange: Date.now()
          }
        ];

        httpService.axiosRef.get.mockResolvedValue({
          data: mockGroups
        } as AxiosResponse);
        personService.getWorkspaceGroups.mockResolvedValue(['existing-group']);
        personService.getGroupsWithBookletLogs.mockResolvedValue(
          new Map([['existing-group', true]])
        );

        const result = await service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken,
          'run-1'
        );

        expect(result[0]).toEqual(expect.objectContaining({
          existsInDatabase: true,
          hasBookletLogs: true
        }));
        expect(cacheService.set).toHaveBeenCalledWith(
          'testcenter_test_groups_progress:123:run-1',
          expect.objectContaining({
            importRunId: 'run-1',
            status: 'completed',
            totalGroups: 1,
            processedGroups: 1
          }),
          3600
        );
      });

      it('should surface API errors when fetching test groups fails', async () => {
        httpService.axiosRef.get.mockRejectedValue(new Error('Network error'));
        await expect(service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken
        )).rejects.toThrow('Failed to retrieve test groups from Testcenter');
      });

      it('should reject malformed test group responses', async () => {
        httpService.axiosRef.get.mockResolvedValue({
          data: { groups: [] }
        } as AxiosResponse);

        await expect(service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken
        )).rejects.toThrow('Unexpected Testcenter response');
      });
    });

    describe('importWorkspaceFiles', () => {
      it('should forward test file upload issues from Testcenter imports', async () => {
        const codingFreshnessIssue = {
          level: 'warning' as const,
          category: 'coding_freshness' as const,
          message: 'Kodierstand konnte nicht aktualisiert werden.'
        };
        const testcenterFile = {
          name: 'definition.voud',
          size: 123,
          modificationTime: Date.now(),
          type: 'Resource',
          id: 'file-1',
          report: [],
          info: {
            label: 'Definition',
            description: ''
          },
          data: ''
        };
        httpService.axiosRef.get
          .mockResolvedValueOnce({
            data: {
              Booklet: [],
              Resource: [testcenterFile],
              Unit: [],
              Testtakers: []
            }
          } as AxiosResponse)
          .mockResolvedValueOnce({ data: testcenterFile } as AxiosResponse);
        workspaceFilesService.testCenterImport.mockResolvedValue({
          total: 1,
          uploaded: 1,
          failed: 0,
          uploadedFiles: [{
            fileId: 'file-1',
            filename: 'definition.voud',
            fileType: 'Resource'
          }],
          failedFiles: [],
          conflicts: [],
          issues: [codingFreshnessIssue]
        });

        const result = await service.importWorkspaceFiles(
          '123',
          'ws-456',
          'demo',
          '',
          'test-token',
          {
            responses: 'false',
            logs: 'false',
            definitions: 'true',
            units: 'false',
            player: 'false',
            codings: 'false',
            testTakers: 'false',
            booklets: 'false',
            metadata: 'false'
          },
          'group1'
        );

        expect(result.testFilesUploadResult?.issues).toEqual([
          codingFreshnessIssue
        ]);
        expect(result.issues).toEqual([codingFreshnessIssue]);
      });
    });
  });

  describe('Booklet/unit creation', () => {
    const mockImportOptions: ImportOptionsDto = {
      responses: 'true',
      logs: 'false',
      definitions: 'false',
      units: 'false',
      player: 'false',
      codings: 'false',
      testTakers: 'false',
      booklets: 'false',
      metadata: 'false'
    };

    describe('recoverable run status', () => {
      beforeEach(() => {
        const cache = new Map<string, unknown>();
        cacheService.get.mockImplementation(async key => cache.get(key) as never || null);
        cacheService.set.mockImplementation(async (key, value) => { cache.set(key, structuredClone(value)); return true; });
        httpService.axiosRef.get.mockResolvedValue({ data: [] });
        personService.createPersonList.mockResolvedValue([]);
        personService.getImportStatistics.mockResolvedValue({ persons: 0, booklets: 0, units: 0 });
        personService.processPersonLogs.mockResolvedValue({
          success: true, totalBooklets: 0, totalLogsSaved: 0, totalLogsSkipped: 0
        });
      });

      it('stores the terminal result and returns it without reimporting the same run', async () => {
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-1');
        const progress = await service.getImportWorkspaceFilesProgress('123', 'run-1');
        expect(progress).toMatchObject({
          status: 'completed', currentGroup: 'g1', result, totalUploaded: 1
        });
        expect(progress.startedAt).toEqual(expect.any(Number));
        expect(result.completedSteps).toEqual(['responses']);
        expect(httpService.axiosRef.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 120000 }));
        const recovered = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-1');
        expect(recovered).toEqual(result);
        expect(httpService.axiosRef.get).toHaveBeenCalledTimes(1);
      });

      it('preserves completed responses when the log persistence reports failure', async () => {
        personService.processPersonLogs.mockResolvedValue({
          success: false, totalBooklets: 1, totalLogsSaved: 0, totalLogsSkipped: 0
        });
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', { ...mockImportOptions, logs: 'true' }, 'g1', true, undefined, 'run-2');
        expect(result.success).toBe(false);
        expect(result.completedSteps).toEqual(['responses']);
        expect(result.importedGroups).toEqual([]);
        expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'error', message: expect.stringContaining('Logs') })]));
        expect(await service.getImportWorkspaceFilesProgress('123', 'run-2')).toMatchObject({ status: 'failed', phase: 'saving-logs', result });
        expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(123);
      });

      it('keeps full log coverage details in the HTTP result but not in the reconnect cache', async () => {
        personService.getLogCoverageStats.mockResolvedValue({
          bookletsWithLogs: 1,
          totalBooklets: 1,
          unitsWithLogs: 1,
          totalUnits: 1,
          bookletDetails: [{ name: 'B', hasLog: true }],
          unitDetails: [{ bookletName: 'B', unitKey: 'U', hasLog: true }]
        });
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', { ...mockImportOptions, responses: 'false', logs: 'true' }, 'g1', true, undefined, 'run-compact');
        const progress = await service.getImportWorkspaceFilesProgress('123', 'run-compact');
        expect(result.unitDetails).toHaveLength(1);
        expect(progress.result).toMatchObject({ success: true, unitsWithLogs: 1 });
        expect(progress.result.unitDetails).toBeUndefined();
        expect(progress.result.bookletDetails).toBeUndefined();
      });

      it('does not report success for swallowed response persistence errors', async () => {
        const person = {
          workspace_id: 123, group: 'g1', login: 'l', code: 'c', booklets: []
        };
        httpService.axiosRef.get.mockResolvedValue({ data: [{ groupname: 'g1', loginname: 'l', code: 'c' }] });
        personService.createPersonList.mockResolvedValue([person]);
        personService.assignBookletsToPerson.mockResolvedValue(person);
        personService.assignUnitsToBookletAndPerson.mockResolvedValue(person);
        personService.processPersonBooklets.mockImplementation(async (_persons, _workspace, _mode, _scope, issues) => {
          issues.push({ level: 'error', message: 'Database write failed' });
          return {
            addedUnitIds: [], changedUnitIds: [], addedResponseCount: 0, changedResponseCount: 0
          };
        });
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-3');
        expect(result.success).toBe(false);
        expect(result.completedSteps).toEqual([]);
        expect(await service.getImportWorkspaceFilesProgress('123', 'run-3')).toMatchObject({ status: 'failed', result });
      });

      it('rejects a concurrent import before fetching or saving any data', async () => {
        const queryRunner = connection.createQueryRunner();
        jest.spyOn(queryRunner, 'query').mockResolvedValueOnce([{ locked: false }]);
        await expect(service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-busy'))
          .rejects.toMatchObject({ response: { importNotStarted: true }, status: 409 });
        expect(httpService.axiosRef.get).not.toHaveBeenCalled();
        expect(cacheService.set).not.toHaveBeenCalled();
        expect(queryRunner.release).toHaveBeenCalled();
      });

      it('fails closed if the durable run cannot be registered', async () => {
        importRunRepository.insert.mockRejectedValue(new Error('Database unavailable'));
        await expect(service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-db'))
          .rejects.toMatchObject({ response: { importNotStarted: true }, status: 503 });
        expect(httpService.axiosRef.get).not.toHaveBeenCalled();
      });

      it('recovers the completed result from Postgres when the cache is unavailable', async () => {
        cacheService.set.mockResolvedValue(false);
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-cache');
        cacheService.get.mockResolvedValue(null);
        expect(await service.getImportWorkspaceFilesProgress('123', 'run-cache')).toMatchObject({ status: 'completed', result });
        const restartedService = new TestcenterService(personService, httpService as unknown as HttpService, workspaceFilesService, cacheService, workspaceTestResultsService, connection, codingFreshnessService, codingAnalysisService);
        expect(await restartedService.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-cache')).toEqual(result);
        expect(httpService.axiosRef.get).toHaveBeenCalledTimes(1);
      });

      it('prefers a durable terminal result over stale running progress in the cache', async () => {
        const cacheSet = cacheService.set.getMockImplementation();
        cacheService.set.mockImplementation(async (key, value, ttl) => (
          (value as { status: string }).status === 'running' ? cacheSet(key, value, ttl) : false
        ));
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-stale');
        expect((await cacheService.get('testcenter_import_progress:123:run-stale') as { status: string }).status).toBe('running');
        expect(await service.getImportWorkspaceFilesProgress('123', 'run-stale')).toMatchObject({ status: 'completed', result });
        await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-stale');
        expect(httpService.axiosRef.get).toHaveBeenCalledTimes(1);
      });

      it('retries a transient terminal write without replaying data persistence', async () => {
        const update = importRunRepository.update.getMockImplementation();
        let failTerminal = true;
        importRunRepository.update.mockImplementation(async (key, patch) => {
          if ((patch.progress as { status: string }).status === 'completed' && failTerminal) {
            failTerminal = false;
            throw new Error('Temporary database failure');
          }
          return update(key, patch);
        });
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-retry');
        expect(result.success).toBe(true);
        expect(await service.getImportWorkspaceFilesProgress('123', 'run-retry')).toMatchObject({ status: 'completed', result });
        expect(httpService.axiosRef.get).toHaveBeenCalledTimes(1);
      });

      it('reports failed terminal storage and refuses to replay an unconfirmed run after a restart', async () => {
        const update = importRunRepository.update.getMockImplementation();
        importRunRepository.update.mockImplementation(async (key, patch) => {
          if ((patch.progress as { status: string }).status !== 'running') throw new Error('Database failure');
          return update(key, patch);
        });
        cacheService.set.mockResolvedValue(false);
        const result = await service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-unconfirmed');
        expect(result.success).toBe(true);
        expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'warning', message: expect.stringContaining('nicht dauerhaft gespeichert') })]));
        cacheService.get.mockResolvedValue(null);
        const restartedService = new TestcenterService(personService, httpService as unknown as HttpService, workspaceFilesService, cacheService, workspaceTestResultsService, connection, codingFreshnessService, codingAnalysisService);
        await expect(restartedService.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-unconfirmed'))
          .rejects.toMatchObject({ status: 409 });
        expect(httpService.axiosRef.get).toHaveBeenCalledTimes(1);
      });

      it('does not start a new run when the durable status cannot be read', async () => {
        importRunRepository.findOneBy.mockRejectedValue(new Error('Database unavailable'));
        await expect(service.importWorkspaceFiles('123', 'tc', '1', '', 'token', mockImportOptions, 'g1', true, undefined, 'run-unreadable'))
          .rejects.toThrow('Database unavailable');
        expect(httpService.axiosRef.get).not.toHaveBeenCalled();
        expect(importRunRepository.insert).not.toHaveBeenCalled();
      });
    });

    it('should import responses and create persons/booklets/units', async () => {
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          responses: '[]',
          laststate: '{}'
        }
      ];
      httpService.axiosRef.get.mockResolvedValue({
        data: mockResponses
      } as AxiosResponse);
      const mockPersons: Person[] = [
        {
          workspace_id: 123,
          group: 'group1',
          login: 'user1',
          code: 'code1',
          booklets: []
        }
      ];
      personService.createPersonList.mockResolvedValue(mockPersons);
      personService.assignBookletsToPerson.mockResolvedValue(mockPersons[0]);
      personService.assignUnitsToBookletAndPerson.mockResolvedValue(
        mockPersons[0]
      );
      personService.processPersonBooklets.mockResolvedValue({
        addedUnitIds: [10],
        changedUnitIds: [20],
        addedResponseCount: 2,
        changedResponseCount: 1
      });
      personService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 1
      });
      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        mockImportOptions,
        'group1'
      );
      expect(result.success).toBe(true);
      expect(result.persons).toBe(1);
      expect(result.booklets).toBe(1);
      expect(result.units).toBe(1);
      expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
      expect(
        workspaceTestResultsService.invalidateWorkspaceStatsCache
      ).toHaveBeenCalledWith(123);
      expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(123);
      expect(
        workspaceTestResultsService.invalidateCodingStatisticsCache
      ).toHaveBeenCalledWith(123);
      expect(
        workspaceTestResultsService.invalidateCodingAvailabilityCache
      ).toHaveBeenCalledWith(123);
      expect(
        codingFreshnessService.markUnitsPendingAfterImport
      ).toHaveBeenCalledWith(123, [10], 2);
      expect(
        codingFreshnessService.markUnitsStaleAfterResultChange
      ).toHaveBeenCalledWith(123, [20], 'RESULT_UPDATED');
      expect(codingFreshnessService.getSummary).toHaveBeenCalledWith(123);
      expect(result.codingFreshness).toEqual({
        workspaceId: 123,
        currentRevision: 1,
        items: []
      });
      expect(personService.processPersonBooklets).toHaveBeenCalledWith(
        expect.any(Array),
        123,
        'skip',
        'person',
        expect.any(Array)
      );
    });

    it('should pass the selected response overwrite mode to person processing', async () => {
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          responses: '[]',
          laststate: '{}'
        }
      ];
      const mockPersons: Person[] = [
        {
          workspace_id: 123,
          group: 'group1',
          login: 'user1',
          code: 'code1',
          booklets: []
        }
      ];

      httpService.axiosRef.get.mockResolvedValue({
        data: mockResponses
      } as AxiosResponse);
      personService.createPersonList.mockResolvedValue(mockPersons);
      personService.assignBookletsToPerson.mockResolvedValue(mockPersons[0]);
      personService.assignUnitsToBookletAndPerson.mockResolvedValue(
        mockPersons[0]
      );
      personService.processPersonBooklets.mockResolvedValue({
        addedUnitIds: [10],
        changedUnitIds: [],
        addedResponseCount: 1,
        changedResponseCount: 0
      });
      personService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 1
      });

      await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        mockImportOptions,
        'group1',
        true,
        undefined,
        undefined,
        'merge'
      );

      expect(personService.processPersonBooklets).toHaveBeenCalledWith(
        expect.any(Array),
        123,
        'merge',
        'person',
        expect.any(Array)
      );
    });

    it('should keep Testcenter response imports successful when coding cache invalidation fails', async () => {
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          responses: '[]',
          laststate: '{}'
        }
      ];
      httpService.axiosRef.get.mockResolvedValue({
        data: mockResponses
      } as AxiosResponse);
      const mockPersons: Person[] = [
        {
          workspace_id: 123,
          group: 'group1',
          login: 'user1',
          code: 'code1',
          booklets: []
        }
      ];
      personService.createPersonList.mockResolvedValue(mockPersons);
      personService.assignBookletsToPerson.mockResolvedValue(mockPersons[0]);
      personService.assignUnitsToBookletAndPerson.mockResolvedValue(
        mockPersons[0]
      );
      personService.processPersonBooklets.mockResolvedValue({
        addedUnitIds: [10],
        changedUnitIds: [],
        addedResponseCount: 1,
        changedResponseCount: 0
      });
      personService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 1
      });
      workspaceTestResultsService.invalidateCodingStatisticsCache
        .mockRejectedValueOnce(new Error('statistics cache failed'));

      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        mockImportOptions,
        'group1'
      );

      expect(result.success).toBe(true);
      expect(result.issues).toEqual([
        expect.objectContaining({
          level: 'warning',
          category: 'other',
          message: expect.stringContaining('Kodierstatistiken')
        })
      ]);
    });
  });

  describe('Log processing', () => {
    it('should wait for response import before importing logs', async () => {
      const order: string[] = [];
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          responses: '[]',
          laststate: '{}'
        }
      ];
      const mockLogs: Log[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          timestamp: '2024-01-01T00:01:00Z',
          logentry: '{}'
        }
      ];
      const responsePerson: Person = {
        workspace_id: 123,
        group: 'group1',
        login: 'user1',
        code: 'code1',
        booklets: []
      };
      const logPerson: Person = {
        workspace_id: 123,
        group: 'group1',
        login: 'user1',
        code: 'code1',
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      httpService.axiosRef.get
        .mockResolvedValueOnce({ data: mockResponses } as AxiosResponse)
        .mockResolvedValueOnce({ data: mockLogs } as AxiosResponse);
      personService.createPersonList
        .mockResolvedValueOnce([responsePerson])
        .mockResolvedValueOnce([logPerson]);
      personService.assignBookletsToPerson.mockResolvedValue(responsePerson);
      personService.assignUnitsToBookletAndPerson.mockResolvedValue(responsePerson);
      personService.processPersonBooklets.mockImplementation(async () => {
        order.push('responses-start');
        await Promise.resolve();
        order.push('responses-complete');
        return {
          addedUnitIds: [10],
          changedUnitIds: [],
          addedResponseCount: 1,
          changedResponseCount: 0
        };
      });
      personService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 1
      });
      personService.assignBookletLogsToPerson.mockReturnValue(logPerson);
      personService.assignUnitLogsToBooklet.mockReturnValue(logPerson.booklets[0]);
      personService.processPersonLogs.mockImplementation(async () => {
        order.push('logs-start');
        return {
          success: true,
          totalBooklets: 1,
          totalLogsSaved: 1,
          totalLogsSkipped: 0,
          issues: []
        };
      });
      const importOptions: ImportOptionsDto = {
        responses: 'true',
        logs: 'true',
        definitions: 'false',
        units: 'false',
        player: 'false',
        codings: 'false',
        testTakers: 'false',
        booklets: 'false',
        metadata: 'false'
      };

      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1',
        true
      );

      expect(result.success).toBe(true);
      expect(order).toEqual([
        'responses-start',
        'responses-complete',
        'logs-start'
      ]);
    });

    it('should import logs and separate by type', async () => {
      const mockLogs: Log[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '2024-01-01T00:00:00Z',
          logentry: '{}'
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          timestamp: '2024-01-01T00:01:00Z',
          logentry: '{}'
        }
      ];
      httpService.axiosRef.get.mockResolvedValue({
        data: mockLogs
      } as AxiosResponse);
      const mockPersons: Person[] = [
        {
          workspace_id: 123,
          group: 'group1',
          login: 'user1',
          code: 'code1',
          booklets: [
            {
              id: 'booklet1',
              logs: [],
              units: [],
              sessions: []
            }
          ]
        }
      ];
      personService.createPersonList.mockResolvedValue(mockPersons);
      personService.assignBookletLogsToPerson.mockReturnValue(mockPersons[0]);
      personService.assignUnitLogsToBooklet.mockReturnValue(
        mockPersons[0].booklets[0]
      );
      personService.processPersonLogs.mockResolvedValue({
        success: true,
        totalBooklets: 1,
        totalLogsSaved: 2,
        totalLogsSkipped: 0,
        issues: []
      });
      personService.getLogCoverageStats.mockResolvedValue({
        bookletsWithLogs: 1,
        totalBooklets: 1,
        unitsWithLogs: 1,
        totalUnits: 1,
        bookletDetails: [{ name: 'booklet1', hasLog: true }],
        unitDetails: [
          { bookletName: 'booklet1', unitKey: 'unit1', hasLog: true }
        ]
      });
      const importOptions: ImportOptionsDto = {
        responses: 'false',
        logs: 'true',
        definitions: 'false',
        units: 'false',
        player: 'false',
        codings: 'false',
        testTakers: 'false',
        booklets: 'false',
        metadata: 'false'
      };
      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1',
        true
      );
      expect(result.success).toBe(true);
      expect(result.logs).toBe(1);
      expect(result.bookletDetails).toEqual([{ name: 'booklet1', hasLog: true }]);
      expect(result.unitDetails).toEqual([
        { bookletName: 'booklet1', unitKey: 'unit1', hasLog: true }
      ]);
      expect(personService.assignUnitLogsToBooklet).toHaveBeenCalledWith(
        mockPersons[0].booklets[0],
        [mockLogs[1]],
        expect.any(Array),
        'Testcenter:ws-456:group1'
      );
      expect(personService.assignBookletLogsToPerson).toHaveBeenCalledWith(
        mockPersons[0],
        [mockLogs[0]],
        expect.any(Array),
        'Testcenter:ws-456:group1'
      );
      expect(
        workspaceTestResultsService.invalidateWorkspaceStatsCache
      ).toHaveBeenCalledWith(123);
    });
  });

  describe('Duplicate handling', () => {
    it('should handle duplicate persons in import', async () => {
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'b1',
          unitname: 'u1',
          originalUnitId: 'id1',
          responses: '[]',
          laststate: '{}'
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'b1',
          unitname: 'u2',
          originalUnitId: 'id2',
          responses: '[]',
          laststate: '{}'
        }
      ];
      httpService.axiosRef.get.mockResolvedValue({
        data: mockResponses
      } as AxiosResponse);
      const mockPersons: Person[] = [
        {
          workspace_id: 123,
          group: 'group1',
          login: 'user1',
          code: 'code1',
          booklets: []
        }
      ];
      personService.createPersonList.mockResolvedValue(mockPersons);
      personService.assignBookletsToPerson.mockResolvedValue(mockPersons[0]);
      personService.assignUnitsToBookletAndPerson.mockResolvedValue(
        mockPersons[0]
      );
      personService.processPersonBooklets.mockResolvedValue({
        addedUnitIds: [],
        changedUnitIds: [],
        addedResponseCount: 0,
        changedResponseCount: 0
      });
      personService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 2
      });
      const importOptions: ImportOptionsDto = {
        responses: 'true',
        logs: 'false',
        definitions: 'false',
        units: 'false',
        player: 'false',
        codings: 'false',
        testTakers: 'false',
        booklets: 'false',
        metadata: 'false'
      };
      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1'
      );
      expect(result.persons).toBe(1);
      expect(result.units).toBe(2);
      expect(codingAnalysisService.invalidateCache).not.toHaveBeenCalled();
      expect(
        workspaceTestResultsService.invalidateCodingStatisticsCache
      ).not.toHaveBeenCalled();
      expect(
        workspaceTestResultsService.invalidateCodingAvailabilityCache
      ).not.toHaveBeenCalled();
    });
  });

  describe('Workspace validation', () => {
    it('should return success when no import options are selected', async () => {
      const importOptions: ImportOptionsDto = {
        responses: 'false',
        logs: 'false',
        definitions: 'false',
        units: 'false',
        player: 'false',
        codings: 'false',
        testTakers: 'false',
        booklets: 'false',
        metadata: 'false'
      };
      const result = await service.importWorkspaceFiles(
        '123',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1'
      );
      expect(result.success).toBe(true);
      expect(result.responses).toBe(0);
      expect(result.logs).toBe(0);
    });
  });
});
