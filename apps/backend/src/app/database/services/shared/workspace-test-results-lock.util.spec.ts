import {
  clearWorkspaceCodingStatusRevisionFailureAfterReconciliation,
  failExpiredWorkspaceCodingStatusRevisionOperations,
  withWorkspaceTestResultsAdvisoryLockIfAvailable,
  withWorkspaceTestResultsMutationLock
} from './workspace-test-results-lock.util';

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
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          revision: 4
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
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
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workspace_coding_status_revision_operation'),
      [2]
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('processed_test_results_revision = GREATEST'),
      [2, 4]
    );
    const completionSql = (queryRunner.query as jest.Mock).mock.calls[2][0] as string;
    expect(completionSql).not.toContain('failed_test_results_revision = CASE');
    expect(completionSql).not.toContain('last_test_result_update_failed_at = CASE');
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the revision lease cannot be read back', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue('done');

    await expect(withWorkspaceTestResultsMutationLock(
      connection as never,
      5,
      callback
    )).rejects.toThrow(
      'Could not start coding status revision operation for workspace 5.'
    );

    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('records a failed outer status operation before releasing the lock', async () => {
    const callbackError = new Error('mutation failed');
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          revision: 7
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    const recoverAfterFailure = jest.fn().mockResolvedValue(undefined);
    await expect(withWorkspaceTestResultsMutationLock(
      connection as never,
      3,
      async () => {
        throw callbackError;
      },
      {
        recoverAfterFailure
      }
    )).rejects.toBe(callbackError);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('failed_test_results_revision = GREATEST'),
      [3, 7]
    );
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(recoverAfterFailure).toHaveBeenCalledTimes(1);
  });

  it('clears a recorded failure only after the reconciled revision is current and idle', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue([{ workspace_id: 3 }])
    };

    await expect(
      clearWorkspaceCodingStatusRevisionFailureAfterReconciliation(
        executor as never,
        3,
        9
      )
    ).resolves.toBe(true);

    const sql = executor.query.mock.calls[0][0] as string;
    expect(sql).toContain('failed_test_results_revision <= $2');
    expect(sql).toContain('processed_test_results_revision = $2');
    expect(sql).toContain('test_revision.revision = $2');
    expect(sql).toContain('workspace_coding_status_revision_operation');
    expect(sql).toContain('failed_test_results_revision = NULL');
    expect(executor.query).toHaveBeenCalledWith(expect.any(String), [3, 9]);
  });

  it('turns expired operations into a recorded failure before deleting them', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue([{ workspace_id: 3 }])
    };

    await expect(
      failExpiredWorkspaceCodingStatusRevisionOperations(
        executor as never,
        3
      )
    ).resolves.toBe(true);

    const sql = executor.query.mock.calls[0][0] as string;
    expect(sql).toContain("started_at < now() - interval '24 hours'");
    expect(sql).toContain('MAX(test_results_revision)');
    expect(sql).toContain('failed_test_results_revision');
    expect(executor.query).toHaveBeenCalledWith(expect.any(String), [3]);
  });

  it('runs maintenance only while the workspace advisory lock is available', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue('recovered');

    await expect(withWorkspaceTestResultsAdvisoryLockIfAvailable(
      connection as never,
      4,
      callback
    )).resolves.toBe('recovered');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      expect.any(Array)
    );
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('skips maintenance when another process owns the workspace lock', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValueOnce([{ locked: false }]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn();

    await expect(withWorkspaceTestResultsAdvisoryLockIfAvailable(
      connection as never,
      4,
      callback
    )).resolves.toBeUndefined();

    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
