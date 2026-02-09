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

describe('UploadResultsService', () => {
  let service: UploadResultsService;

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
            processPersonLogs: jest.fn().mockResolvedValue({
              issues: []
            })
          })
        },
        {
          provide: JobQueueService,
          useValue: createMock<JobQueueService>()
        }
      ]
    }).compile();

    service = module.get<UploadResultsService>(UploadResultsService);
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
  });
});
