import { EXPORT_WORKER_ROLE } from '../export-worker/export-worker-role';

/** Validate the effective env-file/process configuration before connecting to infrastructure. */
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

  function isConfigured(key: string): boolean {
    const value = config[key];
    // Compose supplies empty optional overrides; auth resolvers use their fallbacks.
    return value !== undefined && !(typeof value === 'string' && !value.trim());
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

  for (const key of ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    requireString(key);
  }
  port('POSTGRES_PORT');
  // Preserve the Redis defaults used by both cache and queue clients.
  validated.REDIS_HOST = config.REDIS_HOST ?? 'redis';
  validated.REDIS_PREFIX = config.REDIS_PREFIX ?? 'coding-box';
  requireString('REDIS_HOST');
  requireString('REDIS_PREFIX');
  port('REDIS_PORT', '6379');

  if (role !== EXPORT_WORKER_ROLE) {
    // Also required with Keycloak: workspace replay tokens use HS256.
    requireString('JWT_SECRET');
    const oidcKeys = ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_CLIENT_ID',
      'OIDC_PROVIDER_URL', 'OIDC_ISSUER', 'OIDC_JWKS_URI'];
    const oidcConfigured = oidcKeys.some(isConfigured);
    if (oidcConfigured) {
      requireString('KEYCLOAK_CLIENT_ID');
      for (const key of ['KEYCLOAK_URL', 'OIDC_PROVIDER_URL', 'OIDC_ISSUER', 'OIDC_JWKS_URI']) {
        if (isConfigured(key)) {
          requireString(key);
          try {
            const url = new URL(String(config[key]));
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
              throw new Error();
            }
          } catch {
            errors.push(`${key} must be an HTTP(S) URL without credentials`);
          }
        }
      }
      if (!isConfigured('OIDC_ISSUER')) {
        requireString('KEYCLOAK_URL');
        requireString('KEYCLOAK_REALM');
      }
      if (!isConfigured('OIDC_JWKS_URI')) {
        if (!isConfigured('KEYCLOAK_URL')) requireString('OIDC_PROVIDER_URL');
        requireString('KEYCLOAK_REALM');
      }
    }
  }

  if (errors.length) {
    // Never include configuration values: credentials can be among invalid fields.
    throw new Error(`Invalid startup configuration:\n${Array.from(new Set(errors)).join('\n')}`);
  }
  return validated;
}
