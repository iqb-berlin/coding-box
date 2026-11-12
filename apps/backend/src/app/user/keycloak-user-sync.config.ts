export interface KeycloakUserSyncConfig {
  usersUrl: string;
  tokenUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export function parseKeycloakUserSyncConfig(env: Record<string, unknown>): KeycloakUserSyncConfig | undefined {
  const enabled = env.KEYCLOAK_USER_SYNC_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false' || enabled === false) return undefined;
  if (enabled !== 'true' && enabled !== true) throw new Error('KEYCLOAK_USER_SYNC_ENABLED must be true or false');

  const required = (key: string): string => {
    const value = env[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
    return value;
  };
  const endpoint = (key: string): string => {
    const value = required(key);
    try {
      const url = new URL(value);
      if (value !== value.trim() || !['http:', 'https:'].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      throw new Error(`${key} must be an HTTP(S) URL without credentials, query or fragment`);
    }
    return value;
  };

  return {
    usersUrl: endpoint('KEYCLOAK_USER_SYNC_USERS_URL'),
    tokenUrl: endpoint('OIDC_TOKEN_ENDPOINT'),
    issuer: endpoint('OIDC_ISSUER'),
    clientId: required('KEYCLOAK_USER_SYNC_CLIENT_ID'),
    clientSecret: required('KEYCLOAK_USER_SYNC_CLIENT_SECRET')
  };
}
