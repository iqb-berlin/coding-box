import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseEnv, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function expandEnv(env) {
  const resolve = (key, seen = new Set()) => {
    if (seen.has(key)) throw new Error('Circular environment variable reference.');
    return (env[key] ?? '').replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => resolve(name, new Set([...seen, key])));
  };
  return Object.fromEntries(Object.keys(env).map(key => [key, resolve(key)]));
}

function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Expected an HTTP(S) URL without credentials, query or fragment.');
  }
  return url.href.replace(/\/$/, '');
}

export function syncEndpoints(env) {
  const issuer = httpUrl(env.OIDC_ISSUER);
  const match = issuer.match(/^(.*)\/realms\/([^/]+)$/);
  if (!match) throw new Error('OIDC_ISSUER must identify a Keycloak realm.');
  const realm = match[2];
  const tokenUrl = httpUrl(env.OIDC_TOKEN_ENDPOINT);
  const suffix = `/realms/${realm}/protocol/openid-connect/token`;
  if (!tokenUrl.endsWith(suffix)) throw new Error('Token endpoint and issuer must identify the same Keycloak realm.');
  const base = httpUrl(env.KEYCLOAK_SETUP_BASE_URL || tokenUrl.slice(0, -suffix.length));
  return { issuer, tokenUrl, base, realm, usersUrl: `${base}/admin/realms/${realm}/users` };
}

async function request(url, { token, form, body, method = 'GET' } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Keycloak request failed. Check reachability and TLS trust.');
  }
  if (!response.ok) throw new Error(`Keycloak request rejected (HTTP ${response.status}).`);
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined;
  try { return await response.json(); } catch { throw new Error('Keycloak returned an invalid JSON response.'); }
}

async function serviceToken(tokenUrl, clientId, secret) {
  const result = await request(tokenUrl, {
    method: 'POST', form: { grant_type: 'client_credentials', client_id: clientId, client_secret: secret }
  });
  if (typeof result?.access_token !== 'string' || !result.access_token) throw new Error('Keycloak returned no service token.');
  return result.access_token;
}

export async function verifySyncAccess({ tokenUrl, usersUrl }, clientId, secret) {
  const token = await serviceToken(tokenUrl, clientId, secret);
  const users = await request(`${usersUrl}?enabled=true&max=1`, { token });
  if (!Array.isArray(users)) throw new Error('Keycloak returned no user directory.');
}

async function waitForKeycloak(base) {
  // Keycloak may still be starting after the realm import.
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      await request(`${base}/realms/master/.well-known/openid-configuration`);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(2000);
    }
  }
}

export async function provisionSyncClient(endpoints, credentials, clientId = 'coding-box-user-sync') {
  const { base, realm } = endpoints;
  await waitForKeycloak(base);
  const admin = await request(`${base}/realms/${encodeURIComponent(credentials.realm || 'master')}/protocol/openid-connect/token`, {
    method: 'POST', form: { grant_type: 'password', client_id: 'admin-cli',
      username: credentials.username, password: credentials.password }
  });
  if (!admin?.access_token) throw new Error('Keycloak returned no setup token.');
  const api = (path, options = {}) => request(`${base}/admin/realms/${realm}${path}`, { ...options, token: admin.access_token });
  const findClient = async id => (await api(`/clients?clientId=${encodeURIComponent(id)}`)).find(client => client.clientId === id);
  let client = await findClient(clientId);
  if (!client) {
    await api('/clients', {
      method: 'POST',
      body: { clientId, name: 'Kodierbox user directory (read only)', protocol: 'openid-connect',
        enabled: true, publicClient: false, bearerOnly: false, serviceAccountsEnabled: true,
        standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
        fullScopeAllowed: true, attributes: { 'coding-box-user-sync': 'true' } }
    });
    client = await findClient(clientId);
  }
  if (!client?.id || client.attributes?.['coding-box-user-sync'] !== 'true' || client.publicClient || client.bearerOnly ||
      client.protocol !== 'openid-connect' ||
      !client.enabled || !client.serviceAccountsEnabled || client.standardFlowEnabled ||
      client.directAccessGrantsEnabled || client.implicitFlowEnabled) {
    throw new Error('The sync client is not a dedicated Kodierbox service account. No existing client was changed.');
  }
  const management = await findClient('realm-management');
  if (!management?.id) throw new Error('Keycloak realm-management client is missing.');
  const account = await api(`/clients/${client.id}/service-account-user`);
  const rolesPath = `/users/${account.id}/role-mappings/clients/${management.id}`;
  const assigned = await api(`${rolesPath}/composite`);
  if (assigned.some(role => !['view-users', 'query-users', 'query-groups'].includes(role.name))) {
    throw new Error('The sync service account has unexpected administrative roles. Remove them before continuing.');
  }
  if (!assigned.some(role => role.name === 'view-users')) {
    const role = await api(`/clients/${management.id}/roles/view-users`);
    await api(rolesPath, { method: 'POST', body: [role] });
  }
  const { value: secret } = await api(`/clients/${client.id}/client-secret`);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{16,}$/.test(secret)) {
    throw new Error('The sync client has no supported secret. No application configuration was changed.');
  }
  await verifySyncAccess(endpoints, clientId, secret);
  return secret;
}

