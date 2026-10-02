import {
  AUTH_SESSION_AUTO_REFRESH_TIMEOUT_MS,
  AUTH_SESSION_IDLE_TIMEOUT_MS,
  getAuthSessionWarningDelayMs,
  MAX_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_AUTH_SESSION_IDLE_TIMEOUT_MINUTES
} from './auth-session.config';

describe('auth-session.config', () => {
  it('keeps the Keycloak auto-refresh timeout aligned with the maximum configurable idle timeout', () => {
    expect(AUTH_SESSION_AUTO_REFRESH_TIMEOUT_MS).toBe(
      MAX_AUTH_SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000
    );
    expect(AUTH_SESSION_AUTO_REFRESH_TIMEOUT_MS).toBeGreaterThanOrEqual(
      AUTH_SESSION_IDLE_TIMEOUT_MS
    );
  });

  it('does not show the idle warning immediately for the minimum timeout', () => {
    const minimumTimeoutMs = MIN_AUTH_SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;

    expect(getAuthSessionWarningDelayMs(minimumTimeoutMs)).toBeGreaterThan(0);
    expect(getAuthSessionWarningDelayMs(minimumTimeoutMs)).toBe(
      Math.floor(minimumTimeoutMs / 2)
    );
  });
});
