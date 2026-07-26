import {
  captureMemoryUsage,
  formatMemoryUsage,
  isHeapUsageHigh
} from './memory-usage.util';

describe('memory usage utilities', () => {
  const MB = 1024 * 1024;

  it('measures heap pressure against the V8 heap limit, not committed heap', () => {
    const memoryUsage = captureMemoryUsage(
      {
        heapUsed: 900 * MB,
        heapTotal: 1000 * MB,
        rss: 1200 * MB,
        external: 50 * MB,
        arrayBuffers: 10 * MB
      },
      4000 * MB
    );

    expect(memoryUsage.heapUsedPercent).toBe(22.5);
    expect(isHeapUsageHigh(memoryUsage)).toBe(false);
  });

  it('reports high heap usage only above the configured threshold', () => {
    const atThreshold = captureMemoryUsage(
      {
        heapUsed: 800 * MB,
        heapTotal: 900 * MB,
        rss: 1000 * MB,
        external: 0,
        arrayBuffers: 0
      },
      1000 * MB
    );
    const aboveThreshold = captureMemoryUsage(
      {
        ...atThreshold,
        heapUsed: 810 * MB
      },
      1000 * MB
    );

    expect(isHeapUsageHigh(atThreshold)).toBe(false);
    expect(isHeapUsageHigh(aboveThreshold)).toBe(true);
  });

  it('formats heap limit, committed heap, RSS and external memory', () => {
    const memoryUsage = captureMemoryUsage(
      {
        heapUsed: 900 * MB,
        heapTotal: 1000 * MB,
        rss: 1200 * MB,
        external: 50 * MB,
        arrayBuffers: 10 * MB
      },
      4000 * MB
    );

    expect(formatMemoryUsage(memoryUsage)).toBe(
      'Heap: 900.0MB/4000.0MB limit, (22.5%; 1000.0MB committed), RSS: 1200.0MB, External: 50.0MB'
    );
  });
});
