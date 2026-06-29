import { parsePostgresPoolMax } from './database.module';

describe('DatabaseModule configuration', () => {
  it('uses a positive configured PostgreSQL pool size', () => {
    expect(parsePostgresPoolMax('4')).toBe(4);
  });

  it('falls back for missing or invalid PostgreSQL pool sizes', () => {
    expect(parsePostgresPoolMax(undefined)).toBe(10);
    expect(parsePostgresPoolMax('0')).toBe(10);
    expect(parsePostgresPoolMax('not-a-number')).toBe(10);
  });
});
