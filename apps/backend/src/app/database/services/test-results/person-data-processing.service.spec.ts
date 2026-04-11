import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PersonDataProcessingService } from './person-data-processing.service';
import {
  Chunk,
  Log,
  Person,
  Response,
  TcMergeBooklet,
  TcMergeLastState,
  TcMergeSubForms
} from '../shared/types';

describe('PersonDataProcessingService', () => {
  let service: PersonDataProcessingService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonDataProcessingService]
    }).compile();
    service = module.get<PersonDataProcessingService>(
      PersonDataProcessingService
    );
  });

  describe('createPersonList', () => {
    it('should create unique person list from rows', () => {
      const rows = [
        { groupname: 'GroupA', loginname: 'user1', code: 'code1' },
        { groupname: 'GroupA', loginname: 'user1', code: 'code1' },
        { groupname: 'GroupB', loginname: 'user2', code: 'code2' }
      ];
      const result = service.createPersonList(rows, 1);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        group: 'GroupA',
        login: 'user1',
        code: 'code1',
        workspace_id: 1
      });
    });

    it('should handle empty/undefined values', () => {
      const rows = [{ groupname: undefined, loginname: null, code: '' }];
      const result = service.createPersonList(
        rows as unknown as {
          groupname: string;
          loginname: string;
          code: string;
        }[],
        1
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ group: '', login: '', code: '' });
    });

    it('should return empty array for invalid input', () => {
      expect(
        service.createPersonList(
          null as unknown as {
            groupname: string;
            loginname: string;
            code: string;
          }[],
          1
        )
      ).toEqual([]);
      expect(service.createPersonList([], -1)).toEqual([]);
      expect(service.createPersonList([], 0)).toEqual([]);
      expect(
        service.createPersonList([], 'invalid' as unknown as number)
      ).toEqual([]);
    });
  });

  describe('assignBookletsToPerson', () => {
    it('should assign unique booklets to person', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      const rows = [
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1'
        },
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1'
        },
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B2'
        }
      ];
      const result = service.assignBookletsToPerson(
        person as Person,
        rows as unknown as Response[]
      );
      expect(result.booklets).toHaveLength(2);
      expect(result.booklets.map(b => b.id)).toEqual(['B1', 'B2']);
    });

    it('should skip rows without bookletname', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      const rows = [
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: null
        }
      ];
      const result = service.assignBookletsToPerson(
        person as Person,
        rows as unknown as Response[]
      );
      expect(result.booklets).toHaveLength(0);
    });

    it('should only assign matching person rows', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      const rows = [
        {
          groupname: 'G2',
          loginname: 'L2',
          code: 'C2',
          bookletname: 'B1'
        }
      ];
      const result = service.assignBookletsToPerson(
        person as Person,
        rows as unknown as Response[]
      );
      expect(result.booklets).toHaveLength(0);
    });
  });

  describe('assignBookletLogsToPerson', () => {
    it('should assign logs and sessions to booklets', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      const rows = [
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1',
          timestamp: 1234567890,
          logentry: 'ERROR : "test error"'
        },
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1',
          timestamp: 1234567891,
          logentry:
            'LOADCOMPLETE : "{browserVersion:128,browserName:Firefox,osName:Linux,screenSizeWidth:1920,screenSizeHeight:1080,loadTime:500}"'
        }
      ];
      const result = service.assignBookletLogsToPerson(
        person as Person,
        rows as unknown as Log[]
      );
      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].logs).toHaveLength(1);
      expect(result.booklets[0].sessions).toHaveLength(1);
      expect(result.booklets[0].sessions[0]).toMatchObject({
        browser: 'Firefox 128',
        os: 'Linux',
        screen: '1920 x 1080',
        loadCompleteMS: 500
      });
    });

    it('should skip incomplete log entries', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      const rows = [
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1',
          timestamp: 1,
          logentry: null
        },
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1',
          timestamp: 1,
          logentry: 'INVALID' // No " : " separator, creates log with key="INVALID" and empty parameter
        }
      ];
      const result = service.assignBookletLogsToPerson(
        person as Person,
        rows as unknown as Log[]
      );
      // Service creates booklet for "INVALID" entry (key without " : " separator)
      expect(result.booklets).toHaveLength(1);
      expect(result.booklets[0].logs).toHaveLength(1);
      expect(result.booklets[0].logs[0].key).toBe('INVALID');
    });
  });

  describe('assignUnitsToBookletAndPerson', () => {
    it('should assign units to matching booklets', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        workspace_id: 1,
        booklets: [
          {
            id: 'B1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      const rows = [
        {
          groupname: 'G1',
          loginname: 'L1',
          code: 'C1',
          bookletname: 'B1',
          unitname: 'U1',
          responses:
            '[{"id":"1","content":"[{\\"id\\":\\"var1\\",\\"value\\":\\"test\\"}]","subForm":"SF1","ts":123}]',
          laststate: '{"state":"completed"}'
        }
      ];
      const result = service.assignUnitsToBookletAndPerson(
        person as Person,
        rows as unknown as Response[]
      );
      expect(result.booklets[0].units).toHaveLength(1);
      expect(result.booklets[0].units[0].id).toBe('U1');
    });

    it('should skip non-matching rows', () => {
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        workspace_id: 1,
        booklets: [
          {
            id: 'B1',
            logs: [],
            units: [],
            sessions: []
          }
        ]
      };
      const rows = [
        {
          groupname: 'G2',
          loginname: 'L2',
          code: 'C2',
          bookletname: 'B1',
          unitname: 'U1',
          responses: '[]',
          laststate: '{}'
        }
      ];
      const result = service.assignUnitsToBookletAndPerson(
        person as Person,
        rows as unknown as Response[]
      );
      expect(result.booklets[0].units).toHaveLength(0);
    });
  });

  describe('assignUnitLogsToBooklet', () => {
    it('should add logs to existing units', () => {
      const booklet = {
        id: 'B1',
        logs: [],
        units: [{ id: 'U1', logs: [] }],
        sessions: []
      };
      const rows = [
        {
          bookletname: 'B1',
          unitname: 'U1',
          timestamp: 123,
          logentry: 'KEY="value"'
        }
      ];
      const result = service.assignUnitLogsToBooklet(
        booklet as TcMergeBooklet,
        rows as unknown as Log[]
      );
      expect(result.units[0].logs).toHaveLength(1);
      expect(result.units[0].logs[0]).toMatchObject({
        key: 'KEY',
        parameter: 'value'
      });
    });

    it('should create new units for unknown unitnames', () => {
      const booklet = {
        id: 'B1',
        logs: [],
        units: [],
        sessions: []
      };
      const rows = [
        {
          bookletname: 'B1',
          unitname: 'U2',
          timestamp: 123,
          logentry: 'KEY="value"'
        }
      ];
      const result = service.assignUnitLogsToBooklet(
        booklet as TcMergeBooklet,
        rows as unknown as Log[]
      );
      expect(result.units).toHaveLength(1);
      expect(result.units[0].id).toBe('U2');
    });

    it('should skip invalid rows', () => {
      const booklet = {
        id: 'B1',
        logs: [],
        units: [],
        sessions: []
      };
      expect(
        service.assignUnitLogsToBooklet(
          booklet as TcMergeBooklet,
          null as unknown as Log[]
        )
      ).toEqual(booklet);
      expect(
        service.assignUnitLogsToBooklet(null as unknown as TcMergeBooklet, [])
      ).toBeNull();
    });
  });

  describe('parseResponses', () => {
    it('should return array as-is', () => {
      const arr = [
        {
          id: '1',
          content: 'test',
          subForm: 'SF1',
          ts: 1
        }
      ];
      expect(service.parseResponses(arr as unknown as Chunk[])).toEqual(arr);
    });

    it('should parse valid JSON string', () => {
      const json = '[{"id":"1","content":"test","subForm":"SF1","ts":1}]';
      expect(service.parseResponses(json)).toEqual([
        {
          id: '1',
          content: 'test',
          subForm: 'SF1',
          ts: 1
        }
      ]);
    });

    it('should return empty array for invalid JSON', () => {
      expect(service.parseResponses('invalid json')).toEqual([]);
      expect(service.parseResponses('')).toEqual([]);
    });
  });

  describe('extractSubforms', () => {
    it('should extract subforms from chunks', () => {
      const chunks = [
        {
          id: '1',
          content: '[{"id":"var1","value":"test"}]',
          subForm: 'SF1',
          ts: 1
        },
        {
          id: '2',
          content: '[{"id":"var2","value":"test2"}]',
          subForm: 'SF2',
          ts: 2
        }
      ];
      const result = service.extractSubforms(chunks as unknown as Chunk[]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'SF1',
        responses: [{ id: 'var1', value: 'test' }]
      });
    });

    it('should handle invalid chunk content', () => {
      const chunks = [
        {
          id: '1',
          content: 'invalid',
          subForm: 'SF1',
          ts: 1
        }
      ];
      const result = service.extractSubforms(chunks as unknown as Chunk[]);
      expect(result).toHaveLength(1);
      expect(result[0].responses).toEqual([]);
    });
  });

  describe('extractVariablesFromSubforms', () => {
    it('should extract unique variable IDs', () => {
      const subforms = [
        { id: 'SF1', responses: [{ id: 'var1' }, { id: 'var2' }] },
        { id: 'SF2', responses: [{ id: 'var2' }, { id: 'var3' }] }
      ];
      const result = service.extractVariablesFromSubforms(
        subforms as unknown as TcMergeSubForms[]
      );
      expect(Array.from(result)).toEqual(['var1', 'var2', 'var3']);
    });

    it('should handle empty responses', () => {
      const subforms = [{ id: 'SF1', responses: [] }];
      const result = service.extractVariablesFromSubforms(
        subforms as unknown as TcMergeSubForms[]
      );
      expect(result.size).toBe(0);
    });
  });

  describe('parseLastState', () => {
    it('should parse valid JSON object', () => {
      const result = service.parseLastState('{"key1":"value1","key2":123}');
      expect(result).toEqual([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: '123' }
      ]);
    });

    it('should return empty array for invalid input', () => {
      expect(service.parseLastState('')).toEqual([]);
      expect(service.parseLastState(null as unknown as string)).toEqual([]);
      expect(service.parseLastState('[]')).toEqual([]);
      expect(service.parseLastState('invalid')).toEqual([]);
    });
  });

  describe('parseLoadCompleteLog', () => {
    it('should parse valid LOADCOMPLETE log', () => {
      const log =
        '{browserVersion:128,browserName:Firefox,osName:Linux,device:Desktop,screenSizeWidth:1920,screenSizeHeight:1080,loadTime:500}';
      const result = service.parseLoadCompleteLog(log);
      expect(result).toMatchObject({
        browserVersion: '128',
        browserName: 'Firefox',
        osName: 'Linux',
        screenSizeWidth: 1920,
        screenSizeHeight: 1080,
        loadTime: 500
      });
    });

    it('should return default values for invalid log', () => {
      const result = service.parseLoadCompleteLog('invalid');
      // Service returns default values for unparseable input
      expect(result).toMatchObject({
        browserVersion: 'Unknown',
        browserName: 'Unknown',
        osName: 'Unknown',
        device: 'Unknown',
        screenSizeWidth: 0,
        screenSizeHeight: 0,
        loadTime: 0
      });
      // Empty string also returns default values (not null)
      expect(service.parseLoadCompleteLog('')).toMatchObject({
        browserVersion: 'Unknown',
        browserName: 'Unknown',
        osName: 'Unknown',
        device: 'Unknown',
        screenSizeWidth: 0,
        screenSizeHeight: 0,
        loadTime: 0
      });
    });
  });

  describe('createUnit', () => {
    it('should create complete unit object', () => {
      const row = { unitname: 'U1', bookletname: 'B1' };
      const laststate = [{ key: 'state', value: 'done' }];
      const subforms = [{ id: 'SF1', responses: [] }];
      const variables = new Set(['var1']);
      const parsedResponses = [
        { id: 'chunk1', responseType: 'type1', ts: 123 }
      ];
      const result = service.createUnit(
        row as unknown as Response,
        laststate as TcMergeLastState[],
        subforms as TcMergeSubForms[],
        variables,
        parsedResponses as unknown as Chunk[]
      );
      expect(result).toMatchObject({
        id: 'U1',
        alias: 'U1',
        laststate,
        subforms,
        chunks: [
          {
            id: 'chunk1',
            type: 'type1',
            ts: 123,
            variables: ['var1']
          }
        ]
      });
    });
  });

  describe('doesRowMatchPerson', () => {
    it('should match when all fields equal', () => {
      const row = { groupname: 'G1', loginname: 'L1', code: 'C1' };
      const person = {
        group: 'G1',
        login: 'L1',
        code: 'C1',
        booklets: [],
        workspace_id: 1
      };
      expect(
        service.doesRowMatchPerson(row as unknown as Response, person as Person)
      ).toBe(true);
    });

    it('should not match when any field differs', () => {
      const row = { groupname: 'G1', loginname: 'L1', code: 'C1' };
      expect(
        service.doesRowMatchPerson(
          row as unknown as Response,
          {
            group: 'G2',
            login: 'L1',
            code: 'C1',
            booklets: [],
            workspace_id: 1
          } as Person
        )
      ).toBe(false);
      expect(
        service.doesRowMatchPerson(
          row as unknown as Response,
          {
            group: 'G1',
            login: 'L2',
            code: 'C1',
            booklets: [],
            workspace_id: 1
          } as Person
        )
      ).toBe(false);
      expect(
        service.doesRowMatchPerson(
          row as unknown as Response,
          {
            group: 'G1',
            login: 'L1',
            code: 'C2',
            booklets: [],
            workspace_id: 1
          } as Person
        )
      ).toBe(false);
    });
  });
});
