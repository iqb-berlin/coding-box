import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { UploadResultsService } from './upload-results.service';
import { PersonService } from './person.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';

describe('UploadResultsService', () => {
  let service: UploadResultsService;
  let personService: PersonService;

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
        }
      ]
    }).compile();

    service = module.get<UploadResultsService>(UploadResultsService);
    personService = module.get<PersonService>(PersonService);
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

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8'
      };

      // Act
      const result = await service.uploadTestResults(1, [file], 'logs');

      // Assert
      expect(result.expected.uniqueUnits).toBe(1);
    });

    it('should ignore originalUnitId when counting expected unique units for responses', async () => {
      // Arrange
      const fileContent = `groupname;loginname;code;bookletname;unitname;originalUnitId;responses;laststate
test-group;test-user;code;booklet1;unit1;id1;[];""
test-group;test-user;code;booklet1;unit1;id2;[];""`;

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8'
      };

      // Act
      const result = await service.uploadTestResults(1, [file], 'responses');

      // Assert
      expect(result.expected.uniqueUnits).toBe(1);
    });

    it('should report invalid statuses as INVALID and add an issue', async () => {
      // Arrange
      // response content: [{"id":"var1","status":"UNKNOWN"}]
      // chunk content: [{"content":"[{\"id\":\"var1\",\"status\":\"UNKNOWN\"}]"}]
      const fileContent = `groupname;loginname;code;bookletname;unitname;responses;laststate
test-group;test-user;code;booklet1;unit1;"[{""content"":""[{\\""id\\"":\\""var1\\"",\\""status\\"":\\""UNKNOWN\\""}]""}]";""`;

      const file: FileIo = {
        buffer: Buffer.from(fileContent),
        originalname: 'test.csv',
        mimetype: 'text/csv',
        size: fileContent.length,
        fieldname: 'file',
        encoding: 'utf-8'
      };

      // Act
      const result = await service.uploadTestResults(1, [file], 'responses');

      // Assert
      expect(result.responseStatusCounts?.INVALID).toBe(1);
      expect(result.responseStatusCounts?.UNKNOWN).toBeUndefined();
      expect(result.issues?.some(i => i.category === 'invalid_status')).toBe(true);
    });
  });
});
