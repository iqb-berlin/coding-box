import { withWorkspaceTestResultsMutationLock } from './workspace-test-results-lock.util';

describe('workspace test results mutation lock', () => {
  it('releases the query runner when advisory lock acquisition fails', async () => {
    const lockError = new Error('lock failed');
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValueOnce(lockError),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue('done');

    await expect(withWorkspaceTestResultsMutationLock(
      connection as never,
      1,
      callback
    )).rejects.toThrow(lockError);

    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('unlocks and releases after a successful callback', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    await expect(withWorkspaceTestResultsMutationLock(
      connection as never,
      2,
      async () => 'done'
    )).resolves.toBe('done');

    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
