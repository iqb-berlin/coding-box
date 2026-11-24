export function formatDuration(durationMs: number): string {
  if (durationMs < 0) return '00:00';

  // Convert to seconds
  const totalSeconds = Math.floor(durationMs / 1000);

  // Calculate minutes and remaining seconds
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  // Format as MM:SS
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

export function formatLogTimestamp(timestamp: string): string {
  const date = new Date(Number(timestamp));
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function filterAndSortLogs<T extends { ts: string; key: string; parameter: string }>(
  logs: readonly T[],
  query = ''
): T[] {
  const searchTerm = query.toLowerCase();
  const matching = searchTerm ? logs.filter(log => log.key.toLowerCase().includes(searchTerm) ||
    log.parameter.toLowerCase().includes(searchTerm)) : [...logs];
  return matching.sort((a, b) => Number(b.ts) - Number(a.ts));
}
