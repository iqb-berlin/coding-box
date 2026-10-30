import { parseAuthRateLimitConfig } from './auth-rate-limit.config';
import { parseTrustedProxies } from '../http/trusted-proxies';

describe('authentication rate limit configuration', () => {
  it('uses a bounded default and accepts explicit integer settings', () => {
    expect(parseAuthRateLimitConfig({})).toEqual({ limit: 120, ttl: 60_000 });
    expect(parseAuthRateLimitConfig({ AUTH_RATE_LIMIT_LIMIT: '300', AUTH_RATE_LIMIT_TTL_MS: '10000' }))
      .toEqual({ limit: 300, ttl: 10_000 });
  });

  it.each(['', '0', '-1', '1.5', 'Infinity', 'NaN', '12x', true, {}])('rejects an invalid limit/window: %p', value => {
    for (const key of ['AUTH_RATE_LIMIT_LIMIT', 'AUTH_RATE_LIMIT_TTL_MS']) {
      expect(() => parseAuthRateLimitConfig({ [key]: value })).toThrow(key);
    }
  });

  it('rejects unbounded limits and expiry periods', () => {
    expect(() => parseAuthRateLimitConfig({ AUTH_RATE_LIMIT_LIMIT: '1000001' })).toThrow('AUTH_RATE_LIMIT_LIMIT');
    expect(() => parseAuthRateLimitConfig({ AUTH_RATE_LIMIT_TTL_MS: '86400001' })).toThrow('AUTH_RATE_LIMIT_TTL_MS');
  });
});

describe('trusted HTTP proxies', () => {
  it('does not trust forwarded headers by default', () => {
    for (const value of [undefined, null, '', 'false']) expect(parseTrustedProxies(value)).toBe(false);
  });

  it('accepts explicit addresses, subnets and Express proxy aliases', () => {
    expect(parseTrustedProxies('loopback, 172.20.0.0/16,::1,fd00::/8'))
      .toEqual(['loopback', '172.20.0.0/16', '::1', 'fd00::/8']);
  });

  it('supports the explicit single-ingress contract used by production Compose', () => {
    expect(parseTrustedProxies('1')).toBe(1);
  });

  it.each(['true', '2', '0.0.0.0/0', '::/0', '192.0.2.1/33', '::1/129', '127.0.0.1/x', 'localhost', 'loopback,', true])('rejects unrestricted or malformed trust: %p', value => {
    expect(() => parseTrustedProxies(value)).toThrow('HTTP_TRUSTED_PROXIES');
  });
});
