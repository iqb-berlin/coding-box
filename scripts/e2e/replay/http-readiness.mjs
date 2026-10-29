import { setTimeout as delay } from 'node:timers/promises';

export async function waitForHttp(url, timeoutMs, {
  headers,
  requestTimeoutMs = 5000,
  retryIntervalMs = 500
} = {}) {
  const deadline = performance.now() + timeoutMs;
  let lastStatus = 'unreachable';
  let lastHttpStatus;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(requestTimeoutMs, deadline - performance.now()))))
      });
      lastHttpStatus = response.status;
      lastStatus = `HTTP ${response.status}`;
      await response.body?.cancel();
      if (response.ok) return;
    } catch (error) {
      lastStatus = error.name === 'TimeoutError' ? 'request timed out' : 'unreachable';
    }
    const remaining = deadline - performance.now();
    if (remaining > 0) await delay(Math.min(retryIntervalMs, remaining));
  }
  const httpStatus = lastHttpStatus === undefined ? '' : `; last HTTP status: ${lastHttpStatus}`;
  throw new Error(`Timed out waiting for ${url} (${lastStatus}${httpStatus}).`);
}
