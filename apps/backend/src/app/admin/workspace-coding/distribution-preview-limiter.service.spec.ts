import { RequestTimeoutException } from '@nestjs/common';
import { DistributionPreviewLimiterService } from './distribution-preview-limiter.service';

describe('DistributionPreviewLimiterService', () => {
  let service: DistributionPreviewLimiterService;

  beforeEach(() => {
    service = new DistributionPreviewLimiterService();
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
  });
});
