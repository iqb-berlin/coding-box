import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { createMock } from '@golevelup/ts-jest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { UploadResultsService } from './upload-results.service';
import { PersonService } from './person.service';
import { JobQueueService, TestResultsUploadJobData } from '../../../job-queue/job-queue.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingAnalysisService } from '../coding/coding-analysis.service';

describe('UploadResultsService', () => {
  let service: UploadResultsService;
  let personService: PersonService;
  let workspaceTestResultsService: WorkspaceTestResultsService;
  let codingFreshnessService: CodingFreshnessService;
  let codingAnalysisService: CodingAnalysisService;

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
            invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined),
            invalidateCodingStatisticsCache: jest.fn().mockResolvedValue(undefined)
          })
        },
        {
          provide: CodingFreshnessService,
          useValue: createMock<CodingFreshnessService>({
            markUnitsPendingAfterImport: jest.fn().mockResolvedValue(undefined),
            markUnitsStaleAfterResultChange: jest.fn().mockResolvedValue(undefined)
          })
        },
        {
          provide: CodingAnalysisService,
          useValue: createMock<CodingAnalysisService>({
            invalidateCache: jest.fn().mockResolvedValue(undefined)
          })
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn().mockResolvedValue(undefined),
              query: jest.fn().mockResolvedValue([]),
              release: jest.fn().mockResolvedValue(undefined)
            })
          }
        }
      ]
    }).compile();

    service = module.get<UploadResultsService>(UploadResultsService);
    personService = module.get<PersonService>(PersonService);
    workspaceTestResultsService = module.get<WorkspaceTestResultsService>(
      WorkspaceTestResultsService
    );
    codingFreshnessService = module.get<CodingFreshnessService>(CodingFreshnessService);
    codingAnalysisService = module.get<CodingAnalysisService>(CodingAnalysisService);
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
;test-user;code1;booklet1;unit1;id1;0;KEY=VALUE
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
        expect.objectContaining({ category: 'timestamp', rowIndex: 1 }),
        expect.objectContaining({
          category: 'timestamp',
          message: expect.stringContaining('1 log entry has timestamp 0')
        }),
        expect.objectContaining({ category: 'missing_booklet', rowIndex: 1 }),
        expect.objectContaining({ category: 'log_format', rowIndex: 2 }),
        expect.objectContaining({ category: 'missing_booklet_log', rowIndex: 0 })
      ]));
    });

    it('should not warn about missing code when group and login identify the imported person', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;timestamp;logentry
test-group;test-user;;booklet1;;id1;123456789;KEY=VALUE`;

      const filePath = path.join(os.tmpdir(), 'test-empty-code-log.csv');
      fs.writeFileSync(filePath, fileContent);

      jest.spyOn(personService, 'processPersonLogs').mockResolvedValue({
        success: true,
        totalBooklets: 1,
        totalLogsSaved: 1,
        totalLogsSkipped: 0,
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

      expect(result.issues || []).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ category: 'missing_identity' })
      ]));
      expect(result.importSummary?.issueCounts?.missing_identity).toBeUndefined();
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

    it('should merge a new person into an existing test group and report the follow-up state', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
existing-group;new-login;new-code;booklet1;unit1;"[{""subForm"":"""",""content"":""[{\\""id\\"":\\""VAR_1\\"",\\""status\\"":\\""VALUE_CHANGED\\""}]""}]";""`;

      const filePath = path.join(os.tmpdir(), 'test-merge-new-person-existing-group.csv');
      fs.writeFileSync(filePath, fileContent);

      jest.spyOn(personService, 'getWorkspaceUploadStats')
        .mockResolvedValueOnce({
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 1
        })
        .mockResolvedValueOnce({
          testPersons: 2,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 2,
          uniqueResponses: 2
        });

      const newPerson = {
        workspace_id: 1,
        group: 'existing-group',
        login: 'new-login',
        code: 'new-code',
        booklets: []
      };
      const newPersonWithBooklets = {
        ...newPerson,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      const newPersonWithUnits = {
        ...newPersonWithBooklets,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            sessions: [],
            units: [
              {
                id: 'unit1',
                alias: 'unit1',
                laststate: [],
                chunks: [],
                subforms: [],
                logs: []
              }
            ]
          }
        ]
      };

      jest.spyOn(personService, 'createPersonList').mockResolvedValue([newPerson]);
      jest.spyOn(personService, 'assignBookletsToPerson').mockResolvedValue(newPersonWithBooklets);
      jest.spyOn(personService, 'assignUnitsToBookletAndPerson').mockResolvedValue(newPersonWithUnits);
      jest.spyOn(personService, 'processPersonBooklets').mockResolvedValue({
        addedUnitIds: [101],
        changedUnitIds: [],
        addedResponseCount: 1,
        changedResponseCount: 0
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
          resultType: 'responses',
          overwriteMode: 'merge',
          scope: 'person'
        }
      }));

      expect(personService.processPersonBooklets).toHaveBeenCalledWith(
        [newPersonWithUnits],
        1,
        'merge',
        'person'
      );
      expect(result.expected).toMatchObject({
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 1,
        uniqueResponses: 1
      });
      expect(result.delta).toEqual({
        testPersons: 1,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 1,
        uniqueResponses: 1
      });
      expect(codingFreshnessService.markUnitsPendingAfterImport).toHaveBeenCalledWith(1, [101], 1);
      expect(codingFreshnessService.markUnitsStaleAfterResultChange).toHaveBeenCalledWith(
        1,
        [],
        'RESULT_UPDATED'
      );
      expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(1);
      expect(workspaceTestResultsService.invalidateCodingStatisticsCache).toHaveBeenCalledWith(1);
      expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
    });

    it('should mark freshness and invalidate response-analysis and coding-statistics caches after importing responses', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
test-group;test-user;code;booklet1;unit1;[];""`;

      const filePath = path.join(os.tmpdir(), 'test-response-cache-invalidation.csv');
      fs.writeFileSync(filePath, fileContent);

      const person = {
        workspace_id: 1,
        group: 'test-group',
        login: 'test-user',
        code: 'code',
        booklets: []
      };
      const personWithBooklets = {
        ...person,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      const personWithUnits = {
        ...personWithBooklets,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            sessions: [],
            units: [
              {
                id: 'unit1',
                alias: 'unit1',
                laststate: [],
                chunks: [],
                subforms: [],
                logs: []
              }
            ]
          }
        ]
      };
      jest.spyOn(personService, 'createPersonList').mockResolvedValue([person]);
      jest.spyOn(personService, 'assignBookletsToPerson').mockResolvedValue(personWithBooklets);
      jest.spyOn(personService, 'assignUnitsToBookletAndPerson').mockResolvedValue(personWithUnits);
      jest.spyOn(personService, 'processPersonBooklets').mockResolvedValue({
        addedUnitIds: [101],
        changedUnitIds: [202],
        addedResponseCount: 1,
        changedResponseCount: 1
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

      await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
        id: '1',
        data: {
          workspaceId: 1,
          file,
          resultType: 'responses',
          overwriteMode: 'merge'
        }
      }));

      expect(codingFreshnessService.markUnitsPendingAfterImport).toHaveBeenCalledWith(1, [101], 1);
      expect(codingFreshnessService.markUnitsStaleAfterResultChange).toHaveBeenCalledWith(
        1,
        [202],
        'RESULT_UPDATED'
      );
      expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(1);
      expect(workspaceTestResultsService.invalidateCodingStatisticsCache).toHaveBeenCalledWith(1);
      expect(workspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
    });

    it('should invalidate response-analysis and coding-statistics caches after a post-write freshness failure', async () => {
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
test-group;test-user;code;booklet1;unit1;[];""`;

      const filePath = path.join(os.tmpdir(), 'test-response-cache-invalidation-after-error.csv');
      fs.writeFileSync(filePath, fileContent);

      const person = {
        workspace_id: 1,
        group: 'test-group',
        login: 'test-user',
        code: 'code',
        booklets: []
      };
      const personWithBooklets = {
        ...person,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      const personWithUnits = {
        ...personWithBooklets,
        booklets: [
          {
            id: 'booklet1',
            logs: [],
            sessions: [],
            units: [
              {
                id: 'unit1',
                alias: 'unit1',
                laststate: [],
                chunks: [],
                subforms: [],
                logs: []
              }
            ]
          }
        ]
      };
      jest.spyOn(personService, 'createPersonList').mockResolvedValue([person]);
      jest.spyOn(personService, 'assignBookletsToPerson').mockResolvedValue(personWithBooklets);
      jest.spyOn(personService, 'assignUnitsToBookletAndPerson').mockResolvedValue(personWithUnits);
      jest.spyOn(personService, 'processPersonBooklets').mockResolvedValue({
        addedUnitIds: [101],
        changedUnitIds: [],
        addedResponseCount: 1,
        changedResponseCount: 0
      });
      jest.spyOn(codingFreshnessService, 'markUnitsPendingAfterImport')
        .mockRejectedValueOnce(new Error('freshness failed'));

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
          resultType: 'responses',
          overwriteMode: 'merge'
        }
      }));

      expect(codingFreshnessService.markUnitsPendingAfterImport).toHaveBeenCalledWith(1, [101], 1);
      expect(codingAnalysisService.invalidateCache).toHaveBeenCalledWith(1);
      expect(workspaceTestResultsService.invalidateCodingStatisticsCache).toHaveBeenCalledWith(1);
      expect(result.issues?.some(issue => issue.message.includes('freshness failed'))).toBe(true);
    });
  });
});
