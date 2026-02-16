import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { of, throwError } from 'rxjs';
import { TestGroupsInfoDto } from '@coding-box-lib/api-dto/files/test-groups-info.dto';
import { ImportOptionsDto } from '@coding-box-lib/api-dto/files/import-options.dto';
import { TestcenterService } from './testcenter.service';
import { PersonService } from './person.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { Person, Response, Log } from '../shared';

describe('TestCenterService', () => {
  let service: TestcenterService;
  let httpService: { put: jest.Mock; axiosRef: { get: jest.Mock } };
  let personService: DeepMocked<PersonService>;

  beforeEach(async () => {
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
        }
      ]
    }).compile();

    service = module.get<TestcenterService>(TestcenterService);
    httpService = module.get(HttpService);
    personService = module.get(PersonService);
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
      });

      it('should handle API errors gracefully', async () => {
        httpService.axiosRef.get.mockRejectedValue(new Error('Network error'));
        const result = await service.getTestgroups(
          mockWorkspaceId,
          mockTcWorkspace,
          'demo',
          '',
          mockAuthToken
        );
        expect(result).toEqual([]);
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
      personService.processPersonBooklets.mockResolvedValue(undefined);
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
    });
  });

  describe('Log processing', () => {
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
