import {
  getWorkspaceCodingStatusRevision,
  touchWorkspaceCodingStatusRevision
} from './workspace-coding-status-revision.util';

describe('workspace coding status revision', () => {
  it('increments only the status revision', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await touchWorkspaceCodingStatusRevision(executor, 7);

    expect(executor.query).toHaveBeenCalledWith(
      expect.stringContaining('status_revision'),
      [7]
    );
  });

  it('returns a stable revision while no exclusive mutation lock is held', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ revision: '12', status_revision: '34' }])
        .mockResolvedValueOnce([]),
      release: jest.fn().mockResolvedValue(undefined)
    };

    await expect(
      getWorkspaceCodingStatusRevision(
        {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        },
        7
      )
    ).resolves.toEqual({
      revision: 12,
      statusRevision: '34',
      stable: true
    });

    expect(queryRunner.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock_shared'),
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('marks the revision unstable while an exclusive mutation lock is held', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: false }])
        .mockResolvedValueOnce([]),
      release: jest.fn().mockResolvedValue(undefined)
    };

    await expect(
      getWorkspaceCodingStatusRevision(
        {
          createQueryRunner: jest.fn().mockReturnValue(queryRunner)
        },
        7
      )
    ).resolves.toEqual({
      revision: 0,
      statusRevision: '0',
      stable: false
    });

    expect(queryRunner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock_shared'),
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
