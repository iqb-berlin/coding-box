import {
  tryWithWorkspaceFilesMutationLock,
  withWorkspaceFilesMutationLock
} from './workspace-files-lock.util';

describe('workspace files mutation lock', () => {
  it('unlocks and releases after a successful mutation', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    await expect(
      withWorkspaceFilesMutationLock(
        connection as never,
        7,
        async () => 'done'
      )
    ).resolves.toBe('done');

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_lock($1::int, $2::int)',
      [774020252, 7]
    );
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      [774020252, 7]
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases the query runner if lock acquisition fails', async () => {
    const lockError = new Error('lock failed');
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValueOnce(lockError),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    await expect(
      withWorkspaceFilesMutationLock(connection as never, 7, async () => 'done')
    ).rejects.toBe(lockError);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('returns without mutating when the try-lock is occupied', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ locked: false }]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue(undefined);

    await expect(tryWithWorkspaceFilesMutationLock(
      connection as never,
      7,
      callback
    )).resolves.toEqual({ acquired: false });

    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('passes the locked session to a successful try-lock callback', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ pg_advisory_unlock: true }]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    await expect(tryWithWorkspaceFilesMutationLock(
      connection as never,
      7,
      async callbackQueryRunner => {
        expect(callbackQueryRunner).toBe(queryRunner);
        return 'done';
      }
    )).resolves.toEqual({ acquired: true, value: 'done' });

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      [774020252, 7]
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
