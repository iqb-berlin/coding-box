import { Test, TestingModule } from '@nestjs/testing';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { of, throwError } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Job } from 'bull';
import { ImportOptionsDto } from '@coding-box-lib/api-dto/files/import-options.dto';
import { UploadResultsService } from '../app/database/services/test-results/upload-results.service';
import { TestcenterService } from '../app/database/services/test-results/testcenter.service';
import { PersonService } from '../app/database/services/test-results/person.service';
import { WorkspaceFilesService } from '../app/database/services/workspace/workspace-files.service';
import { PersonQueryService } from '../app/database/services/test-results/person-query.service';
import { PersonPersistenceService } from '../app/database/services/test-results/person-persistence.service';
import { JobQueueService } from '../app/job-queue/job-queue.service';
import { FileIo } from '../app/admin/workspace/file-io.interface';
import { Person, Response, Log } from '../app/database/services/shared';

describe('Test Results Workflow - Integration', () => {
  let uploadResultsService: UploadResultsService;
  let testcenterService: TestcenterService;
  let personService: PersonService;
  let mockQueryService: DeepMocked<PersonQueryService>;
  let mockPersistenceService: DeepMocked<PersonPersistenceService>;
  let httpService: { put: jest.Mock; axiosRef: { get: jest.Mock } };
  let workspaceFilesService: DeepMocked<WorkspaceFilesService>;

  beforeEach(async () => {
    mockQueryService = createMock<PersonQueryService>();
    mockPersistenceService = createMock<PersonPersistenceService>();
    workspaceFilesService = createMock<WorkspaceFilesService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadResultsService,
        TestcenterService,
        PersonService,
        {
          provide: PersonQueryService,
          useValue: mockQueryService
        },
        {
          provide: PersonPersistenceService,
          useValue: mockPersistenceService
        },
        {
          provide: JobQueueService,
          useValue: createMock<JobQueueService>()
        },
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
          provide: WorkspaceFilesService,
          useValue: workspaceFilesService
        }
      ]
    }).compile();

    uploadResultsService =
      module.get<UploadResultsService>(UploadResultsService);
    testcenterService = module.get<TestcenterService>(TestcenterService);
    personService = module.get<PersonService>(PersonService);
    httpService = module.get(HttpService);
    workspaceFilesService = module.get(WorkspaceFilesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete test results upload flow', () => {
    it('should process logs CSV upload end-to-end', async () => {
      const csvContent =
        'groupname;loginname;code;bookletname;unitname;timestamp;logentry\n' +
        'group1;login1;code1;booklet1;;2024-01-01T10:00:00Z;START:BOOKLET\n' +
        'group1;login1;code1;booklet1;unit1;2024-01-01T10:01:00Z;UNIT_START:test';
      const file = createMockFile(
        'logs.csv',
        'text/csv',
        Buffer.from(csvContent)
      );

      mockQueryService.getWorkspaceUploadStats
        .mockResolvedValueOnce({
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValueOnce({
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 0
        });

      mockPersistenceService.processPersonLogs.mockResolvedValue({
        success: true,
        totalBooklets: 1,
        totalLogsSaved: 2,
        totalLogsSkipped: 0,
        issues: []
      });

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.expected.testPersons).toBe(1);
      expect(result.expected.testGroups).toBe(1);
      expect(result.expected.uniqueBooklets).toBe(1);
      expect(result.delta.testPersons).toBe(1);
      expect(result.logMetrics).toBeDefined();
      expect(result.logMetrics?.bookletsWithLogs).toBe(1);
    });

    it('should process responses CSV upload end-to-end', async () => {
      const responses = JSON.stringify([
        {
          subForm: '',
          content: JSON.stringify([
            { id: 'r1', status: 'VALUE_CHANGED', value: 'test1' },
            { id: 'r2', status: 'CODING_COMPLETE', value: 'test2' }
          ])
        }
      ]);
      const csvContent =
        'groupname;loginname;code;bookletname;unitname;responses\n' +
        `group1;login1;code1;booklet1;unit1;"${escapeForCsv(responses)}"`;
      const file = createMockFile(
        'responses.csv',
        'text/csv',
        Buffer.from(csvContent)
      );

      mockQueryService.getWorkspaceUploadStats
        .mockResolvedValueOnce({
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValueOnce({
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 2
        });

      mockPersistenceService.processPersonBooklets.mockResolvedValue(undefined);

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses',
          overwriteExisting: true,
          personMatchMode: 'strict',
          overwriteMode: 'skip',
          scope: 'person'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.expected.testPersons).toBe(1);
      expect(result.expected.uniqueResponses).toBe(2);
      expect(result.responseStatusCounts?.VALUE_CHANGED).toBe(1);
      expect(result.responseStatusCounts?.CODING_COMPLETE).toBe(1);
    });

    it('should handle multiple files upload workflow', async () => {
      const file1 = createMockFile(
        'logs1.csv',
        'text/csv',
        Buffer.from(
          'groupname;loginname;code;bookletname;timestamp;logentry\n' +
            'group1;login1;code1;booklet1;2024-01-01T10:00:00Z;START'
        )
      );
      const file2 = createMockFile(
        'logs2.csv',
        'text/csv',
        Buffer.from(
          'groupname;loginname;code;bookletname;timestamp;logentry\n' +
            'group2;login2;code2;booklet2;2024-01-01T11:00:00Z;START'
        )
      );

      mockQueryService.getWorkspaceUploadStats
        .mockResolvedValueOnce({
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValueOnce({
          testPersons: 2,
          testGroups: 2,
          uniqueBooklets: 2,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValueOnce({
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValueOnce({
          testPersons: 2,
          testGroups: 2,
          uniqueBooklets: 2,
          uniqueUnits: 0,
          uniqueResponses: 0
        });

      mockPersistenceService.processPersonLogs.mockResolvedValue({
        success: true,
        totalBooklets: 2,
        totalLogsSaved: 2,
        totalLogsSkipped: 0,
        issues: []
      });

      // Process first file
      await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file: file1,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      // Process second file
      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file: file2,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.expected.testPersons).toBe(1);
      expect(result.expected.testGroups).toBe(1);
      expect(result.expected.uniqueBooklets).toBe(1);
    });
  });

  describe('Testcenter import with logs', () => {
    it('should authenticate and fetch test groups', async () => {
      const mockAuthResponse: AxiosResponse = {
        data: { token: 'auth-token-123', user: 'admin' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig
      };
      httpService.put.mockReturnValue(of(mockAuthResponse) as never);

      const authResult = await testcenterService.authenticate({
        username: 'admin',
        password: 'secret',
        server: 'demo',
        url: ''
      });

      expect(authResult.token).toBe('auth-token-123');

      const mockGroups = [
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
      mockQueryService.getWorkspaceGroups.mockResolvedValue([]);
      mockQueryService.getGroupsWithBookletLogs.mockResolvedValue(new Map());

      const groupsResult = await testcenterService.getTestgroups(
        '1',
        'ws-456',
        'demo',
        '',
        'auth-token-123'
      );

      expect(groupsResult).toHaveLength(1);
      expect(groupsResult[0].groupName).toBe('group1');
    });

    it('should import responses from Testcenter', async () => {
      const mockResponses: Response[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          responses: JSON.stringify([
            {
              id: 'resp1',
              content: JSON.stringify([
                { id: 'var1', value: 'test', status: 'VALID' }
              ]),
              ts: 123456,
              responseType: 'text',
              subForm: 'subform1'
            }
          ]),
          laststate: '{}'
        }
      ];

      httpService.axiosRef.get.mockResolvedValue({
        data: mockResponses
      } as AxiosResponse);
      mockQueryService.getWorkspaceGroups.mockResolvedValue([]);
      mockQueryService.getGroupsWithBookletLogs.mockResolvedValue(new Map());
      mockQueryService.getImportStatistics.mockResolvedValue({
        persons: 1,
        booklets: 1,
        units: 1
      });
      mockPersistenceService.processPersonBooklets.mockResolvedValue(undefined);

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

      const result = await testcenterService.importWorkspaceFiles(
        '1',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1'
      );

      expect(result.success).toBe(true);
      expect(result.persons).toBe(1);
      expect(result.booklets).toBe(1);
      expect(result.units).toBe(1);
    });

    it('should import logs from Testcenter', async () => {
      const mockLogs: Log[] = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '2024-01-01T00:00:00Z',
          logentry: 'START:BOOKLET'
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'unit-1-id',
          timestamp: '2024-01-01T00:01:00Z',
          logentry: 'UNIT_START:test'
        }
      ];

      httpService.axiosRef.get.mockResolvedValue({
        data: mockLogs
      } as AxiosResponse);
      mockQueryService.getWorkspaceGroups.mockResolvedValue([]);
      mockQueryService.getGroupsWithBookletLogs.mockResolvedValue(new Map());
      mockQueryService.getLogCoverageStats.mockResolvedValue({
        bookletsWithLogs: 1,
        totalBooklets: 1,
        unitsWithLogs: 1,
        totalUnits: 1
      });
      mockPersistenceService.processPersonLogs.mockResolvedValue({
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

      const result = await testcenterService.importWorkspaceFiles(
        '1',
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
      expect(result.bookletsWithLogs).toBe(1);
      expect(result.unitsWithLogs).toBe(1);
    });
  });

  describe('Person creation and booklet assignment', () => {
    it('should create persons from CSV rows and assign booklets', async () => {
      const rows = [
        {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: '[]',
          laststate: '{}'
        },
        {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          bookletname: 'booklet2',
          unitname: 'unit2',
          originalUnitId: 'orig2',
          responses: '[]',
          laststate: '{}'
        }
      ];

      const persons = await personService.createPersonList(rows, 1);
      expect(persons).toHaveLength(1);
      expect(persons[0]).toMatchObject({
        workspace_id: 1,
        group: 'group1',
        login: 'login1',
        code: 'code1'
      });

      const personWithBooklets = await personService.assignBookletsToPerson(
        persons[0],
        rows
      );
      expect(personWithBooklets.booklets).toHaveLength(2);
      expect(personWithBooklets.booklets[0].id).toBe('booklet1');
      expect(personWithBooklets.booklets[1].id).toBe('booklet2');
    });

    it('should assign units to booklets', async () => {
      const person: Person = {
        workspace_id: 1,
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

      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: JSON.stringify([
            {
              id: 'resp1',
              content: JSON.stringify([
                { id: 'var1', value: 'test', status: 'FINISHED' }
              ]),
              ts: 123456,
              responseType: 'text',
              subForm: 'subform1'
            }
          ]),
          laststate: JSON.stringify({ state: 'completed' })
        }
      ];

      const result = await personService.assignUnitsToBookletAndPerson(
        person,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(1);
      expect(result.booklets[0].units[0].id).toBe('unit1');
      expect(result.booklets[0].units[0].subforms).toHaveLength(1);
    });

    it('should assign booklet logs to person', async () => {
      const person: Person = {
        workspace_id: 1,
        group: 'group1',
        login: 'user1',
        code: 'code1',
        booklets: []
      };

      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry: 'START:BOOKLET'
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123457',
          logentry: 'FOCUS:ON'
        }
      ];

      const result = personService.assignBookletLogsToPerson(person, rows);

      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].logs).toHaveLength(2);
      expect(result.booklets[0].logs[0]).toMatchObject({
        ts: '123456',
        key: 'START',
        parameter: 'BOOKLET'
      });
    });

    it('should deduplicate persons by composite key', async () => {
      const rows = [
        { groupname: 'group1', loginname: 'login1', code: 'code1' },
        { groupname: 'group1', loginname: 'login1', code: 'code1' },
        { groupname: 'group2', loginname: 'login2', code: 'code2' }
      ];

      const persons = await personService.createPersonList(rows, 1);

      expect(persons).toHaveLength(2);
      expect(persons[1].group).toBe('group2');
    });
  });

  describe('Error handling and rollback', () => {
    it('should track stats before and after for rollback verification', async () => {
      const file = createMockFile(
        'test.csv',
        'text/csv',
        Buffer.from(
          'groupname;loginname;code;bookletname\ngroup1;login1;code1;booklet1'
        )
      );

      mockQueryService.getWorkspaceUploadStats
        .mockResolvedValueOnce({
          testPersons: 10,
          testGroups: 2,
          uniqueBooklets: 5,
          uniqueUnits: 20,
          uniqueResponses: 100
        })
        .mockResolvedValueOnce({
          testPersons: 11,
          testGroups: 3,
          uniqueBooklets: 6,
          uniqueUnits: 21,
          uniqueResponses: 100
        });

      mockPersistenceService.processPersonBooklets.mockResolvedValue(undefined);

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.before.testPersons).toBe(10);
      expect(result.after.testPersons).toBe(11);
      expect(result.delta.testPersons).toBe(1);
    });

    it('should handle persistence failure gracefully', async () => {
      const file = createMockFile(
        'test.csv',
        'text/csv',
        Buffer.from('groupname;loginname;code\ngroup1;login1;code1')
      );

      mockQueryService.getWorkspaceUploadStats.mockResolvedValue({
        testPersons: 5,
        testGroups: 1,
        uniqueBooklets: 2,
        uniqueUnits: 10,
        uniqueResponses: 50
      });

      mockPersistenceService.processPersonLogs.mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.issues).toBeDefined();
      expect(result.issues[0].message).toContain('Database connection failed');
    });

    it('should report errors for malformed CSV data', async () => {
      const file = createMockFile(
        'test.csv',
        'text/csv',
        Buffer.from(
          'groupname;loginname;code;bookletname;unitname;responses\n"unclosed'
        )
      );

      mockQueryService.getWorkspaceUploadStats.mockResolvedValue({
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0
      });

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(result.issues).toBeDefined();
      expect(result.issues[0].message).toContain('Parse Error');
    });

    it('should handle Testcenter authentication failure', async () => {
      httpService.put.mockReturnValue(
        throwError(() => new Error('Invalid credentials')) as never
      );

      await expect(
        testcenterService.authenticate({
          username: 'admin',
          password: 'wrong',
          server: 'demo',
          url: ''
        })
      ).rejects.toThrow('Authentication error');
    });

    it('should handle Testcenter import failure gracefully', async () => {
      httpService.axiosRef.get.mockRejectedValue(new Error('Network error'));
      mockQueryService.getWorkspaceGroups.mockResolvedValue([]);
      mockQueryService.getGroupsWithBookletLogs.mockResolvedValue(new Map());

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

      const result = await testcenterService.importWorkspaceFiles(
        '1',
        'ws-456',
        'demo',
        '',
        'token',
        importOptions,
        'group1'
      );

      expect(result.success).toBe(false);
      expect(result.persons).toBe(0);
      expect(result.booklets).toBe(0);
      expect(result.units).toBe(0);
    });

    it('should return warnings for missing required fields', async () => {
      const csvContent =
        'groupname;loginname;code;bookletname;timestamp;logentry\n' +
        ';;;booklet1;2024-01-01T10:00:00Z;START';
      const file = createMockFile(
        'test.csv',
        'text/csv',
        Buffer.from(csvContent)
      );

      mockQueryService.getWorkspaceUploadStats
        .mockResolvedValueOnce({
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        })
        .mockResolvedValue({
          testPersons: 1,
          testGroups: 0,
          uniqueBooklets: 1,
          uniqueUnits: 0,
          uniqueResponses: 0
        });

      mockPersistenceService.processPersonLogs.mockResolvedValue({
        success: true,
        totalBooklets: 1,
        totalLogsSaved: 0,
        totalLogsSkipped: 0,
        issues: []
      });

      const result = await uploadResultsService.processUpload({
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs',
          overwriteExisting: true,
          personMatchMode: 'strict'
        },
        progress: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job);

      expect(
        result.issues?.some(
          i => i.message === 'Missing group/login/code in row'
        )
      ).toBe(true);
    });
  });
});

function createMockFile(
  originalname: string,
  mimetype: string = 'text/csv',
  buffer: Buffer = Buffer.from('')
): FileIo {
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `test-${Date.now()}-${originalname}`);
  fs.writeFileSync(tempPath, buffer);
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
    path: tempPath
  };
}

function escapeForCsv(json: string): string {
  return json.replace(/"/g, '""');
}
