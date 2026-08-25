import {
  tryWithWorkspaceTestResultsMutationLock,
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
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };

    const callback = jest.fn().mockResolvedValue('done');

    await expect(withWorkspaceTestResultsMutationLock(
      connection as never,
      2,
      callback
    )).resolves.toBe('done');

    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(callback).toHaveBeenCalledWith(queryRunner);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('continues the blocking mutation queue after a callback fails', async () => {
    const callbackError = new Error('callback failed');
    let rejectFirstCallback: (error: Error) => void = () => undefined;
    let markFirstCallbackStarted: () => void = () => undefined;
    const firstCallbackStarted = new Promise<void>(resolve => {
      markFirstCallbackStarted = resolve;
    });
    const firstCallbackPending = new Promise<never>((_resolve, reject) => {
      rejectFirstCallback = reject;
    });
    const queryRunners = [1, 2].map(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    }));
    const connection = {
      options: { type: 'postgres', extra: { max: 2 } },
      createQueryRunner: jest.fn()
        .mockReturnValueOnce(queryRunners[0])
        .mockReturnValueOnce(queryRunners[1])
    };
    const secondCallback = jest.fn().mockResolvedValue('second done');

    const firstMutation = withWorkspaceTestResultsMutationLock(
      connection as never,
      5,
      () => {
        markFirstCallbackStarted();
        return firstCallbackPending;
      }
    );
    const secondMutation = withWorkspaceTestResultsMutationLock(
      connection as never,
      6,
      secondCallback
    );

    await firstCallbackStarted;
    expect(connection.createQueryRunner).toHaveBeenCalledTimes(1);

    rejectFirstCallback(callbackError);

    await expect(firstMutation).rejects.toThrow(callbackError);
    await expect(secondMutation).resolves.toBe('second done');
    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
    expect(secondCallback).toHaveBeenCalledWith(queryRunners[1]);
    expect(queryRunners[0].release).toHaveBeenCalledTimes(1);
    expect(queryRunners[1].release).toHaveBeenCalledTimes(1);
  });

  it('allows independent mutations up to the reserved pool limit', async () => {
    let releaseCallbacks: () => void = () => undefined;
    const callbacksPending = new Promise<void>(resolve => {
      releaseCallbacks = resolve;
    });
    let enteredCallbacks = 0;
    let markAllCallbacksEntered: () => void = () => undefined;
    const allCallbacksEntered = new Promise<void>(resolve => {
      markAllCallbacksEntered = resolve;
    });
    const queryRunners = [1, 2].map(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined)
    }));
    const connection = {
      options: { type: 'postgres', extra: { max: 3 } },
      createQueryRunner: jest.fn()
        .mockReturnValueOnce(queryRunners[0])
        .mockReturnValueOnce(queryRunners[1])
    };
    const callbacks = queryRunners.map(() => jest.fn(async () => {
      enteredCallbacks += 1;
      if (enteredCallbacks === queryRunners.length) {
        markAllCallbacksEntered();
      }
      return callbacksPending;
    }));

    const mutations = callbacks.map((callback, index) => (
      withWorkspaceTestResultsMutationLock(
        connection as never,
        index + 7,
        callback
      )
    ));

    await allCallbacksEntered;

    expect(connection.createQueryRunner).toHaveBeenCalledTimes(2);
    callbacks.forEach(callback => expect(callback).toHaveBeenCalledTimes(1));

    releaseCallbacks();
    await expect(Promise.all(mutations)).resolves.toEqual([
      undefined,
      undefined
    ]);
  });

  it('returns immediately without calling back when the try-lock is occupied', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ locked: false }]),
      release: jest.fn().mockResolvedValue(undefined)
    };
    const connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    };
    const callback = jest.fn().mockResolvedValue('done');

    await expect(tryWithWorkspaceTestResultsMutationLock(
      connection as never,
      3,
      callback
    )).resolves.toEqual({ acquired: false });

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
      expect.any(Array)
    );
    expect(callback).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('unlocks and releases after a successful try-lock callback', async () => {
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

    const callback = jest.fn().mockResolvedValue('done');

    await expect(tryWithWorkspaceTestResultsMutationLock(
      connection as never,
      4,
      callback
    )).resolves.toEqual({ acquired: true, value: 'done' });

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::int, $2::int)',
      expect.any(Array)
    );
    expect(callback).toHaveBeenCalledWith(queryRunner);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
