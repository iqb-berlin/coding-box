import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { PersonService } from './person.service';
import { PersonQueryService } from './person-query.service';
import { PersonPersistenceService } from './person-persistence.service';

describe('PersonService', () => {
  let service: PersonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonService,
        { provide: PersonQueryService, useValue: createMock<PersonQueryService>() },
        { provide: PersonPersistenceService, useValue: createMock<PersonPersistenceService>() }
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
      expect(parse('"CONNECTION" : LOST')).toEqual({ key: 'CONNECTION', value: 'LOST' });
    });

    it('should handle quoted values', () => {
      expect(parse('CONNECTION : "POLLING"')).toEqual({ key: 'CONNECTION', value: 'POLLING' });
    });

    it('should handle complex JSON in values', () => {
      const log = 'TESTLETS_TIMELEFT : "{\\"SFB_FRZ\\":32}"';
      expect(parse(log)).toEqual({ key: 'TESTLETS_TIMELEFT', value: '{"SFB_FRZ":32}' });
    });

    it('should handle double-escaped JSON', () => {
      const log = 'LOADCOMPLETE : "{\\"browserVersion\\":\\"128.0\\",\\"browserName\\":\\"Firefox\\"}"';
      expect(parse(log)).toEqual({ key: 'LOADCOMPLETE', value: '{"browserVersion":"128.0","browserName":"Firefox"}' });
    });

    it('should handle complex strings with spaces and special chars', () => {
      const log = 'command executed : "goto id S_Ende_Teil "';
      expect(parse(log)).toEqual({ key: 'command executed', value: 'goto id S_Ende_Teil ' });
    });

    it('should handle arrays in JSON', () => {
      const log = 'TESTLETS_CLEARED_CODE : "[\\"SFB_FRZ\\",\\"post_questionnaire\\"]"';
      expect(parse(log)).toEqual({ key: 'TESTLETS_CLEARED_CODE', value: '["SFB_FRZ","post_questionnaire"]' });
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
});
