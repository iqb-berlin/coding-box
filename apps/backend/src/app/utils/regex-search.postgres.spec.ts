import { DataSource } from 'typeorm';
import {
  InvalidRegexSearchPatternException,
  validatePostgresRegexSearchPatterns,
  withRegexSearchStatementTimeout
} from './regex-search.util';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ?
  describe :
  describe.skip;

const postgresConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  username: process.env.POSTGRES_USER || 'root',
  password: process.env.POSTGRES_PASSWORD || 'root-password',
  database: process.env.POSTGRES_DB || 'coding-box'
};

describePostgres('PostgreSQL regex search validation', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...postgresConfig
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('accepts a valid PostgreSQL pattern', async () => {
    await expect(withRegexSearchStatementTimeout(
      dataSource,
      runner => validatePostgresRegexSearchPatterns(runner, [{
        fieldName: 'response',
        pattern: '^VAR_[[:digit:]]+$'
      }])
    )).resolves.toBeUndefined();
  });

  it('rejects a JavaScript-valid but PostgreSQL-invalid named group', async () => {
    expect.assertions(2);

    try {
      await withRegexSearchStatementTimeout(
        dataSource,
        runner => validatePostgresRegexSearchPatterns(runner, [{
          fieldName: 'response',
          pattern: '(?<name>a)'
        }])
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRegexSearchPatternException);
      expect((error as InvalidRegexSearchPatternException).getResponse())
        .toEqual(expect.objectContaining({
          statusCode: 400,
          code: 'INVALID_REGEX',
          field: 'response'
        }));
    }
  });

  it('searches long response values within the first 2000 characters', async () => {
    const earlyMatchValue = `needle${'x'.repeat(2494)}`;
    const lateMatchValue = `${'x'.repeat(2100)}needle`;

    const [result] = await dataSource.query(
      `SELECT
        LEFT($1::text, 2000) ILIKE $3::text AS "earlyMatch",
        LEFT($2::text, 2000) ILIKE $3::text AS "lateMatch"`,
      [earlyMatchValue, lateMatchValue, '%needle%']
    );

    expect(result).toEqual({ earlyMatch: true, lateMatch: false });
  });
});
