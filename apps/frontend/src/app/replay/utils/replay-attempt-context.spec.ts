import { ReplayAttemptContext } from './replay-attempt-context';

describe('ReplayAttemptContext', () => {
  it('correlates an attempt and calculates all timing segments', () => {
    const attempt = new ReplayAttemptContext(100, 'attempt-1');
    attempt.recordCodingSession({
      requestStartedAt: 150,
      responseReceivedAt: 250,
      serverTimings: { codingSessionTotalMs: 75 }
    });
    attempt.startPayloadLoad(300);
    attempt.recordPayloadResponse(500, { responseTotalMs: 5 });
    attempt.recordPlayerReady(650);

    expect(attempt.id).toBe('attempt-1');
    expect(attempt.getClientTimings(900)).toEqual({
      codingSessionMs: 100,
      routeToCodingSessionRequestMs: 50,
      codingSessionResponseToPayloadRequestMs: 50,
      routeToVisibleMs: 800,
      loadToVisibleMs: 600,
      routeToPayloadRequestMs: 200,
      payloadMs: 200,
      payloadToVisibleMs: 400,
      payloadToPlayerReadyMs: 150,
      playerReadyToVisibleMs: 250
    });
    expect(attempt.getServerTimings()).toEqual({
      codingSessionTotalMs: 75,
      responseTotalMs: 5
    });
  });

  it('does not carry coding-session timings into a new attempt', () => {
    const firstAttempt = new ReplayAttemptContext(100, 'attempt-1');
    firstAttempt.recordCodingSession({
      requestStartedAt: 110,
      responseReceivedAt: 120,
      serverTimings: { codingSessionTotalMs: 10 }
    });

    const nextAttempt = new ReplayAttemptContext(200, 'attempt-2');
    nextAttempt.startPayloadLoad(220);

    expect(nextAttempt.getClientTimings(300).codingSessionMs).toBeNull();
    expect(nextAttempt.getServerTimings()).toBeUndefined();
  });

  it('finalizes statistics only once', () => {
    const attempt = new ReplayAttemptContext(100, 'attempt-1');

    expect(attempt.tryFinalizeStatistics()).toBe(true);
    expect(attempt.tryFinalizeStatistics()).toBe(false);
  });
});
