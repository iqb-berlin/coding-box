import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PersonValidationService } from './person-validation.service';
import { Person, TcMergeBooklet, TcMergeUnit } from '../shared';

describe('PersonValidationService', () => {
  let service: PersonValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonValidationService]
    }).compile();

    service = module.get<PersonValidationService>(PersonValidationService);
  });

  describe('validateWorkspaceId', () => {
    it('should pass for valid positive workspace ID', () => {
      expect(() => service.validateWorkspaceId(1)).not.toThrow();
      expect(() => service.validateWorkspaceId(100)).not.toThrow();
    });

    it('should throw BadRequestException for zero workspace ID', () => {
      expect(() => service.validateWorkspaceId(0)).toThrow(BadRequestException);
      expect(() => service.validateWorkspaceId(0)).toThrow('Invalid workspace ID: 0. Workspace ID must be a positive number.');
    });

    it('should throw BadRequestException for negative workspace ID', () => {
      expect(() => service.validateWorkspaceId(-1)).toThrow(BadRequestException);
      expect(() => service.validateWorkspaceId(-100)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for undefined workspace ID', () => {
      expect(() => service.validateWorkspaceId(undefined as unknown as number)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for null workspace ID', () => {
      expect(() => service.validateWorkspaceId(null as unknown as number)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-number workspace ID', () => {
      expect(() => service.validateWorkspaceId('1' as unknown as number)).toThrow(BadRequestException);
      expect(() => service.validateWorkspaceId({} as unknown as number)).toThrow(BadRequestException);
    });
  });

  describe('validatePersonList', () => {
    const validPerson: Person = {
      workspace_id: 1,
      group: 'g1',
      login: 'l1',
      code: 'c1',
      booklets: []
    };

    it('should pass for non-empty array', () => {
      expect(() => service.validatePersonList([validPerson])).not.toThrow();
      expect(() => service.validatePersonList([validPerson, validPerson])).not.toThrow();
    });

    it('should throw BadRequestException for empty array', () => {
      expect(() => service.validatePersonList([])).toThrow(BadRequestException);
      expect(() => service.validatePersonList([])).toThrow('Invalid person list: cannot be empty.');
    });

    it('should throw BadRequestException for non-array', () => {
      expect(() => service.validatePersonList(null as unknown as Person[])).toThrow(BadRequestException);
      expect(() => service.validatePersonList(undefined as unknown as Person[])).toThrow(BadRequestException);
      expect(() => service.validatePersonList({} as unknown as Person[])).toThrow(BadRequestException);
      expect(() => service.validatePersonList('person' as unknown as Person[])).toThrow(BadRequestException);
    });

    it('should throw BadRequestException with correct message for non-array', () => {
      expect(() => service.validatePersonList(null as unknown as Person[])).toThrow('Invalid person list: must be an array.');
    });
  });

  describe('validatePersonData', () => {
    it('should pass for valid person object', () => {
      const person: Person = {
        workspace_id: 1,
        group: 'g1',
        login: 'l1',
        code: 'c1',
        booklets: []
      };
      expect(() => service.validatePersonData(person)).not.toThrow();
    });

    it('should throw BadRequestException for null person', () => {
      expect(() => service.validatePersonData(null as unknown as Person)).toThrow(BadRequestException);
      expect(() => service.validatePersonData(null as unknown as Person)).toThrow('Invalid person data: person must be an object.');
    });

    it('should throw BadRequestException for undefined person', () => {
      expect(() => service.validatePersonData(undefined as unknown as Person)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-object person', () => {
      expect(() => service.validatePersonData('person' as unknown as Person)).toThrow(BadRequestException);
      expect(() => service.validatePersonData(123 as unknown as Person)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing workspace_id', () => {
      const person = {
        group: 'g1', login: 'l1', code: 'c1', booklets: []
      };
      expect(() => service.validatePersonData(person as unknown as Person)).toThrow(BadRequestException);
      expect(() => service.validatePersonData(person as unknown as Person)).toThrow('Invalid person data: workspace_id is required.');
    });

    it('should throw BadRequestException for null workspace_id', () => {
      const person = {
        workspace_id: null, group: 'g1', login: 'l1', code: 'c1', booklets: []
      };
      expect(() => service.validatePersonData(person as unknown as Person)).toThrow(BadRequestException);
      expect(() => service.validatePersonData(person as unknown as Person)).toThrow('Invalid person data: workspace_id is required.');
    });

    it('should throw BadRequestException for invalid workspace_id value', () => {
      const person: Person = {
        workspace_id: 0,
        group: 'g1',
        login: 'l1',
        code: 'c1',
        booklets: []
      };
      expect(() => service.validatePersonData(person)).toThrow(BadRequestException);
      expect(() => service.validatePersonData(person)).toThrow('Invalid workspace ID: 0. Workspace ID must be a positive number.');
    });
  });

  describe('validateBooklet', () => {
    it('should pass for valid booklet object', () => {
      const booklet: TcMergeBooklet = {
        id: 'booklet1',
        logs: [],
        units: [],
        sessions: []
      };
      expect(() => service.validateBooklet(booklet)).not.toThrow();
    });

    it('should throw BadRequestException for null booklet', () => {
      expect(() => service.validateBooklet(null as unknown as TcMergeBooklet)).toThrow(BadRequestException);
      expect(() => service.validateBooklet(null as unknown as TcMergeBooklet)).toThrow('Invalid booklet: booklet must be an object.');
    });

    it('should throw BadRequestException for undefined booklet', () => {
      expect(() => service.validateBooklet(undefined as unknown as TcMergeBooklet)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-object booklet', () => {
      expect(() => service.validateBooklet('booklet' as unknown as TcMergeBooklet)).toThrow(BadRequestException);
      expect(() => service.validateBooklet(123 as unknown as TcMergeBooklet)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing booklet id', () => {
      const booklet = { logs: [], units: [], sessions: [] };
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet)).toThrow(BadRequestException);
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet)).toThrow('Invalid booklet: booklet ID is required.');
    });

    it('should throw BadRequestException for empty booklet id', () => {
      const booklet: TcMergeBooklet = {
        id: '',
        logs: [],
        units: [],
        sessions: []
      };
      expect(() => service.validateBooklet(booklet)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-array units', () => {
      const booklet = {
        id: 'booklet1', logs: [], units: null, sessions: []
      };
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet)).toThrow(BadRequestException);
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet)).toThrow('Invalid booklet structure: units must be an array for booklet booklet1.');
    });

    it('should throw BadRequestException with booklet id in error message', () => {
      const booklet = {
        id: 'test-booklet', logs: [], units: 'not-an-array', sessions: []
      };
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet)).toThrow('Invalid booklet structure: units must be an array for booklet test-booklet.');
    });
  });

  describe('validateUnit', () => {
    it('should pass for valid unit object', () => {
      const unit: TcMergeUnit = {
        id: 'unit1',
        alias: 'u1',
        laststate: [],
        subforms: [],
        chunks: [],
        logs: []
      };
      expect(() => service.validateUnit(unit)).not.toThrow();
    });

    it('should throw BadRequestException for null unit', () => {
      expect(() => service.validateUnit(null as unknown as TcMergeUnit)).toThrow(BadRequestException);
      expect(() => service.validateUnit(null as unknown as TcMergeUnit)).toThrow('Invalid unit: unit must be an object.');
    });

    it('should throw BadRequestException for undefined unit', () => {
      expect(() => service.validateUnit(undefined as unknown as TcMergeUnit)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-object unit', () => {
      expect(() => service.validateUnit('unit' as unknown as TcMergeUnit)).toThrow(BadRequestException);
      expect(() => service.validateUnit(123 as unknown as TcMergeUnit)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing unit id', () => {
      const unit = {
        alias: 'u1', laststate: [], subforms: [], chunks: [], logs: []
      };
      expect(() => service.validateUnit(unit as unknown as TcMergeUnit)).toThrow(BadRequestException);
      expect(() => service.validateUnit(unit as unknown as TcMergeUnit)).toThrow('Invalid unit: unit ID is required.');
    });

    it('should throw BadRequestException for empty unit id', () => {
      const unit: TcMergeUnit = {
        id: '',
        alias: 'u1',
        laststate: [],
        subforms: [],
        chunks: [],
        logs: []
      };
      expect(() => service.validateUnit(unit)).toThrow(BadRequestException);
    });
  });

  describe('validateLogEntry', () => {
    it('should pass for valid log entry with KEY : VALUE format', () => {
      expect(() => service.validateLogEntry('TEST : value')).not.toThrow();
      expect(() => service.validateLogEntry('KEY : some value here')).not.toThrow();
    });

    it('should throw BadRequestException for null log entry', () => {
      expect(() => service.validateLogEntry(null as unknown as string)).toThrow(BadRequestException);
      expect(() => service.validateLogEntry(null as unknown as string)).toThrow('Invalid log entry: log entry must be a non-empty string.');
    });

    it('should throw BadRequestException for undefined log entry', () => {
      expect(() => service.validateLogEntry(undefined as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty string log entry', () => {
      expect(() => service.validateLogEntry('')).toThrow(BadRequestException);
      expect(() => service.validateLogEntry('   ')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-string log entry', () => {
      expect(() => service.validateLogEntry(123 as unknown as string)).toThrow(BadRequestException);
      expect(() => service.validateLogEntry({} as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for log entry without separator', () => {
      expect(() => service.validateLogEntry('TEST value')).toThrow(BadRequestException);
      expect(() => service.validateLogEntry('TEST: value')).toThrow(BadRequestException);
      expect(() => service.validateLogEntry('TEST :value')).toThrow(BadRequestException);
      expect(() => service.validateLogEntry('TEST:value')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException with correct message for invalid format', () => {
      expect(() => service.validateLogEntry('invalid')).toThrow('Invalid log entry format: expected "KEY : VALUE" format, got "invalid".');
    });

    it('should throw BadRequestException showing the invalid entry in message', () => {
      expect(() => service.validateLogEntry('no-separator-here')).toThrow('Invalid log entry format: expected "KEY : VALUE" format, got "no-separator-here".');
    });
  });

  describe('validateLoadCompleteLog', () => {
    it('should return true for valid LOADCOMPLETE log format', () => {
      expect(service.validateLoadCompleteLog('{key:value}')).toBe(true);
      expect(service.validateLoadCompleteLog('{a:1,b:2}')).toBe(true);
      expect(service.validateLoadCompleteLog('  {key:value}  ')).toBe(true);
    });

    it('should return false for null log entry', () => {
      expect(service.validateLoadCompleteLog(null as unknown as string)).toBe(false);
    });

    it('should return false for undefined log entry', () => {
      expect(service.validateLoadCompleteLog(undefined as unknown as string)).toBe(false);
    });

    it('should return false for non-string log entry', () => {
      expect(service.validateLoadCompleteLog(123 as unknown as string)).toBe(false);
      expect(service.validateLoadCompleteLog({} as unknown as string)).toBe(false);
    });

    it('should return false for string without curly braces', () => {
      expect(service.validateLoadCompleteLog('key:value')).toBe(false);
      expect(service.validateLoadCompleteLog('[key:value]')).toBe(false);
      expect(service.validateLoadCompleteLog('(key:value)')).toBe(false);
    });

    it('should return false for string with only opening brace', () => {
      expect(service.validateLoadCompleteLog('{key:value')).toBe(false);
    });

    it('should return false for string with only closing brace', () => {
      expect(service.validateLoadCompleteLog('key:value}')).toBe(false);
    });

    it('should return false for empty braces without colon', () => {
      expect(service.validateLoadCompleteLog('{}')).toBe(false);
      expect(service.validateLoadCompleteLog('{ }')).toBe(false);
    });

    it('should return false for braces with content but no colon', () => {
      expect(service.validateLoadCompleteLog('{keyvalue}')).toBe(false);
    });
  });

  describe('validateBookletName', () => {
    it('should pass for valid non-empty booklet name', () => {
      expect(() => service.validateBookletName('booklet1')).not.toThrow();
      expect(() => service.validateBookletName('Booklet Name')).not.toThrow();
    });

    it('should throw BadRequestException for empty string', () => {
      expect(() => service.validateBookletName('')).toThrow(BadRequestException);
      expect(() => service.validateBookletName('   ')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for null', () => {
      expect(() => service.validateBookletName(null as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for undefined', () => {
      expect(() => service.validateBookletName(undefined as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-string', () => {
      expect(() => service.validateBookletName(123 as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException with correct field name in message', () => {
      expect(() => service.validateBookletName('')).toThrow('Invalid booklet name: must be a non-empty string.');
    });
  });

  describe('validateUnitName', () => {
    it('should pass for valid non-empty unit name', () => {
      expect(() => service.validateUnitName('unit1')).not.toThrow();
      expect(() => service.validateUnitName('Unit Name')).not.toThrow();
    });

    it('should throw BadRequestException for empty string', () => {
      expect(() => service.validateUnitName('')).toThrow(BadRequestException);
      expect(() => service.validateUnitName('   ')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for null', () => {
      expect(() => service.validateUnitName(null as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for undefined', () => {
      expect(() => service.validateUnitName(undefined as unknown as string)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException with correct field name in message', () => {
      expect(() => service.validateUnitName('')).toThrow('Invalid unit name: must be a non-empty string.');
    });
  });

  describe('validateArray', () => {
    it('should pass for valid array', () => {
      expect(() => service.validateArray([1, 2, 3], 'items')).not.toThrow();
      expect(() => service.validateArray([], 'empty')).not.toThrow();
    });

    it('should throw BadRequestException for null', () => {
      expect(() => service.validateArray(null as unknown as unknown[], 'items')).toThrow(BadRequestException);
      expect(() => service.validateArray(null as unknown as unknown[], 'items')).toThrow('Invalid items: must be an array.');
    });

    it('should throw BadRequestException for undefined', () => {
      expect(() => service.validateArray(undefined as unknown as unknown[], 'values')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-array', () => {
      expect(() => service.validateArray('array' as unknown as unknown[], 'data')).toThrow(BadRequestException);
      expect(() => service.validateArray({} as unknown as unknown[], 'data')).toThrow(BadRequestException);
      expect(() => service.validateArray(123 as unknown as unknown[], 'data')).toThrow(BadRequestException);
    });

    it('should include field name in error message', () => {
      expect(() => service.validateArray(null as unknown as unknown[], 'myField')).toThrow('Invalid myField: must be an array.');
    });
  });

  describe('validateLogins', () => {
    it('should pass for non-empty array', () => {
      expect(() => service.validateLogins(['login1'])).not.toThrow();
      expect(() => service.validateLogins(['login1', 'login2'])).not.toThrow();
    });

    it('should throw BadRequestException for empty array', () => {
      expect(() => service.validateLogins([])).toThrow(BadRequestException);
      expect(() => service.validateLogins([])).toThrow('Invalid logins: array cannot be empty.');
    });

    it('should throw BadRequestException for non-array', () => {
      expect(() => service.validateLogins(null as unknown as string[])).toThrow(BadRequestException);
      expect(() => service.validateLogins('login' as unknown as string[])).toThrow(BadRequestException);
    });
  });

  describe('validateRowStructure', () => {
    it('should pass for valid row with bookletname and unitname', () => {
      const row = { bookletname: 'booklet1', unitname: 'unit1' };
      expect(() => service.validateRowStructure(row)).not.toThrow();
    });

    it('should throw BadRequestException for null row', () => {
      expect(() => service.validateRowStructure(null)).toThrow(BadRequestException);
      expect(() => service.validateRowStructure(null)).toThrow('Invalid row: row must be an object.');
    });

    it('should throw BadRequestException for undefined row', () => {
      expect(() => service.validateRowStructure(undefined)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-object row', () => {
      expect(() => service.validateRowStructure('row')).toThrow(BadRequestException);
      expect(() => service.validateRowStructure(123)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing bookletname', () => {
      const row = { unitname: 'unit1' };
      expect(() => service.validateRowStructure(row)).toThrow(BadRequestException);
      expect(() => service.validateRowStructure(row)).toThrow('Invalid row: bookletname must be a string.');
    });

    it('should throw BadRequestException for non-string bookletname', () => {
      const row = { bookletname: 123, unitname: 'unit1' };
      expect(() => service.validateRowStructure(row)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing unitname', () => {
      const row = { bookletname: 'booklet1' };
      expect(() => service.validateRowStructure(row)).toThrow(BadRequestException);
      expect(() => service.validateRowStructure(row)).toThrow('Invalid row: unitname must be a string.');
    });

    it('should throw BadRequestException for non-string unitname', () => {
      const row = { bookletname: 'booklet1', unitname: 123 };
      expect(() => service.validateRowStructure(row)).toThrow(BadRequestException);
    });
  });

  describe('Error message generation', () => {
    it('should include actual values in workspace ID error messages', () => {
      expect(() => service.validateWorkspaceId(-5)).toThrow('Invalid workspace ID: -5');
      expect(() => service.validateWorkspaceId(0)).toThrow('Invalid workspace ID: 0');
    });

    it('should include field names in non-empty string validation', () => {
      expect(() => service.validateNonEmptyString('', 'customField')).toThrow('Invalid customField: must be a non-empty string.');
    });

    it('should include actual log entry in format error messages', () => {
      const invalidEntry = 'malformed-entry';
      expect(() => service.validateLogEntry(invalidEntry)).toThrow(`Invalid log entry format: expected "KEY : VALUE" format, got "${invalidEntry}".`);
    });

    it('should include booklet ID in units validation error', () => {
      const booklet = {
        id: 'specific-booklet', logs: [], units: 'not-array', sessions: []
      };
      expect(() => service.validateBooklet(booklet as unknown as TcMergeBooklet))
        .toThrow('Invalid booklet structure: units must be an array for booklet specific-booklet.');
    });
  });
});