export function updateSyncEnv(contents, values) {
  let result = contents;
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n#\s]/.test(value)) throw new Error('Unsupported environment value.');
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    result = pattern.test(result) ? result.replace(pattern, () => `${key}=${value}`) : `${result.replace(/\n?$/, '\n')}${key}=${value}\n`;
  }
  return result;
}

export async function setupFromEnvFile(envFile, adminEnvFile, automatic = false) {
  const contents = await readFile(envFile, 'utf8');
  const env = expandEnv(parseEnv(contents));
  if (automatic && env.KEYCLOAK_USER_SYNC_AUTO_SETUP !== 'true') return;
  const endpoints = syncEndpoints(env);
  const clientId = env.KEYCLOAK_USER_SYNC_CLIENT_ID || 'coding-box-user-sync';
  if (automatic && env.KEYCLOAK_USER_SYNC_ENABLED === 'true' && env.KEYCLOAK_USER_SYNC_CLIENT_SECRET) {
    await waitForKeycloak(endpoints.base);
    await verifySyncAccess({ ...endpoints, usersUrl: httpUrl(env.KEYCLOAK_USER_SYNC_USERS_URL) },
      clientId, env.KEYCLOAK_USER_SYNC_CLIENT_SECRET);
    console.log('Keycloak user sync: existing read access verified.');
    return;
  }
  const credentials = adminEnvFile ? parseEnv(await readFile(adminEnvFile, 'utf8')) : {};
  const username = process.env.KEYCLOAK_SETUP_ADMIN_USERNAME || credentials.ADMIN_NAME;
  const password = process.env.KEYCLOAK_SETUP_ADMIN_PASSWORD || credentials.ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Setup needs temporary Keycloak admin credentials (admin env file or KEYCLOAK_SETUP_ADMIN_*).');
  const secret = await provisionSyncClient(endpoints, {
    username, password, realm: process.env.KEYCLOAK_SETUP_ADMIN_REALM
  }, clientId);
  const updated = updateSyncEnv(contents, {
    KEYCLOAK_USER_SYNC_ENABLED: 'true', KEYCLOAK_USER_SYNC_USERS_URL: endpoints.usersUrl,
    KEYCLOAK_USER_SYNC_CLIENT_ID: clientId, KEYCLOAK_USER_SYNC_CLIENT_SECRET: secret
  });
  // Atomic replacement keeps an unsuccessful write from truncating the application env.
  const temporary = `${envFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
    await rename(temporary, envFile);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log('Keycloak user sync: read-only service account configured and verified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      env: { type: 'string' }, 'admin-env': { type: 'string' }, auto: { type: 'boolean', default: false }
    } });
    if (!values.env) throw new Error('Usage: node setup-user-sync.mjs --env FILE [--admin-env FILE] [--auto]');
    await setupFromEnvFile(values.env, values['admin-env'], values.auto);
  } catch (error) {
    // Never dump fetch errors, response bodies, tokens or the input environment.
    console.error(`Keycloak user sync setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
