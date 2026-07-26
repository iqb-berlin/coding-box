import { Repository } from 'typeorm';
import Persons from '../database/entities/persons.entity';
import {
  WorkspaceCacheWarmupOptions,
  WorkspaceCacheWarmupRunner
} from './workspace-cache-warmup.runner';

describe('WorkspaceCacheWarmupRunner', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn()
  };

  function createRunner(workspaceIds: number[]): WorkspaceCacheWarmupRunner {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(
        workspaceIds.map(workspace_id => ({ workspace_id }))
      )
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    } as unknown as Repository<Persons>;
    return new WorkspaceCacheWarmupRunner(repository);
  }

  function createOptions(
    warmWorkspace: (workspaceId: number) => Promise<void>
  ): WorkspaceCacheWarmupOptions {
    return {
      key: 'test-warmup',
      description: 'test data',
      logger,
      warmWorkspace
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shares an active run for the same warmup key', async () => {
    let releaseWorkspace: (() => void) | undefined;
    const workspacePending = new Promise<void>(resolve => {
      releaseWorkspace = resolve;
    });
    const warmWorkspace = jest.fn().mockReturnValue(workspacePending);
    const runner = createRunner([1]);
    const options = createOptions(warmWorkspace);

    const firstRun = runner.run(options);
    const secondRun = runner.run(options);

    expect(secondRun).toBe(firstRun);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('previous run is still active')
    );

    releaseWorkspace?.();
    await firstRun;
    expect(warmWorkspace).toHaveBeenCalledTimes(1);
  });

  it('continues with the next workspace after an error', async () => {
    const warmWorkspace = jest.fn()
      .mockRejectedValueOnce(new Error('workspace failed'))
      .mockResolvedValueOnce(undefined);
    const runner = createRunner([1, 2]);

    await runner.run(createOptions(warmWorkspace));

    expect(warmWorkspace).toHaveBeenNthCalledWith(1, 1);
    expect(warmWorkspace).toHaveBeenNthCalledWith(2, 2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('workspace failed'),
      expect.any(String)
    );
  });
});
