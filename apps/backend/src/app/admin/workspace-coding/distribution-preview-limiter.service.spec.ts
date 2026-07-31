import { HttpStatus, Logger, RequestTimeoutException } from '@nestjs/common';
import { DistributionPreviewLimiterService } from './distribution-preview-limiter.service';

describe('DistributionPreviewLimiterService', () => {
  let service: DistributionPreviewLimiterService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new DistributionPreviewLimiterService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs at most two distribution previews concurrently', async () => {
    const releases: Array<() => void> = [];
    let activePreviews = 0;
    let maximumActivePreviews = 0;
    const execute = jest.fn((result: number) => new Promise<number>(resolve => {
      activePreviews += 1;
      maximumActivePreviews = Math.max(
        maximumActivePreviews,
        activePreviews
      );
      releases.push(() => {
        activePreviews -= 1;
        resolve(result);
      });
    }));

    const first = service.run(() => execute(1));
    const second = service.run(() => execute(2));
    const third = service.run(() => execute(3));

    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(maximumActivePreviews).toBe(2);

    releases.shift()?.();
    await first;
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(maximumActivePreviews).toBe(2);

    releases.forEach(release => release());
    await expect(Promise.all([second, third])).resolves.toEqual([2, 3]);
  });

  it('does not start a queued preview after its client disconnects', async () => {
    const releases: Array<() => void> = [];
    const execute = jest.fn((result: number) => new Promise<number>(resolve => {
      releases.push(() => resolve(result));
    }));
    const cancellation = new AbortController();

    const first = service.run(() => execute(1));
    const second = service.run(() => execute(2));
    const cancelled = service.run(() => execute(3), cancellation.signal);
    cancellation.abort();

    await expect(cancelled).rejects.toBeInstanceOf(RequestTimeoutException);
    expect(execute).toHaveBeenCalledTimes(2);

    releases.forEach(release => release());
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual(expect.objectContaining({
      active: 0,
      pending: 0,
      cancelled: 1
    }));
  });

  it('rejects excess previews instead of growing the queue without a limit', async () => {
    const releases: Array<() => void> = [];
    const execute = jest.fn((result: number) => new Promise<number>(resolve => {
      releases.push(() => resolve(result));
    }));
    const accepted = Array.from(
      { length: 10 },
      (_, index) => service.run(() => execute(index + 1))
    );

    await Promise.resolve();
    const rejected = service.run(() => execute(11));

    await expect(rejected).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual({
      active: 2,
      pending: 8,
      maxConcurrent: 2,
      maxPending: 8,
      rejected: 1,
      cancelled: 0
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected=1')
    );

    for (let index = 0; index < accepted.length; index += 1) {
      releases.shift()?.();
      await new Promise(resolve => {
        setImmediate(resolve);
      });
    }
    await expect(Promise.all(accepted)).resolves.toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ]);
    expect(execute).toHaveBeenCalledTimes(10);
    expect(service.getSnapshot()).toEqual(expect.objectContaining({
      active: 0,
      pending: 0,
      rejected: 1
    }));
  });
});
