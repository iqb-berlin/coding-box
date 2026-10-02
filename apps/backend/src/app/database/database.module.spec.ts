import {
  buildPostgresConnectionOptions,
  parsePostgresIdleInTransactionTimeout,
  parsePostgresPoolMax
} from './database.module';

describe('DatabaseModule configuration', () => {
  it('uses a positive configured PostgreSQL pool size', () => {
    expect(parsePostgresPoolMax('4')).toBe(4);
  });

  it('falls back for missing or invalid PostgreSQL pool sizes', () => {
    expect(parsePostgresPoolMax(undefined)).toBe(10);
    expect(parsePostgresPoolMax('0')).toBe(10);
    expect(parsePostgresPoolMax('not-a-number')).toBe(10);
  });

  it('uses a non-negative configured idle-in-transaction timeout', () => {
    expect(parsePostgresIdleInTransactionTimeout('30000')).toBe(30_000);
    expect(parsePostgresIdleInTransactionTimeout('0')).toBe(0);
  });

  it('falls back for missing or invalid idle-in-transaction timeouts', () => {
    expect(parsePostgresIdleInTransactionTimeout(undefined)).toBe(900_000);
    expect(parsePostgresIdleInTransactionTimeout('-1')).toBe(900_000);
    expect(parsePostgresIdleInTransactionTimeout('15min')).toBe(900_000);
    expect(parsePostgresIdleInTransactionTimeout('1.5')).toBe(900_000);
    expect(parsePostgresIdleInTransactionTimeout('900000foo')).toBe(900_000);
    expect(parsePostgresIdleInTransactionTimeout('not-a-number')).toBe(900_000);
  });

  it('preserves existing PostgreSQL options and appends the transaction timeout', () => {
    expect(buildPostgresConnectionOptions('-c jit=off', '30000')).toBe(
      '-c jit=off -c idle_in_transaction_session_timeout=30000'
    );
  });

  it('can disable the transaction timeout for long-running export snapshots', () => {
    expect(buildPostgresConnectionOptions('-c jit=off', '0')).toBe(
      '-c jit=off -c idle_in_transaction_session_timeout=0'
    );
  });
});
