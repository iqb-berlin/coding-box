import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { PersonService } from './person.service';
import { PersonQueryService } from './person-query.service';
import { PersonPersistenceService } from './person-persistence.service';
import { Response } from '../shared';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

describe('PersonService', () => {
  let service: PersonService;
  let mockQueryService: jest.Mocked<PersonQueryService>;
  let mockPersistenceService: jest.Mocked<PersonPersistenceService>;

  beforeEach(async () => {
    mockQueryService = createMock<PersonQueryService>();
    mockPersistenceService = createMock<PersonPersistenceService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonService,
        {
          provide: PersonQueryService,
          useValue: mockQueryService
        },
        {
          provide: PersonPersistenceService,
          useValue: mockPersistenceService
        }
      ]
    }).compile();

    service = module.get<PersonService>(PersonService);
  });

  describe('parseLogEntry', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parse = (log: string) => (service as any).parseLogEntry(log);

    it('should parse standard key : value format', () => {
      expect(parse('KEY : VALUE')).toEqual({ key: 'KEY', value: 'VALUE' });
    });

    it('should parse standard key=value format', () => {
      expect(parse('KEY=VALUE')).toEqual({ key: 'KEY', value: 'VALUE' });
    });

    it('should handle quoted keys', () => {
      expect(parse('"CONNECTION" : LOST')).toEqual({
        key: 'CONNECTION',
        value: 'LOST'
      });
    });

    it('should handle quoted values', () => {
      expect(parse('CONNECTION : "POLLING"')).toEqual({
        key: 'CONNECTION',
        value: 'POLLING'
      });
    });

    it('should handle complex JSON in values', () => {
      const log = 'TESTLETS_TIMELEFT : "{\\"SFB_FRZ\\":32}"';
      expect(parse(log)).toEqual({
        key: 'TESTLETS_TIMELEFT',
        value: '{"SFB_FRZ":32}'
      });
    });

    it('should handle double-escaped JSON', () => {
      const log =
        'LOADCOMPLETE : "{\\"browserVersion\\":\\"128.0\\",\\"browserName\\":\\"Firefox\\"}"';
      expect(parse(log)).toEqual({
        key: 'LOADCOMPLETE',
        value: '{"browserVersion":"128.0","browserName":"Firefox"}'
      });
    });

    it('should handle complex strings with spaces and special chars', () => {
      const log = 'command executed : "goto id S_Ende_Teil "';
      expect(parse(log)).toEqual({
        key: 'command executed',
        value: 'goto id S_Ende_Teil '
      });
    });

    it('should handle arrays in JSON', () => {
      const log =
        'TESTLETS_CLEARED_CODE : "[\\"SFB_FRZ\\",\\"post_questionnaire\\"]"';
      expect(parse(log)).toEqual({
        key: 'TESTLETS_CLEARED_CODE',
        value: '["SFB_FRZ","post_questionnaire"]'
      });
    });

    it('should handle improper spacing', () => {
      expect(parse('KEY:VALUE')).toEqual({ key: 'KEY', value: 'VALUE' });
      expect(parse('KEY = VALUE')).toEqual({ key: 'KEY', value: 'VALUE' });
    });

    it('should return null for invalid format', () => {
      expect(parse('INVALID_LOG_WITHOUT_SEPARATOR')).toBeNull();
      expect(parse('')).toBeNull();
    });
  });

  describe('createPersonList', () => {
    it('should create persons from rows', async () => {
      const rows = [
        { groupname: 'group1', loginname: 'user1', code: 'code1' },
        { groupname: 'group1', loginname: 'user2', code: 'code2' }
      ];
      const persons = await service.createPersonList(rows, 1);
      expect(persons).toHaveLength(2);
      expect(persons[0]).toMatchObject({
        workspace_id: 1,
        group: 'group1',
        login: 'user1',
        code: 'code1',
        booklets: []
      });
    });

    it('should handle empty rows array', async () => {
      const persons = await service.createPersonList([], 1);
      expect(persons).toHaveLength(0);
    });

    it('should deduplicate persons by composite key', async () => {
      const rows = [
        { groupname: 'group1', loginname: 'user1', code: 'code1' },
        { groupname: 'group1', loginname: 'user1', code: 'code1' }
      ];
      const persons = await service.createPersonList(rows, 1);
      expect(persons).toHaveLength(1);
    });

    it('should use empty string for missing values', async () => {
      const rows = [{ groupname: '', loginname: 'user1', code: '' }];
      const persons = await service.createPersonList(rows, 1);
      expect(persons[0]).toMatchObject({ group: '', login: 'user1', code: '' });
    });
  });

  describe('assignBookletsToPerson', () => {
    const mockPerson = {
      workspace_id: 1,
      group: 'group1',
      login: 'user1',
      code: 'code1',
      booklets: []
    };

    it('should assign booklets to person', async () => {
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: [],
          laststate: ''
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet2',
          unitname: 'unit2',
          originalUnitId: 'orig2',
          responses: [],
          laststate: ''
        }
      ];

      const result = await service.assignBookletsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(2);
      expect(result.booklets[0].id).toBe('booklet1');
      expect(result.booklets[1].id).toBe('booklet2');
    });

    it('should skip rows not matching person', async () => {
      const rows = [
        {
          groupname: 'group2',
          loginname: 'user2',
          code: 'code2',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: [],
          laststate: ''
        }
      ];

      const result = await service.assignBookletsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(0);
    });

    it('should handle missing booklet name with warning', async () => {
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: '',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: [],
          laststate: ''
        }
      ];
      const issues: TestResultsUploadIssueDto[] = [];

      await service.assignBookletsToPerson(mockPerson, rows, issues);

      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe('warning');
    });

    it('should deduplicate booklets', async () => {
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: [],
          laststate: ''
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit2',
          originalUnitId: 'orig2',
          responses: [],
          laststate: ''
        }
      ];

      const result = await service.assignBookletsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(1);
    });
  });

  describe('assignBookletLogsToPerson', () => {
    const createMockPerson = () => ({
      workspace_id: 1,
      group: 'group1',
      login: 'user1',
      code: 'code1',
      booklets: []
    });

    it('should assign booklet logs to person', () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry: 'KEY:VALUE'
        }
      ];

      const result = service.assignBookletLogsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].logs).toHaveLength(1);
      expect(result.booklets[0].logs[0]).toMatchObject({
        ts: '123456',
        key: 'KEY',
        parameter: 'VALUE'
      });
    });

    it('should parse LOADCOMPLETE and create session', () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry:
            'LOADCOMPLETE: "{browserVersion:"128.0",browserName:"Firefox",osName:"MacOS",device:"desktop",screenSizeWidth:1920,screenSizeHeight:1080,loadTime:500}"'
        }
      ];

      const result = service.assignBookletLogsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].sessions).toHaveLength(1);
      expect(result.booklets[0].sessions[0]).toMatchObject({
        browser: '"Firefox" "128.0"',
        os: '"MacOS"',
        screen: '1920 x 1080',
        loadCompleteMS: 500
      });
    });

    it('should skip logs with invalid format', () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry: 'INVALID_LOG'
        }
      ];
      const issues: TestResultsUploadIssueDto[] = [];

      const result = service.assignBookletLogsToPerson(
        mockPerson,
        rows,
        issues
      );

      expect(result.booklets).toHaveLength(0);
      expect(issues).toHaveLength(1);
    });

    it('should skip rows not matching person', () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group2',
          loginname: 'user2',
          code: 'code2',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry: 'KEY:VALUE'
        }
      ];

      const result = service.assignBookletLogsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(0);
    });

    it('should deduplicate booklets', () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123456',
          logentry: 'KEY1:VALUE1'
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: '',
          originalUnitId: '',
          timestamp: '123457',
          logentry: 'KEY2:VALUE2'
        }
      ];

      const result = service.assignBookletLogsToPerson(mockPerson, rows);

      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].logs).toHaveLength(2);
    });
  });

  describe('assignUnitsToBookletAndPerson', () => {
    const createMockPerson = () => ({
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
    });

    it('should assign units to existing booklet', async () => {
      const mockPerson = createMockPerson();
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

      const result = await service.assignUnitsToBookletAndPerson(
        mockPerson,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(1);
      expect(result.booklets[0].units[0].id).toBe('unit1');
      expect(result.booklets[0].units[0].subforms).toHaveLength(1);
    });

    it('should skip rows not matching person', async () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group2',
          loginname: 'user2',
          code: 'code2',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: '[]',
          laststate: ''
        }
      ];

      const result = await service.assignUnitsToBookletAndPerson(
        mockPerson,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(0);
    });

    it('should skip rows for non-existing booklet', async () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet2',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: '[]',
          laststate: ''
        }
      ];

      const result = await service.assignUnitsToBookletAndPerson(
        mockPerson,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(0);
    });

    it('should handle multiple units', async () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: '[]',
          laststate: ''
        },
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit2',
          originalUnitId: 'orig2',
          responses: '[]',
          laststate: ''
        }
      ];

      const result = await service.assignUnitsToBookletAndPerson(
        mockPerson,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(2);
      expect(result.booklets[0].units[0].id).toBe('unit1');
      expect(result.booklets[0].units[1].id).toBe('unit2');
    });

    it('should handle invalid responses gracefully', async () => {
      const mockPerson = createMockPerson();
      const rows = [
        {
          groupname: 'group1',
          loginname: 'user1',
          code: 'code1',
          bookletname: 'booklet1',
          unitname: 'unit1',
          originalUnitId: 'orig1',
          responses: 'invalid json',
          laststate: ''
        }
      ];

      const result = await service.assignUnitsToBookletAndPerson(
        mockPerson,
        rows
      );

      expect(result.booklets[0].units).toHaveLength(1);
      expect(result.booklets[0].units[0].subforms).toHaveLength(0);
    });
  });

  describe('parseResponses', () => {
    it('should return array if responses is already an array', () => {
      const chunks = [
        {
          id: '1',
          content: 'test',
          ts: 123,
          responseType: 'text',
          subForm: 'sf1'
        }
      ];
      const result = (
        service as unknown as {
          parseResponses: (r: string | unknown[]) => unknown[];
        }
      ).parseResponses(chunks);
      expect(result).toBe(chunks);
    });

    it('should parse JSON string to array', () => {
      const json = JSON.stringify([
        {
          id: '1',
          content: 'test',
          ts: 123,
          responseType: 'text',
          subForm: 'sf1'
        }
      ]);
      const result = (
        service as unknown as {
          parseResponses: (r: string | unknown[]) => unknown[];
        }
      ).parseResponses(json);
      expect(result).toHaveLength(1);
      expect((result as { id: string }[])[0].id).toBe('1');
    });

    it('should return empty array for invalid JSON', () => {
      const result = (
        service as unknown as {
          parseResponses: (r: string | unknown[]) => unknown[];
        }
      ).parseResponses('invalid json');
      expect(result).toHaveLength(0);
    });
  });

  describe('extractSubforms', () => {
    it('should extract subforms from chunks', () => {
      const chunks = [
        {
          id: '1',
          content: JSON.stringify([
            { id: 'var1', value: 'test', status: 'FINISHED' }
          ]),
          ts: 123,
          responseType: 'text',
          subForm: 'sf1'
        }
      ];
      const result = (
        service as unknown as { extractSubforms: (c: unknown[]) => unknown[] }
      ).extractSubforms(chunks);
      expect(result).toHaveLength(1);
      expect((result as { id: string }[])[0].id).toBe('sf1');
    });

    it('should handle invalid chunk content', () => {
      const chunks = [
        {
          id: '1',
          content: 'invalid json',
          ts: 123,
          responseType: 'text',
          subForm: 'sf1'
        }
      ];
      const result = (
        service as unknown as { extractSubforms: (c: unknown[]) => unknown[] }
      ).extractSubforms(chunks);
      expect(result).toHaveLength(1);
      expect((result as { responses: unknown[] }[])[0].responses).toHaveLength(
        0
      );
    });

    describe('parseLastState', () => {
      it('should parse valid JSON string to key-value array', () => {
        const laststate = JSON.stringify({ key1: 'value1', key2: 'value2' });
        const mockRow: Response = {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          unitname: 'unit1',
          bookletname: 'booklet1',
          originalUnitId: 'unit1',
          responses: '',
          laststate: ''
        };
        const mockIssues: TestResultsUploadIssueDto[] = [];
        const result = (
          service as unknown as {
            parseLastState: (
              s: string,
              r: Response,
              i: TestResultsUploadIssueDto[]
            ) => unknown[];
          }
        ).parseLastState(laststate, mockRow, mockIssues);
        expect(result).toHaveLength(2);
        expect(result).toContainEqual({ key: 'key1', value: 'value1' });
        expect(result).toContainEqual({ key: 'key2', value: 'value2' });
      });

      it('should return empty array for empty string', () => {
        const mockRow: Response = {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          unitname: 'unit1',
          bookletname: 'booklet1',
          originalUnitId: 'unit1',
          responses: '',
          laststate: ''
        };
        const mockIssues: TestResultsUploadIssueDto[] = [];
        const result = (
          service as unknown as {
            parseLastState: (
              s: string,
              r: Response,
              i: TestResultsUploadIssueDto[]
            ) => unknown[];
          }
        ).parseLastState('', mockRow, mockIssues);
        expect(result).toHaveLength(0);
      });

      it('should return empty array for invalid JSON', () => {
        const mockRow: Response = {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          unitname: 'unit1',
          bookletname: 'booklet1',
          originalUnitId: 'unit1',
          responses: '',
          laststate: ''
        };
        const mockIssues: TestResultsUploadIssueDto[] = [];
        const result = (
          service as unknown as {
            parseLastState: (
              s: string,
              r: Response,
              i: TestResultsUploadIssueDto[]
            ) => unknown[];
          }
        ).parseLastState('invalid json', mockRow, mockIssues);
        expect(result).toHaveLength(0);
      });

      it('should return empty array for non-object JSON', () => {
        const mockRow: Response = {
          groupname: 'group1',
          loginname: 'login1',
          code: 'code1',
          unitname: 'unit1',
          bookletname: 'booklet1',
          originalUnitId: 'unit1',
          responses: '',
          laststate: ''
        };
        const mockIssues: TestResultsUploadIssueDto[] = [];
        const result = (
          service as unknown as {
            parseLastState: (
              s: string,
              r: Response,
              i: TestResultsUploadIssueDto[]
            ) => unknown[];
          }
        ).parseLastState('[1,2,3]', mockRow, mockIssues);
        expect(result).toHaveLength(0);
      });
    });

    // ... rest of the code remains the same ...
    it('should call persistence service with correct parameters', async () => {
      const personList = [
        {
          workspace_id: 1,
          group: 'g1',
          login: 'u1',
          code: 'c1',
          booklets: []
        }
      ];

      await service.processPersonBooklets(personList, 1, 'skip', 'person', []);

      expect(mockPersistenceService.processPersonBooklets).toHaveBeenCalledWith(
        personList,
        1,
        'skip',
        'person',
        []
      );
    });

    it('should use default overwriteMode and scope', async () => {
      const personList = [
        {
          workspace_id: 1,
          group: 'g1',
          login: 'u1',
          code: 'c1',
          booklets: []
        }
      ];

      await service.processPersonBooklets(personList, 1);

      expect(mockPersistenceService.processPersonBooklets).toHaveBeenCalledWith(
        personList,
        1,
        'skip',
        'person',
        []
      );
    });
  });

  describe('delegation to query service', () => {
    it('should delegate getWorkspaceGroups to query service', async () => {
      mockQueryService.getWorkspaceGroups.mockResolvedValue([
        'group1',
        'group2'
      ]);
      const result = await service.getWorkspaceGroups(1);
      expect(mockQueryService.getWorkspaceGroups).toHaveBeenCalledWith(1);
      expect(result).toEqual(['group1', 'group2']);
    });

    it('should delegate getWorkspaceUploadStats to query service', async () => {
      const stats = {
        testPersons: 10,
        testGroups: 2,
        uniqueBooklets: 5,
        uniqueUnits: 3,
        uniqueResponses: 50
      };
      mockQueryService.getWorkspaceUploadStats.mockResolvedValue(stats);
      const result = await service.getWorkspaceUploadStats(1);
      expect(mockQueryService.getWorkspaceUploadStats).toHaveBeenCalledWith(1);
      expect(result).toEqual(stats);
    });

    it('should delegate getWorkspaceGroupCodingStats to query service', async () => {
      const stats = [
        { groupName: 'g1', testPersonCount: 5, responsesToCode: 10 }
      ];
      mockQueryService.getWorkspaceGroupCodingStats.mockResolvedValue(stats);
      const result = await service.getWorkspaceGroupCodingStats(1);
      expect(
        mockQueryService.getWorkspaceGroupCodingStats
      ).toHaveBeenCalledWith(1);
      expect(result).toEqual(stats);
    });

    it('should delegate hasBookletLogsForGroup to query service', async () => {
      mockQueryService.hasBookletLogsForGroup.mockResolvedValue(true);
      const result = await service.hasBookletLogsForGroup(1, 'group1');
      expect(mockQueryService.hasBookletLogsForGroup).toHaveBeenCalledWith(
        1,
        'group1'
      );
      expect(result).toBe(true);
    });

    it('should delegate getGroupsWithBookletLogs to query service', async () => {
      const map = new Map([['group1', true]]);
      mockQueryService.getGroupsWithBookletLogs.mockResolvedValue(map);
      const result = await service.getGroupsWithBookletLogs(1);
      expect(mockQueryService.getGroupsWithBookletLogs).toHaveBeenCalledWith(1);
      expect(result).toEqual(map);
    });

    it('should delegate getImportStatistics to query service', async () => {
      const stats = { persons: 10, booklets: 5, units: 20 };
      mockQueryService.getImportStatistics.mockResolvedValue(stats);
      const result = await service.getImportStatistics(1);
      expect(mockQueryService.getImportStatistics).toHaveBeenCalledWith(1);
      expect(result).toEqual(stats);
    });

    it('should delegate getLogCoverageStats to query service', async () => {
      const stats = {
        bookletsWithLogs: 3,
        totalBooklets: 5,
        unitsWithLogs: 10,
        totalUnits: 20
      };
      mockQueryService.getLogCoverageStats.mockResolvedValue(stats);
      const result = await service.getLogCoverageStats(1);
      expect(mockQueryService.getLogCoverageStats).toHaveBeenCalledWith(1);
      expect(result).toEqual(stats);
    });
  });

  describe('delegation to persistence service', () => {
    it('should delegate markPersonsAsNotConsidered to persistence service', async () => {
      mockPersistenceService.markPersonsAsNotConsidered.mockResolvedValue(true);
      const result = await service.markPersonsAsNotConsidered(1, [
        'user1',
        'user2'
      ]);
      expect(
        mockPersistenceService.markPersonsAsNotConsidered
      ).toHaveBeenCalledWith(1, ['user1', 'user2']);
      expect(result).toBe(true);
    });

    it('should delegate markPersonsAsConsidered to persistence service', async () => {
      mockPersistenceService.markPersonsAsConsidered.mockResolvedValue(true);
      const result = await service.markPersonsAsConsidered(1, ['user1']);
      expect(
        mockPersistenceService.markPersonsAsConsidered
      ).toHaveBeenCalledWith(1, ['user1']);
      expect(result).toBe(true);
    });

    it('should delegate processPersonLogs to persistence service', async () => {
      const persons = [
        {
          workspace_id: 1,
          group: 'g1',
          login: 'u1',
          code: 'c1',
          booklets: []
        }
      ];
      const unitLogs: {
        groupname: string;
        loginname: string;
        code: string;
        bookletname: string;
        unitname: string;
        originalUnitId: string;
        timestamp: string;
        logentry: string;
      }[] = [];
      const bookletLogs: typeof unitLogs = [];
      const expected = {
        success: true,
        totalBooklets: 1,
        totalLogsSaved: 5,
        totalLogsSkipped: 0
      };
      mockPersistenceService.processPersonLogs.mockResolvedValue(expected);

      const result = await service.processPersonLogs(
        persons,
        unitLogs,
        bookletLogs,
        true
      );

      expect(mockPersistenceService.processPersonLogs).toHaveBeenCalledWith(
        persons,
        unitLogs,
        bookletLogs,
        true
      );
      expect(result).toEqual(expected);
    });
  });
});
