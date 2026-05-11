import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { createMock } from '@golevelup/ts-jest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UploadResultsService } from './upload-results.service';
import { PersonService } from './person.service';
import { JobQueueService, TestResultsUploadJobData } from '../../../job-queue/job-queue.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceTestResultsService } from './workspace-test-results.service';

describe('UploadResultsService', () => {
  let service: UploadResultsService;
  let personService: PersonService;
  let workspaceTestResultsService: WorkspaceTestResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadResultsService,
        {
          provide: PersonService,
          useValue: createMock<PersonService>({
            getWorkspaceUploadStats: jest.fn().mockResolvedValue({
              testPersons: 0,
              testGroups: 0,
              uniqueBooklets: 0,
              uniqueUnits: 0,
              uniqueResponses: 0
            }),
            createPersonList: jest.fn().mockResolvedValue([]),
            filterLogRowsForPerson: jest.fn((rows, person) => (rows || []).filter(row => row.groupname === person.group &&
              row.loginname === person.login &&
              row.code === person.code)),
            ensureBookletsForUnitLogs: jest.fn(person => person),
            processPersonLogs: jest.fn().mockResolvedValue({
              issues: []
            })
          })
        },
        {
          provide: JobQueueService,
          useValue: createMock<JobQueueService>()
        },
        {
          provide: WorkspaceTestResultsService,
          useValue: createMock<WorkspaceTestResultsService>({
            invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined)
          })
        }
      ]
    }).compile();

    service = module.get<UploadResultsService>(UploadResultsService);
    personService = module.get<PersonService>(PersonService);
    workspaceTestResultsService = module.get<WorkspaceTestResultsService>(
      WorkspaceTestResultsService
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadTestResults', () => {
    it('should ignore originalUnitId when counting expected unique units for logs', async () => {
      // Arrange
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
test-group;test-user;code;booklet1;unit1;id1;123456789;KEY:VALUE
test-group;test-user;code;booklet1;unit1;id2;123456789;KEY:VALUE`;

      const filePath = path.join(os.tmpdir(), 'test-logs.csv');
      fs.writeFileSync(filePath, fileContent);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      // Act
      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      // Assert
      expect(result.expected.uniqueUnits).toBe(1);
      expect(result.importSummary).toMatchObject({
        totalRows: 2,
        logRows: 2,
        unitLogRows: 2
      });
      expect(
        workspaceTestResultsService.invalidateWorkspaceStatsCache
      ).toHaveBeenCalledWith(1);
    });

    it('should report missing CSV columns before importing rows', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;timestamp
test-group;test-user;code;booklet1;unit1;123456789`;

      const filePath = path.join(os.tmpdir(), 'test-missing-log-columns.csv');
      fs.writeFileSync(filePath, fileContent);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(personService.createPersonList).not.toHaveBeenCalled();
      expect(result.issues).toEqual([
        expect.objectContaining({
          level: 'error',
          category: 'csv_columns',
          message: expect.stringContaining('logentry')
        })
      ]);
      expect(result.importSummary).toMatchObject({
        totalRows: 0,
        issueCounts: { csv_columns: 1 }
      });
    });

    it('should summarize log rows and warn about suspicious log data', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
test-group;test-user;;booklet1;unit1;id1;0;KEY=VALUE
test-group;test-user;code2;;unit2;id2;;KEY=VALUE
test-group;test-user;code3;booklet3;;id3;123456789;`;

      const filePath = path.join(os.tmpdir(), 'test-log-warnings.csv');
      fs.writeFileSync(filePath, fileContent);

      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        success: true,
        totalBooklets: 0,
        totalLogsSaved: 4,
        totalLogsSkipped: 2,
        issues: []
      });

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(result.importSummary).toMatchObject({
        totalRows: 3,
        logRows: 3,
        bookletLogRows: 1,
        unitLogRows: 2,
        savedLogs: 4,
        skippedRows: 2,
        skippedLogs: 2
      });
      expect(result.importSummary?.issueCounts).toEqual(expect.objectContaining({
        missing_identity: 1,
        missing_booklet: 1,
        timestamp: 2,
        log_format: 1,
        missing_booklet_log: 1
      }));
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: 'missing_identity', rowIndex: 0 }),
        expect.objectContaining({ category: 'timestamp', rowIndex: 0 }),
        expect.objectContaining({ category: 'missing_booklet', rowIndex: 1 }),
        expect.objectContaining({ category: 'log_format', rowIndex: 2 }),
        expect.objectContaining({ category: 'missing_booklet_log', rowIndex: 0 })
      ]));
    });

    it('should add a clear warning when log rows were read but no logs were saved', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
test-group;test-user;code;booklet1;;id1;123456789;KEY=VALUE`;

      const filePath = path.join(os.tmpdir(), 'test-no-logs-saved.csv');
      fs.writeFileSync(filePath, fileContent);

      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        success: true,
        totalBooklets: 0,
        totalLogsSaved: 0,
        totalLogsSkipped: 1,
        issues: []
      });

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          category: 'no_logs_saved',
          message: expect.stringContaining('keine Logs gespeichert')
        })
      ]));
      expect(result.importSummary).toMatchObject({
        totalRows: 1,
        logRows: 1,
        skippedLogs: 1,
        issueCounts: expect.objectContaining({
          no_logs_saved: 1
        })
      });
    });

    it('should pass only unit log rows into unit log assignment', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
test-group;test-user;code;booklet1;; ;123456788;BOOKLET : value
test-group;test-user;code;booklet1;unit1;id1;123456789;KEY=VALUE`;

      const filePath = path.join(os.tmpdir(), 'test-separated-logs.csv');
      fs.writeFileSync(filePath, fileContent);

      const booklet = {
        id: 'booklet1',
        logs: [],
        units: [],
        sessions: []
      };
      const person = {
        workspace_id: 1,
        group: 'test-group',
        login: 'test-user',
        code: 'code',
        booklets: [booklet]
      };

      jest.spyOn(personService, 'createPersonList').mockResolvedValue([person]);
      jest.spyOn(personService, 'assignBookletLogsToPerson').mockReturnValue(person);
      jest.spyOn(personService, 'assignUnitLogsToBooklet').mockReturnValue(booklet);
      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        issues: []
      } as never);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(personService.assignUnitLogsToBooklet).toHaveBeenCalledWith(
        booklet,
        [expect.objectContaining({ unitname: 'unit1', originalUnitId: 'id1' })],
        expect.any(Array),
        'test.csv'
      );
      expect(personService.assignBookletLogsToPerson).toHaveBeenCalledWith(
        person,
        [expect.objectContaining({ unitname: '' })],
        expect.any(Array),
        'test.csv'
      );
    });

    it('should pass only the current person unit logs into unit log assignment', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
group-a;login-a;code-a;booklet1;unit1;id1;111;KEY=A
group-b;login-b;code-b;booklet1;unit1;id1;222;KEY=B`;

      const filePath = path.join(os.tmpdir(), 'test-person-scoped-unit-logs.csv');
      fs.writeFileSync(filePath, fileContent);

      const bookletA = {
        id: 'booklet1',
        logs: [],
        units: [],
        sessions: []
      };
      const bookletB = {
        id: 'booklet1',
        logs: [],
        units: [],
        sessions: []
      };
      const personA = {
        workspace_id: 1,
        group: 'group-a',
        login: 'login-a',
        code: 'code-a',
        booklets: [bookletA]
      };
      const personB = {
        workspace_id: 1,
        group: 'group-b',
        login: 'login-b',
        code: 'code-b',
        booklets: [bookletB]
      };

      jest.spyOn(personService, 'createPersonList').mockResolvedValue([personA, personB]);
      jest.spyOn(personService, 'assignBookletLogsToPerson').mockImplementation(person => person);
      jest.spyOn(personService, 'assignUnitLogsToBooklet').mockImplementation(booklet => booklet);
      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        issues: []
      } as never);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(personService.assignUnitLogsToBooklet).toHaveBeenCalledTimes(2);
      expect(personService.assignUnitLogsToBooklet).toHaveBeenNthCalledWith(
        1,
        bookletA,
        [expect.objectContaining({ loginname: 'login-a', timestamp: '111' })],
        expect.any(Array),
        'test.csv'
      );
      expect(personService.assignUnitLogsToBooklet).toHaveBeenNthCalledWith(
        2,
        bookletB,
        [expect.objectContaining({ loginname: 'login-b', timestamp: '222' })],
        expect.any(Array),
        'test.csv'
      );
    });

    it('should process log CSV files once instead of persisting per 500-row batch', async () => {
      const rows = Array.from({ length: 501 }, (_, index) => (
        `test-group;test-user;code;booklet1;unit1;id1;${index + 1};PLAYER=RUNNING`
      ));
      const fileContent = [
        'groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry',
        ...rows
      ].join('\n');

      const filePath = path.join(os.tmpdir(), 'test-large-logs.csv');
      fs.writeFileSync(filePath, fileContent);

      const booklet = {
        id: 'booklet1',
        logs: [],
        units: [],
        sessions: []
      };
      const person = {
        workspace_id: 1,
        group: 'test-group',
        login: 'test-user',
        code: 'code',
        booklets: [booklet]
      };

      jest.spyOn(personService, 'createPersonList').mockResolvedValue([person]);
      jest.spyOn(personService, 'assignBookletLogsToPerson').mockReturnValue(person);
      jest.spyOn(personService, 'assignUnitLogsToBooklet').mockReturnValue(booklet);
      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        issues: []
      } as never);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(personService.processPersonLogs).toHaveBeenCalledTimes(1);
      expect(personService.assignUnitLogsToBooklet).toHaveBeenCalledWith(
        booklet,
        expect.arrayContaining([
          expect.objectContaining({ timestamp: '1' }),
          expect.objectContaining({ timestamp: '501' })
        ]),
        expect.any(Array),
        'test.csv'
      );
    });

    it('should normalize quoted log CSV fields without stripping quotes from logentry payloads', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
"test-group";"test-user";"code";"booklet1";"";"";"123456788";TESTLETS_TIMELEFT : "{""BM"":40}"`;

      const filePath = path.join(os.tmpdir(), 'test-quoted-logs.csv');
      fs.writeFileSync(filePath, fileContent);

      const person = {
        workspace_id: 1,
        group: 'test-group',
        login: 'test-user',
        code: 'code',
        booklets: []
      };

      jest.spyOn(personService, 'createPersonList').mockResolvedValue([person]);
      jest.spyOn(personService, 'assignBookletLogsToPerson').mockReturnValue(person);
      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        issues: []
      } as never);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'logs'
        }
      }));

      expect(personService.createPersonList).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            groupname: 'test-group',
            loginname: 'test-user',
            code: 'code',
            logentry: 'TESTLETS_TIMELEFT : "{""BM"":40}"'
          })
        ],
        1
      );
    });

    it('should ignore originalUnitId when counting expected unique units for responses', async () => {
      // Arrange
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;responses;laststate
test-group;test-user;code;booklet1;unit1;id1;[];""
test-group;test-user;code;booklet1;unit1;id2;[];""`;

      const filePath = path.join(os.tmpdir(), 'test-responses.csv');
      fs.writeFileSync(filePath, fileContent);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      // Act
      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses'
        }
      }));

      // Assert
      expect(result.expected.uniqueUnits).toBe(1);
    });

    it('should report invalid statuses as INVALID and add an issue', async () => {
      // Arrange
      // response content: [{"id":"var1","status":"UNKNOWN"}]
      // chunk content: [{"content":"[{\"id\":\"var1\",\"status\":\"UNKNOWN\"}]"}]
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
test-group;test-user;code;booklet1;unit1;"[{""content"":""[{\\""id\\"":\\""var1\\"",\\""status\\"":\\""UNKNOWN\\""}]""}]";""`;

      const filePath = path.join(os.tmpdir(), 'test-invalid.csv');
      fs.writeFileSync(filePath, fileContent);

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      // Act
      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses'
        }
      }));

      // Assert
      expect(result.responseStatusCounts?.INVALID).toBe(1);
      expect(result.responseStatusCounts?.UNKNOWN).toBeUndefined();
      expect(result.issues?.some(i => i.category === 'invalid_status')).toBe(true);
    });

    it('should mark the overview as pending when upload stats cannot be read', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
test-group;test-user;code;booklet1;unit1;[];""`;

      const filePath = path.join(os.tmpdir(), 'test-stats-failure.csv');
      fs.writeFileSync(filePath, fileContent);

      jest.spyOn(personService, 'getWorkspaceUploadStats').mockRejectedValue(new Error('DB Error'));

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8',
        path: filePath
      };

      const result = await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses'
        }
      }));

      expect(result.overviewPending).toBe(true);
      expect(result.overviewMessage).toContain('aggregierten Datenbankzahlen');
      expect(result.issues?.some(issue => issue.category === 'other')).toBe(true);
    });
  });
});
