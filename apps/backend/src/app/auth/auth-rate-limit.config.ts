export const DEFAULT_AUTH_RATE_LIMIT = 120;
export const DEFAULT_AUTH_RATE_LIMIT_TTL_MS = 60_000;

export function parseAuthRateLimitConfig(config: Record<string, unknown>): { limit: number; ttl: number } {
  const positiveInteger = (key: string, fallback: number, maximum: number): number => {
    const value = config[key] ?? fallback;
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 || Number(value) > maximum) {
      throw new Error(`${key} must be an integer between 1 and ${maximum}`);
    }
    return Number(value);
  };
  return {
    limit: positiveInteger('AUTH_RATE_LIMIT_LIMIT', DEFAULT_AUTH_RATE_LIMIT, 1_000_000),
    ttl: positiveInteger('AUTH_RATE_LIMIT_TTL_MS', DEFAULT_AUTH_RATE_LIMIT_TTL_MS, 86_400_000)
  };
}
