export const REPLAY_ATTEMPT_ID_HEADER = 'X-Replay-Attempt-Id';

export function createReplayAttemptId(): string {
  const cryptoApi = globalThis.crypto as Crypto & {
    randomUUID?: () => string;
  };
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function withReplayAttemptHeader(
  headers: Record<string, string>,
  replayAttemptId?: string
): Record<string, string> {
  return replayAttemptId ?
    {
      ...headers,
      [REPLAY_ATTEMPT_ID_HEADER]: replayAttemptId
    } :
    headers;
}
