import { DataSource } from 'typeorm';
import { WorkspaceCodingStatusMutationService } from './workspace-coding-status-mutation.service';

describe('WorkspaceCodingStatusMutationService', () => {
  const createHarness = (options: {
    expired?: boolean;
    failed?: boolean;
    poolMax?: number;
  } = {}) => {
    let nextRevision = 4;
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: true }]);
        }
        if (sql.includes('latest_expired')) {
          return Promise.resolve(options.expired ? [{ workspace_id: 3 }] : []);
        }
        if (sql.includes('SELECT next_revision.revision')) {
          const revision = nextRevision;
          nextRevision += 1;
          return Promise.resolve([{ revision }]);
        }
        return Promise.resolve([]);
      }),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      options: { extra: { max: options.poolMax ?? 10 } },
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT failed_test_results_revision')) {
          return Promise.resolve(options.failed || options.expired ? [{
            failed_test_results_revision: 3
          }] : []);
        }
        if (sql.includes('SELECT unit_record.id')) {
          return Promise.resolve([{ id: 11 }, { id: '12' }]);
        }
        if (sql.includes('SELECT revision FROM workspace_test_results_revision')) {
          return Promise.resolve([{ revision: 7 }]);
        }
        if (sql.includes('RETURNING status_revision.workspace_id')) {
          return Promise.resolve([[{ workspace_id: 3 }], 1]);
        }
        return Promise.resolve([]);
      })
    } as unknown as DataSource;
    const codingFreshnessService = {
      markUnitsStaleAfterResultChange: jest.fn().mockResolvedValue(undefined)
    };
    const moduleRef = {
      get: jest.fn().mockReturnValue(codingFreshnessService)
    };
    const service = new WorkspaceCodingStatusMutationService(
      connection,
      moduleRef as never
    );
    return {
      codingFreshnessService,
      connection,
      queryRunner,
      service
    };
  };

  it('runs a mutation under one advisory lock and completes its lease', async () => {
    const { queryRunner, service } = createHarness();
    const mutation = jest.fn().mockResolvedValue('done');

    await expect(service.run(3, mutation)).resolves.toBe('done');

    expect(mutation).toHaveBeenCalledWith({ revision: 4 });
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('processed_test_results_revision = GREATEST'),
      [3, 4]
    );
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('queues same-workspace mutations before reserving another connection', async () => {
    const { connection, service } = createHarness();
    let signalFirstMutationStarted: (() => void) | undefined;
    const firstMutationStarted = new Promise<void>(resolve => {
      signalFirstMutationStarted = resolve;
    });
    let continueFirstMutation: (() => void) | undefined;
    const firstMutationGate = new Promise<void>(resolve => {
      continueFirstMutation = resolve;
    });
    const secondMutation = jest.fn().mockResolvedValue(undefined);

    const first = service.run(3, async () => {
      signalFirstMutationStarted?.();
      await firstMutationGate;
    });
    await firstMutationStarted;

    const second = service.run(3, secondMutation);
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(secondMutation).not.toHaveBeenCalled();

    continueFirstMutation?.();
    await Promise.all([first, second]);

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(secondMutation).toHaveBeenCalledTimes(1);
  });

  it('reserves half of the configured pool across both lock entry points', async () => {
    const { connection, service } = createHarness({ poolMax: 2 });
    let signalFirstMutationStarted: (() => void) | undefined;
    const firstMutationStarted = new Promise<void>(resolve => {
      signalFirstMutationStarted = resolve;
    });
    let continueFirstMutation: (() => void) | undefined;
    const firstMutationGate = new Promise<void>(resolve => {
      continueFirstMutation = resolve;
    });
    const secondMutation = jest.fn().mockResolvedValue(undefined);

    const first = service.run(3, async () => {
      signalFirstMutationStarted?.();
      await firstMutationGate;
    });
    await firstMutationStarted;

    const second = service.withWorkspaceLock(4, secondMutation);
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(secondMutation).not.toHaveBeenCalled();

    continueFirstMutation?.();
    await Promise.all([first, second]);

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(secondMutation).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3, 4, 10])(
    'limits concurrent workspace locks for pool size %i without losing slots',
    async poolMax => {
      const { connection, service } = createHarness({ poolMax });
      const expectedParallelLocks = Math.floor(poolMax / 2);
      const operationCount = expectedParallelLocks + 2;
      const releases: Array<(() => void) | undefined> = [];
      const operations = Array.from({ length: operationCount }, (_, index) => (
        service.withWorkspaceLock(100 + index, () => new Promise<void>(resolve => {
          releases[index] = resolve;
        }))
      ));

      while (releases.filter(Boolean).length < expectedParallelLocks) {
        await new Promise<void>(resolve => {
          setImmediate(resolve);
        });
      }
      expect(connection.createQueryRunner)
        .toHaveBeenCalledTimes(expectedParallelLocks);

      let releasedCount = 0;
      let startedCount = expectedParallelLocks;
      while (startedCount < operationCount) {
        releases.slice(releasedCount, startedCount)
          .forEach(release => release?.());
        releasedCount = startedCount;
        startedCount = Math.min(
          operationCount,
          startedCount + expectedParallelLocks
        );
        while (releases.filter(Boolean).length < startedCount) {
          await new Promise<void>(resolve => {
            setImmediate(resolve);
          });
        }
      }
      releases.slice(releasedCount).forEach(release => release?.());
      await Promise.all(operations);

      expect(connection.createQueryRunner).toHaveBeenCalledTimes(operationCount);
    }
  );

  it('rejects a pool that cannot reserve a separate work connection', () => {
    expect(() => createHarness({ poolMax: 1 })).toThrow(
      'must provide at least 2 connections'
    );
  });

  it('releases a blocking lock slot when query runner creation throws', async () => {
    const { connection, service } = createHarness({ poolMax: 2 });
    const createQueryRunner = connection.createQueryRunner as jest.Mock;
    const queryRunner = createQueryRunner.getMockImplementation()?.();
    createQueryRunner
      .mockReset()
      .mockImplementationOnce(() => {
        throw new Error('query runner unavailable');
      })
      .mockReturnValueOnce(queryRunner);

    await expect(service.run(3, async () => undefined))
      .rejects.toThrow('query runner unavailable');
    await expect(service.run(4, async () => 'recovered'))
      .resolves.toBe('recovered');

    expect(createQueryRunner).toHaveBeenCalledTimes(2);
  });

  it('releases a non-blocking lock slot when query runner creation throws', async () => {
    const { connection, service } = createHarness({ poolMax: 2 });
    const createQueryRunner = connection.createQueryRunner as jest.Mock;
    const queryRunner = createQueryRunner.getMockImplementation()?.();
    createQueryRunner
      .mockReset()
      .mockImplementationOnce(() => {
        throw new Error('query runner unavailable');
      })
      .mockReturnValueOnce(queryRunner);

    await expect(service.recoverExpired(3))
      .rejects.toThrow('query runner unavailable');
    await expect(service.recoverExpired(4)).resolves.toBe(false);

    expect(createQueryRunner).toHaveBeenCalledTimes(2);
  });

  it('uses a non-blocking transaction lock outside a workspace lock', async () => {
    const { service } = createHarness();
    const manager = {
      query: jest.fn().mockResolvedValue([{ locked: false }])
    };

    await expect(service.lockInTransaction(manager as never, 3))
      .rejects.toThrow('currently being modified');
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS locked',
      expect.any(Array)
    );
  });

  it('reuses a workspace lock for a transaction without locking again', async () => {
    const { service } = createHarness();
    const manager = { query: jest.fn() };

    await service.withWorkspaceLock(3, async () => {
      await service.lockInTransaction(manager as never, 3);
    });

    expect(manager.query).not.toHaveBeenCalled();
  });

  it('runs a coding-status mutation inside an existing workspace lock', async () => {
    const { connection, service } = createHarness();
    const mutation = jest.fn().mockResolvedValue(undefined);

    await service.withWorkspaceLock(3, () => service.run(3, mutation));

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith({ revision: 4 });
  });

  it('reuses the active workspace operation for nested mutations', async () => {
    const { queryRunner, service } = createHarness();

    await service.run(3, async outerOperation => {
      await service.run(3, async innerOperation => {
        expect(innerOperation).toBe(outerOperation);
      });
    });

    const beginCalls = queryRunner.query.mock.calls.filter(([sql]) => (
      String(sql).includes('SELECT next_revision.revision')
    ));
    expect(beginCalls).toHaveLength(1);
  });

  it('does not reuse a context after its advisory lock was released', async () => {
    const { connection, service } = createHarness();
    let continueDetachedTask: (() => void) | undefined;
    const detachedTaskGate = new Promise<void>(resolve => {
      continueDetachedTask = resolve;
    });
    let detachedMutation: Promise<void> | undefined;

    await service.run(3, async () => {
      detachedMutation = (async () => {
        await detachedTaskGate;
        await service.run(3, async () => undefined);
      })();
    });

    continueDetachedTask?.();
    await detachedMutation;

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
  });

  it('keeps the lock until a started detached nested mutation settles', async () => {
    const { queryRunner, service } = createHarness();
    let continueNestedMutation: (() => void) | undefined;
    const nestedMutationGate = new Promise<void>(resolve => {
      continueNestedMutation = resolve;
    });
    let signalNestedMutationStarted: (() => void) | undefined;
    const nestedMutationStarted = new Promise<void>(resolve => {
      signalNestedMutationStarted = resolve;
    });
    let detachedMutation: Promise<void> | undefined;

    const outerMutation = service.run(3, async () => {
      detachedMutation = service.run(3, async () => {
        signalNestedMutationStarted?.();
        await nestedMutationGate;
      });
    });

    await nestedMutationStarted;
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });

    expect(queryRunner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('processed_test_results_revision = GREATEST'),
      [3, 4]
    );
    expect(queryRunner.query).not.toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );

    continueNestedMutation?.();
    await detachedMutation;
    await outerMutation;

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('processed_test_results_revision = GREATEST'),
      [3, 4]
    );
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
  });

  it('starts a delayed mutation in a new cycle after failure closes the operation', async () => {
    const { connection, queryRunner, service } = createHarness();
    const connectionQuery = connection.query as jest.Mock;
    const defaultConnectionQuery = connectionQuery.getMockImplementation();
    let failureCheckCount = 0;
    let signalRecoveryStarted: (() => void) | undefined;
    const recoveryStarted = new Promise<void>(resolve => {
      signalRecoveryStarted = resolve;
    });
    let continueRecovery: (() => void) | undefined;
    const recoveryGate = new Promise<void>(resolve => {
      continueRecovery = resolve;
    });
    connectionQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT failed_test_results_revision')) {
        failureCheckCount += 1;
        if (failureCheckCount === 1) {
          return Promise.resolve([]);
        }
        if (failureCheckCount === 2) {
          signalRecoveryStarted?.();
          return recoveryGate.then(() => [{
            failed_test_results_revision: 4
          }]);
        }
        return Promise.resolve([]);
      }
      return defaultConnectionQuery ?
        defaultConnectionQuery(sql) : Promise.resolve([]);
    });

    const secondQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('latest_expired')) {
          return Promise.resolve([]);
        }
        if (sql.includes('SELECT next_revision.revision')) {
          return Promise.resolve([{ revision: 10 }]);
        }
        return Promise.resolve([]);
      }),
      release: jest.fn().mockResolvedValue(undefined)
    };
    (connection.createQueryRunner as jest.Mock)
      .mockReset()
      .mockReturnValueOnce(queryRunner)
      .mockReturnValueOnce(secondQueryRunner);

    let startDelayedMutation: (() => void) | undefined;
    const delayedMutationGate = new Promise<void>(resolve => {
      startDelayedMutation = resolve;
    });
    const delayedMutation = jest.fn().mockResolvedValue(undefined);
    let detachedMutation: Promise<void> | undefined;

    const outerMutation = service.run(3, async () => {
      detachedMutation = (async () => {
        await delayedMutationGate;
        await service.run(3, delayedMutation);
      })();
      try {
        await service.run(3, async () => {
          throw new Error('nested failure');
        });
      } catch {
        // The outer mutation handles the nested error.
      }
    });

    await recoveryStarted;
    startDelayedMutation?.();
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(delayedMutation).not.toHaveBeenCalled();

    continueRecovery?.();
    await outerMutation;
    await detachedMutation;

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(delayedMutation).toHaveBeenCalledWith({ revision: 10 });
    expect(secondQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('records a nested failure even when the outer mutation handles it', async () => {
    const {
      codingFreshnessService,
      queryRunner,
      service
    } = createHarness({ failed: true });

    await expect(service.run(3, async () => {
      try {
        await service.run(3, async () => {
          throw new Error('freshness failed');
        });
      } catch {
        // The caller can return a warning while coordination still recovers.
      }
      return 'saved-with-warning';
    })).resolves.toBe('saved-with-warning');

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('failed_test_results_revision = GREATEST'),
      [3, 5]
    );
    expect(queryRunner.query).not.toHaveBeenCalledWith(
      expect.stringContaining('processed_test_results_revision = GREATEST'),
      [3, 5]
    );
    expect(codingFreshnessService.markUnitsStaleAfterResultChange)
      .toHaveBeenCalledWith(3, [11, 12], 'RESULT_UPDATED');
  });

  it('records expired leases and reconciles them before a new mutation', async () => {
    const {
      codingFreshnessService,
      queryRunner,
      service
    } = createHarness({ expired: true });

    await service.run(3, async () => undefined);

    const sqlStatements = queryRunner.query.mock.calls
      .map(([sql]) => String(sql));
    const expiredIndex = sqlStatements.findIndex(sql => (
      sql.includes('latest_expired')
    ));
    const beginIndex = sqlStatements.findIndex(sql => (
      sql.includes('SELECT next_revision.revision')
    ));
    expect(expiredIndex).toBeGreaterThan(-1);
    expect(beginIndex).toBeGreaterThan(expiredIndex);
    expect(sqlStatements[beginIndex]).not.toContain('expired_operations');
    expect(codingFreshnessService.markUnitsStaleAfterResultChange)
      .toHaveBeenCalledWith(3, [11, 12], 'RESULT_UPDATED');
  });

  it('preserves the mutation error after recording and reconciling failure', async () => {
    const {
      codingFreshnessService,
      queryRunner,
      service
    } = createHarness({ failed: true });
    const mutationError = new Error('mutation failed');

    await expect(service.run(3, async () => {
      throw mutationError;
    })).rejects.toBe(mutationError);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('failed_test_results_revision = GREATEST'),
      [3, 5]
    );
    expect(codingFreshnessService.markUnitsStaleAfterResultChange)
      .toHaveBeenCalledWith(3, [11, 12], 'RESULT_UPDATED');
  });

  it('recovers an expired operation only while the workspace lock is available', async () => {
    const { queryRunner, service } = createHarness({ expired: true });

    await expect(service.recoverExpired(3)).resolves.toBe(true);

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      expect.any(Array)
    );
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('returns zero when no workspace revision exists', async () => {
    const { connection, service } = createHarness();
    (connection.query as jest.Mock).mockResolvedValueOnce([]);

    await expect(service.getRevision(3)).resolves.toBe(0);
  });
});
