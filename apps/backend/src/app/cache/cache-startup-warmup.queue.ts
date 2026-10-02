let startupWarmupQueue: Promise<void> = Promise.resolve();
let startupWarmupsReleased = false;
const pendingStartupWarmups: Array<() => void> = [];

export function enqueueCacheStartupWarmup(
  warmup: () => Promise<void>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const enqueue = () => {
      const queuedWarmup = startupWarmupQueue.then(warmup, warmup);
      startupWarmupQueue = queuedWarmup.catch(() => undefined);
      queuedWarmup.then(resolve, reject);
    };

    if (startupWarmupsReleased) {
      enqueue();
      return;
    }

    pendingStartupWarmups.push(enqueue);
  });
}

export function releaseCacheStartupWarmups(): void {
  if (startupWarmupsReleased) {
    return;
  }

  startupWarmupsReleased = true;
  pendingStartupWarmups.splice(0).forEach(enqueue => enqueue());
}
