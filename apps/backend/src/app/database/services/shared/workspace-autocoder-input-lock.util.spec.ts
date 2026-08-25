import {
  tryWithWorkspaceAutocoderInputMutationLocks
} from './workspace-autocoder-input-lock.util';

describe('workspace Autocoder input mutation locks', () => {
  it('sorts and acquires result locks before file locks on one session', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return [{ locked: true }];
        }
        return [];
      }),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    await expect(tryWithWorkspaceAutocoderInputMutationLocks(
      connection as never,
      [9, 3, 9],
      async callbackQueryRunner => {
        expect(callbackQueryRunner).toBe(queryRunner);
        return 'done';
      }
    )).resolves.toEqual({ acquired: true, value: 'done' });

    expect(queryRunner.query.mock.calls).toEqual([
      ['SELECT pg_try_advisory_lock($1::int, $2::int) AS locked', [774020251, 3]],
      ['SELECT pg_try_advisory_lock($1::int, $2::int) AS locked', [774020251, 9]],
      ['SELECT pg_try_advisory_lock($1::int, $2::int) AS locked', [774020252, 3]],
      ['SELECT pg_try_advisory_lock($1::int, $2::int) AS locked', [774020252, 9]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020252, 9]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020252, 3]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020251, 9]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020251, 3]]
    ]);
    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases partially acquired locks when a file try-lock is occupied', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ locked: false }])
        .mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue(undefined);

    await expect(tryWithWorkspaceAutocoderInputMutationLocks(
      connection as never,
      [3, 9],
      callback
    )).resolves.toEqual({ acquired: false });

    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.query.mock.calls.slice(4)).toEqual([
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020252, 3]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020251, 9]],
      ['SELECT pg_advisory_unlock($1::int, $2::int)', [774020251, 3]]
    ]);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
