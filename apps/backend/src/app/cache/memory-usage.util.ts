import { getHeapStatistics } from 'node:v8';

export const HEAP_WARNING_THRESHOLD_PERCENT = 80;

export interface MemoryUsageSnapshot extends NodeJS.MemoryUsage {
  heapSizeLimit: number;
  heapUsedPercent: number;
}

export function captureMemoryUsage(
  memoryUsage: NodeJS.MemoryUsage = process.memoryUsage(),
  heapSizeLimit: number = getHeapStatistics().heap_size_limit
): MemoryUsageSnapshot {
  return {
    ...memoryUsage,
    heapSizeLimit,
    heapUsedPercent: (memoryUsage.heapUsed / heapSizeLimit) * 100
  };
}

export function isHeapUsageHigh(
  memoryUsage: MemoryUsageSnapshot,
  thresholdPercent = HEAP_WARNING_THRESHOLD_PERCENT
): boolean {
  return memoryUsage.heapUsedPercent > thresholdPercent;
}

export function formatMemoryUsage(memoryUsage: MemoryUsageSnapshot): string {
  const toMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

  return [
    `Heap: ${toMB(memoryUsage.heapUsed)}MB/${toMB(memoryUsage.heapSizeLimit)}MB limit`,
    `(${memoryUsage.heapUsedPercent.toFixed(1)}%; ${toMB(memoryUsage.heapTotal)}MB committed)`,
    `RSS: ${toMB(memoryUsage.rss)}MB`,
    `External: ${toMB(memoryUsage.external)}MB`
  ].join(', ');
}
