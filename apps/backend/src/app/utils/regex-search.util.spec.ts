import {
  assertValidRegexSearchPattern,
  InvalidRegexSearchPatternException,
  REGEX_SEARCH_PATTERN_MAX_LENGTH,
  toInvalidRegexSearchPatternException,
  toRegexSearchException,
  withRegexSearchStatementTimeout
} from './regex-search.util';

describe('regex-search.util', () => {
  it('keeps normalized patterns for PostgreSQL query usage', () => {
    expect(assertValidRegexSearchPattern('(?=A)A', 'variableId')).toBe('(?=A)A');
  });

  it('does not use JavaScript regex parsing for PostgreSQL patterns', () => {
    expect(assertValidRegexSearchPattern('[', 'variableId')).toBe('[');
  });

  it('rejects patterns that exceed the configured length limit', () => {
    const oversizedPattern = 'a'.repeat(REGEX_SEARCH_PATTERN_MAX_LENGTH + 1);

    expect(() => assertValidRegexSearchPattern(oversizedPattern, 'variableId'))
      .toThrow(`pattern must not exceed ${REGEX_SEARCH_PATTERN_MAX_LENGTH} characters`);
  });

  it('converts PostgreSQL invalid regex errors into bad request exceptions', () => {
    const error = toInvalidRegexSearchPatternException(
      {
        code: '2201B',
        message: 'invalid regular expression: quantifier operand invalid'
      },
      'variableId'
    );

    expect(error).toBeInstanceOf(InvalidRegexSearchPatternException);
    expect(error?.getStatus()).toBe(400);
    expect(error?.message).toContain('variableId');
  });

  it('converts PostgreSQL statement timeouts into bad request exceptions', () => {
    const error = toRegexSearchException({
      code: '57014',
      message: 'canceling statement due to statement timeout'
    });

    expect(error?.getStatus()).toBe(400);
    expect(error?.message).toContain('timed out');
  });

  it('runs work inside a transaction with a local statement timeout', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const work = jest.fn().mockResolvedValue('done');

    await expect(
      withRegexSearchStatementTimeout(dataSource, work, 1234)
    ).resolves.toBe('done');

    expect(queryRunner.query).toHaveBeenCalledWith(
      "SET LOCAL statement_timeout = '1234ms'"
    );
    expect(work).toHaveBeenCalledWith(queryRunner);
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });
});
