import { EXPORT_WORKER_ROLE } from '../export-worker/export-worker-role';

/** Validate effective configuration before infrastructure providers are created. */
export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const validated = { ...config };
  const errors: string[] = [];
  const role = config.APP_ROLE ?? 'api';
  if (role !== 'api' && role !== EXPORT_WORKER_ROLE) {
    errors.push('APP_ROLE must be api or export-worker');
  }
  validated.APP_ROLE = role;

  function requireString(key: string): void {
    const value = validated[key];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  function port(key: string, fallback?: string): void {
    const value = config[key] ?? fallback;
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        !/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
      errors.push(`${key} must be an integer between 1 and 65535`);
    } else {
      validated[key] = String(value);
    }
  }

  function url(key: string, required = false): void {
    const value = config[key];
    if (!required && (value === undefined || value === null || value === '')) return;
    if (required) requireString(key);
    try {
      if (typeof value !== 'string' || value !== value.trim()) throw new Error();
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error();
      }
    } catch {
      errors.push(`${key} must be an HTTP(S) URL without credentials or surrounding whitespace`);
    }
  }

  for (const key of ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    requireString(key);
  }
  port('POSTGRES_PORT');
  validated.REDIS_HOST = config.REDIS_HOST ?? 'redis';
  validated.REDIS_PREFIX = config.REDIS_PREFIX ?? 'coding-box';
  requireString('REDIS_HOST');
  requireString('REDIS_PREFIX');
  port('REDIS_PORT', '6379');

  if (role !== EXPORT_WORKER_ROLE) {
    // Also required with OIDC: workspace replay tokens use HS256.
    requireString('JWT_SECRET');
    requireString('OAUTH2_CLIENT_ID');
    // JwtStrategy consumes these exact values; legacy Keycloak settings cannot replace them.
    url('OIDC_ISSUER', true);
    url('OIDC_JWKS_URI', true);
    for (const key of ['OIDC_ACCOUNT_ENDPOINT', 'OIDC_AUTHORIZATION_ENDPOINT',
      'OIDC_TOKEN_ENDPOINT', 'OIDC_USERINFO_ENDPOINT', 'OIDC_END_SESSION_ENDPOINT']) {
      url(key);
    }
  }

  if (errors.length) {
    // Credentials may be invalid fields: report rules and field names, never values.
    throw new Error(`Invalid startup configuration:\n${Array.from(new Set(errors)).join('\n')}`);
  }
  return validated;
}
