import { withWorkspaceFilesMutationLock } from './workspace-files-lock.util';

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
      withWorkspaceFilesMutationLock(connection as never, 7, async () => 'done')
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
});
