describe('cache startup warmup queue', () => {
  async function loadQueue() {
    jest.resetModules();
    return import('./cache-startup-warmup.queue');
  }

  it('waits for readiness release and executes warmups serially', async () => {
    const queue = await loadQueue();
    const events: string[] = [];
    let finishFirst: (() => void) | undefined;

    const first = queue.enqueueCacheStartupWarmup(async () => {
      events.push('first-start');
      await new Promise<void>(resolve => {
        finishFirst = resolve;
      });
      events.push('first-finish');
    });
    const second = queue.enqueueCacheStartupWarmup(async () => {
      events.push('second');
    });

    await Promise.resolve();
    expect(events).toEqual([]);

    queue.releaseCacheStartupWarmups();
    await Promise.resolve();
    expect(events).toEqual(['first-start']);

    finishFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-finish', 'second']);
  });

  it('continues with later warmups after a failed warmup', async () => {
    const queue = await loadQueue();
    const secondWarmup = jest.fn().mockResolvedValue(undefined);

    const first = queue.enqueueCacheStartupWarmup(async () => {
      throw new Error('warmup failed');
    });
    const second = queue.enqueueCacheStartupWarmup(secondWarmup);

    queue.releaseCacheStartupWarmups();

    await expect(first).rejects.toThrow('warmup failed');
    await expect(second).resolves.toBeUndefined();
    expect(secondWarmup).toHaveBeenCalledTimes(1);
  });

  it('starts newly queued warmups after readiness was released', async () => {
    const queue = await loadQueue();
    queue.releaseCacheStartupWarmups();

    const warmup = jest.fn().mockResolvedValue(undefined);
    await queue.enqueueCacheStartupWarmup(warmup);

    expect(warmup).toHaveBeenCalledTimes(1);
  });
});
