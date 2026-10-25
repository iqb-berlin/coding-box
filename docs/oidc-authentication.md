# OIDC Authentication

[Deutsch](oidc-authentication-de.md)

Operations and developer guide for the integrated Auth flow. Related to [#571](https://github.com/iqb-berlin/coding-box/issues/571).
Verified baseline: `develop` at `b38ca4c3e9f4ebb796ddb74f41003a6fc412ed72` (25 October 2026).
This documentation consolidation requires separate acceptance. It does not extend
the accepted verification scopes of #564, #565 or #1018.

## 1. Introduction

Kodierbox uses Authorization Code with PKCE. The browser authenticates at the
provider; the backend exchanges the provider's authorization code and requests
userinfo. The redirect back to the application contains only a short-lived,
browser-bound one-time `auth_code`, never an access or refresh token.
The initiating browser redeems it through `POST /api/auth/exchange`.

Keycloak is the currently evidenced provider integration. Configurable OIDC
endpoints do not establish compatibility with every OIDC provider; section 6
lists the requirements and remaining Keycloak assumptions.

## 2. For System Administrators

### 2.1 Environment Configuration

Use the [development template](../.env.dev.template),
[production template](../.env.coding-box.template) and the corresponding Compose
files. The examples supplement a complete template; database, Redis, registry and
infrastructure settings are also required. Shipped values such as `change_me` and
`random_string` are placeholders, not operational credentials.

| Variable | Purpose |
| --- | --- |
| `OIDC_PROVIDER_URL` | Public provider base address; does not replace the exact issuer or individual endpoints. |
| `OIDC_ISSUER` | Exact provider access-token `iss`, including realm and any context path actually used by that deployment. |
| `OIDC_AUTHORIZATION_ENDPOINT` | Login endpoint reachable by the browser. |
| `OIDC_TOKEN_ENDPOINT` | Code/refresh token endpoint reachable by the backend. |
| `OIDC_USERINFO_ENDPOINT` | Userinfo endpoint reachable by the backend. |
| `OIDC_JWKS_URI` | JWKS endpoint reachable by the backend for RS256 verification. |
| `OIDC_END_SESSION_ENDPOINT` | Logout endpoint reachable by the backend. |
| `OIDC_ACCOUNT_ENDPOINT` | Separately configured account/profile management; currently called with Keycloak parameters. |
| `OAUTH2_CLIENT_ID` | Client for login, token exchange and client/audience checks. |
| `OAUTH2_CLIENT_SECRET` | Confidential-client secret; may explicitly be empty for a suitably configured public client. Never publish a real secret. |
| `OAUTH2_REDIRECT_URL` | Scheme-relative backend callback, normally `//HOST/api/auth/callback`; see below. |
| `JWT_SECRET` | Separate strong HS256 workspace-token signing key, not the OIDC provider's signing key. |

**Production example** using an external Keycloak and realm `coding-box`:

```dotenv
SERVER_NAME=coding-box.example.org
OIDC_PROVIDER_URL=https://keycloak.${SERVER_NAME}
OIDC_ISSUER=https://keycloak.${SERVER_NAME}/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/account
OIDC_AUTHORIZATION_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/logout
OIDC_JWKS_URI=https://keycloak.${SERVER_NAME}/realms/coding-box/protocol/openid-connect/certs
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=
OAUTH2_REDIRECT_URL=//${SERVER_NAME}/api/auth/callback
```

The empty secret applies only to the matching public example client. Supply the
actual protected secret for a confidential client. `AuthController` prepends
`https:` to the callback variable when `NODE_ENV=production`, otherwise `http:`.
Do not put a full `https://...` URL into this scheme-relative setting.
The provider's allowed redirect URI in this example is exactly
`https://coding-box.example.org/api/auth/callback`.
The login query parameter `redirect_uri` is different: it is an allowed return
location inside the application, such as the home page or coding job.

**Development example** for the Compose network:

```dotenv
SERVER_NAME=localhost
API_PORT=3333
OIDC_PROVIDER_URL=http://${SERVER_NAME}:8080
OIDC_ISSUER=http://${SERVER_NAME}:8080/realms/coding-box
OIDC_ACCOUNT_ENDPOINT=http://${SERVER_NAME}:8080/realms/coding-box/account
OIDC_AUTHORIZATION_ENDPOINT=http://${SERVER_NAME}:8080/realms/coding-box/protocol/openid-connect/auth
OIDC_TOKEN_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/token
OIDC_USERINFO_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/userinfo
OIDC_END_SESSION_ENDPOINT=http://keycloak:8080/realms/coding-box/protocol/openid-connect/logout
OIDC_JWKS_URI=http://keycloak:8080/realms/coding-box/protocol/openid-connect/certs
OAUTH2_CLIENT_ID=coding-box
OAUTH2_CLIENT_SECRET=
OAUTH2_REDIRECT_URL=//${SERVER_NAME}:${API_PORT}/api/auth/callback
```

The public issuer, authorization and account endpoints must work in the browser.
`keycloak:8080` is the internal Docker service for backend requests. Internal
JWKS/token addresses may therefore differ from the public address, while the
expected issuer must still exactly match the token.
For a backend running directly on the host, explicitly replace these internal
addresses with host-reachable endpoints. The backend reads `.env.dev`; suitable
exported process variables can provide the host-specific settings.

The application uses explicit endpoints, not automatic discovery configuration.
Compare values with the particular provider's discovery metadata.
`/auth/realms/...` applies only if the provider is actually deployed with that
context path. The shipped Keycloak 22 examples use `/realms/coding-box` without
an extra `/auth` prefix. `KEYCLOAK_*` concerns remaining helper/installation paths
and the explicitly supported legacy migration; it does not replace active
`OIDC_*` configuration.

### 2.2 Keycloak Setup

The complete [realm file](../config/keycloak/realm/coding-box-realm.json) consumes
variables from the [realm configuration](../config/keycloak/realm/coding-box-realm.config).
The separate [client export](../config/keycloak/clients/coding-box.json) is not
an instruction to reimport an existing realm.

- Realm `coding-box`; `CODING_BOX_CLIENT_ID` and `OAUTH2_CLIENT_ID` must match the
  client actually configured in the provider.
- Standard Authorization Code flow enabled; Implicit Flow and Direct Access
  Grants disabled. The backend uses PKCE S256.
- The shipped client is public (`publicClient: true`); service accounts are
  disabled. A confidential client needs matching client authentication and
  `OAUTH2_CLIENT_SECRET`; a client-credentials service does not expand API rights.
- The export contains wildcard redirect URIs and origins. Restrict these to the
  actual callback and browser origins before operation. The backend allows the
  callback origin and an explicitly configured
  `FRONTEND_URL` origin. Development also allows the derived `HTTP_PORT` origin
  and localhost/127.0.0.1 on that port. Align those runtime settings and the
  provider allowlist with the actual frontend.
- `admin` in `realm_access.roles` controls administrator status. Workspace
  membership, access levels and job assignments remain separate application checks.
- The realm's access-token default is 300 seconds. The shipped client overrides
  it with `access.token.lifespan=4579200` (53 days). Check effective client settings
  and `exp`; five minutes is not a guaranteed lifetime.
- The export enables registration and disables password reset. Operators must
  choose these rules and session/token lifetimes deliberately.
- Before first start, set strong private admin/database credentials in `.env.dev`
  or the private installation and `CODING_BOX_ADMIN_*` in the realm configuration.
  Do not retain fixed example passwords as operational defaults.
- The IQB theme is in [themes/iqb](../config/keycloak/themes/iqb), selected through
  the client's `login_theme` attribute.

### 2.3 Deployment

#### Local Docker development

Use a separate fresh checkout and an unused Compose project name. Change the
example name to an available identifier before use. Do not overwrite existing
configuration with the following copy command.

```bash
umask 077
export COMPOSE_PROJECT_NAME=auth-dev-example
cp -n .env.dev.template .env.dev
```

Replace placeholders, including `JWT_SECRET` and both admin credentials, align the
realm configuration and resolve registry access before starting. The following
command only checks Compose configuration; it starts no services:

```bash
docker compose --env-file .env.dev -f docker-compose.yaml -f docker-compose.override.yaml config --quiet
```

The shipped files use the external network with the fixed name `app-net` and
fixed/configured host ports. A different project name separates Compose resources,
but not this network or host ports. Existing stacks on the target host must not be
affected. For parallel stacks, first define separate networks and nonconflicting
ports in a fully checked override combination, or use a separate development
machine. Without further configuration, the Make commands below use the default stack.

For a local development stack prepared accordingly, subsequently use `make dev-build` and
`make dev-up`. These commands build/pull images and start services. The development
override exposes Keycloak on port 8080, the backend on `API_PORT` and the frontend
on `HTTP_PORT`. `make dev-up` is not the production deployment command.
For host-based development, also start DB/Redis and adjust internal provider
addresses as described in section 2.1. Start frontend and backend separately; the
[project guide](../AGENTS.md) lists the corresponding Nx/npm commands.

#### Production fresh installation

1. Select a reviewed release tag, new target directories, registry access, DNS/TLS,
   Traefik and an external provider installation. Production Compose does not
   supply a Keycloak service.
   Before invoking the installer, decide whether to create a new realm or retain
   an existing provider unchanged. For an existing provider, explicitly answer
   `n` to `Do you want to use the Keycloak identity provider included in the
   infrastructure? [Y/n]` and supply its existing endpoints/client settings.
   The default branch can replace realm files, stop Keycloak and run an import;
   it is not a safe attachment path for a provider that must remain unchanged.
2. Read the [installation script](../scripts/install.sh) belonging to that release
   and run `bash scripts/install.sh "$AUTH_RELEASE_TAG"`. Explicitly set
   `AUTH_RELEASE_TAG` to the reviewed tag first. This interactive script can
   download files, install infrastructure, import a realm and start services;
   use it only for the planned fresh installation. Linux/Bash utilities including
   `readarray` are required, not the Bash 3.2 shipped with macOS.
3. The installer downloads the base as `docker-compose.coding-box.yaml` and
   creates `.env.coding-box`. Privately compare configuration with approved values.
   Initially answer `n` to the final `Do you want to start coding-box now? [Y/n]`
   prompt, then render in the installed directory:

   ```bash
   docker compose --env-file .env.coding-box -f docker-compose.coding-box.yaml -f docker-compose.coding-box.prod.yaml config --quiet
   ```

   In a source checkout the same base is named `docker-compose.yaml`. Include
   any generated `compose.sh` wrapper and the complete operator override list
   actually used by the deployment.
   This is not a preflight check for the entire installer: earlier steps may
   already have changed files, infrastructure and, if the import branch was
   selected, the provider. Review those decisions before step 2.
4. Verify restricted callback/origin allowlists, client and credentials. Only then
   start the new application deliberately. `make coding-box-up` pulls images and
   starts the installed configuration. Existing installations belong to the
   upgrade path and must not be overwritten with the fresh installer.
5. Before approval, verify health, login, callback, exchange, protected
   `GET /api/auth-data`, role, workspace, refresh and logout.

**Evidence boundary:** [#564 was accepted within its documented scope](https://github.com/iqb-berlin/coding-box/issues/564#issuecomment-6389951706):
live login using shipped templates/realm/theme in isolated development Auth
configuration; production template checked at Compose/configuration level.
This does not constitute acceptance of a complete interactive production installer
or a separate TLS production deployment. This guide does not extend that evidence.

## 3. For Developers

### 3.1 Backend Implementation

Active components are [AuthController](../apps/backend/src/app/auth/auth.controller.ts),
[OidcAuthService](../apps/backend/src/app/auth/service/oidc-auth.service.ts),
[JwtStrategy](../apps/backend/src/app/auth/jwt.strategy.ts) and the separate
[WorkspaceTokenStrategy](../apps/backend/src/app/auth/workspace-token.strategy.ts).
[AuthModule](../apps/backend/src/app/auth/auth.module.ts) registers the generic
OIDC service; replacing `KeycloakAuthService` is not an operator upgrade step.

All routes below include the global backend prefix `/api`:

| Route | Contract |
| --- | --- |
| `GET /api/auth/login` | Requires `browser_challenge` (43-character base64url SHA256), optional allowed application return `redirect_uri`; creates server-side PKCE and redirects. |
| `GET /api/auth/callback` | Provider `code`/`state`; consumes PKCE, exchanges code, requests userinfo, stores identity; redirects with `auth_code`. |
| `POST /api/auth/exchange` | JSON `{ "code": "<one-time-code>", "browser_verifier": "<browser-verifier>" }`; returns tokens once to the matching initiating browser. |
| `POST /api/auth/refresh` | JSON `{ "refresh_token": "<refresh-token>" }`; refreshes provider tokens, returns 401 for an invalid session or 503 for provider/configuration failures. |
| `POST /api/auth/logout` | Refresh token in body; attempts provider logout. Local logout remains possible if the provider call fails. |
| `GET /api/auth/profile` | Redirects to separately configured account management. |
| `POST /api/auth/token` | Relays client credentials to the provider; does not define additional machine API rights. |
| `POST /api/auth/validate` | Requests userinfo with an access token; does not replace route/workspace authorization. |

Body values in this table are placeholders, not executable test credentials.
See [request contracts](../api-dto/request-contracts.ts).

### 3.2 Frontend Implementation

The current [AuthService](../apps/frontend/src/app/core/services/auth.service.ts)
manages OIDC login. `AuthenticationService` is a separate Testcenter integration,
not the owner of this OIDC session.

- Browser verifier in `sessionStorage` under `oidc_login_verifier`, removed after
  successful exchange. The binding therefore belongs to the initiating browser tab.
- Access, ID and refresh tokens in `localStorage` under `auth_token`, `id_token`,
  `refresh_token`. This is the implementation, not HttpOnly-cookie storage.
  Logout removes these values. Do not export token values in tickets or HAR files.
- `getValidToken()` refreshes absent or soon-expiring access tokens and coalesces
  concurrent refreshes for the same session. Old responses must not overwrite a
  new session or another person's session.
- Genuine session failures require reauthentication. Temporary provider or
  configuration failures preserve the session and recovery draft.

### 3.3 Authentication Flow

1. Frontend creates a random browser verifier and SHA256 challenge.
2. Backend stores its own PKCE verifier plus browser challenge in Redis for
   300 seconds and redirects to the provider (S256, `openid profile email`).
3. Provider authenticates the user and calls the backend callback.
4. Backend consumes PKCE state once and sends the PKCE verifier in the protected
   token request to the provider; it is not in the frontend redirect.
5. Backend caches the resulting token set with the browser challenge in Redis for
   60 seconds. Only a random `auth_code` is returned to the application.
6. Frontend posts code and browser verifier to `/api/auth/exchange`. The cache
   entry is atomically consumed only if the challenge matches. Wrong browser,
   expired code or reuse results in 401.
7. Frontend stores tokens and uses the access token as bearer. Backend checks
   RS256/JWKS, expiration, exact issuer, client (`azp` or `aud`) and `sub`, then
   maps the local identity by provider issuer and subject.

The application backend has no persistent refresh-token table. Redis holds
short-lived PKCE/exchange state, including the temporary token set; provider
sessions and browser token storage are separate.

### 3.4 Integration with Other Services

Roles and authenticated identity do not replace workspace/job authorization.
The [scope guard](../apps/backend/src/app/auth/jwt-or-workspace-token-auth.guard.ts)
and [workspace rules](../apps/backend/src/app/admin/workspace/workspace.guard.ts)
check the particular route. Section 6 lists token/role boundaries; successful token
issuance does not grant unrestricted API access.

## 4. For End Users

### 4.1 Login Process

Use the application's login action to initiate the bound flow. Enter credentials
only at the intended provider. After returning, check identity and expected
workspaces. Reauthentication alone does not grant missing assignments.

### 4.2 Profile Management

Profile management uses the provider's separately configured account endpoint.
Its concrete behavior is evidenced for Keycloak; another provider needs a suitable
account/claim contract.

### 4.3 Logout

Explicit logout removes local tokens and attempts to end the provider session
using the refresh token. A failed provider call does not establish global
server-side session revocation. Other tabs/sessions and already signed access
tokens remain subject to their own state.

### 4.4 User Troubleshooting

Reauthenticate as the same person to recover an own draft in the original coding
context. For provider/network failures, retry while preserving the draft. Give
operations the error ID, time and action; do not send tokens, passwords or response data.

## 5. Troubleshooting (Common Issues)

### 5.1 Configuration Issues

Check startup validation, effective `OIDC_*`/`OAUTH2_*` settings and the actual
error class. Compare exact issuer and callback with the provider. A public client
does not need an invented secret; a confidential client needs its matching protected
secret. Correct the specific configuration using the
[upgrade/rollback procedure](auth-upgrade-and-restore.en.md).

### 5.2 Authentication Errors

For missing/consumed browser verifier or expired one-time code, start login again
from the application. Do not manually copy codes between tabs. `invalid_grant`,
401, 403 and 503 have different causes; see section 5.5.

### 5.3 Keycloak Issues

Check realm, client, allowed callback, roles and effective token lifetimes.
Do not use a blanket JSON reimport to troubleshoot an existing realm; compare
with the secured operator configuration.

### 5.4 Network Issues

Check DNS, VPN/routing, TLS trust, proxy and reachability separately from browser
**and** backend. Correct CORS/origin allowlists at the intended service; do not
bypass browser protections with CORS plugins. Browser login does not establish
backend access to internal token/JWKS endpoints.

### 5.5 Operational authentication diagnosis (F06)

Related to [#1018](https://github.com/iqb-berlin/coding-box/issues/1018) and [#571](https://github.com/iqb-berlin/coding-box/issues/571). This procedure describes the implemented error classification and the live checks recorded in the [acceptance protocol](qa/auth-acceptance-2026-10-23.md). It does not complete the separate installation/upgrade consolidation in #571.

**Classify the failure before changing the session**

| Application result | Meaning | Recovery |
| --- | --- | --- |
| 503, `provider-unavailable` | Provider/JWKS transport failure, timeout or server failure; a provider outage does not prove that the session expired | Keep the session and draft. Check connectivity from the backend's network, restore availability, then use the authentication retry action and verify saving |
| 503, `configuration-error` | Missing/invalid endpoint or client configuration, or provider/JWKS HTTP 400/401/403/404 classified as configuration failure | Give the request ID to the operator. Check the deployed issuer, client ID and relevant endpoint; restore the intended configuration, then retry in the existing tab |
| 401, `session-invalid` | For example, the refresh provider returned HTTP 400 with `invalid_grant`, or userinfo returned 401 | Sign in again as the same person to recover the draft in the same coding context; verify its contents before continuing |
| 401 without that code | Missing, expired or rejected JWT; signature, subject, issuer and client/audience checks can also reject a token | Check the actual failing route and configured issuer/client. Do not infer a provider outage or an expired session solely from the number 401 |
| 403 for workspace/job access | Authenticated request lacks the required permission | Keep the session. Check workspace membership and the route's read/write/job-assignment rules; signing in repeatedly does not grant permissions |
| Auth-data request fails with network error/5xx | The workspace list was not successfully loaded | Use the visible retry action; verify the expected list and that the old error disappears |

An `invalid_grant` response is an exception to the general provider-400 rule above. Unknown `kid`, invalid signature, wrong issuer/client and expired JWTs remain authentication failures; an unavailable or incorrectly configured JWKS endpoint is distinguished from them. Some access-level guards still use legacy 401 responses: inspect their message and route instead of assuming every authorization failure already returns 403.

**Correlate browser, HTTP and backend log**

1. Record the environment, deployed artifact/version, UTC time, action, application HTTP status and visible error ID. In DevTools Network, inspect only the failing request's response header `X-Request-Id`, error-body `requestId`/`code`, and path without query parameters. The UI ID, header and error-body ID must agree for that request.
2. The request-ID middleware accepts trimmed IDs of 1–128 characters matching `[A-Za-z0-9._:-]+`; otherwise it generates a new ID. Use the returned ID, not an unconfirmed client-supplied value. The provider diagnostic event uses that ID when it is available.
3. Locate the corresponding backend event: `oidc-refresh-failed`, `oidc-code-exchange-failed`, `oidc-userinfo-failed`, `oidc-jwks-failed` or `oidc-logout-failed`. Export only `event`, `errorClass`, `endpoint`, `httpStatus` and `requestId` from that structured event.
4. `httpStatus` is the **provider** status; it may be `null` when no provider response exists. It is not the application's response status. Endpoint logging retains only origin and pathname, removing URL credentials, query and fragment. Configuration checks that fail before a provider request need not emit a provider-response event; also inspect the correlated backend error entry.

For private investigation, capture a bounded log window once. Use the active deployment's Compose project, environment and complete override list; if it has a `compose.sh` wrapper, use that wrapper in place of `docker compose` below.

```bash
umask 077
auth_diag_dir="$(mktemp -d)"
docker compose logs --no-color --since 15m backend > "$auth_diag_dir/backend.log" 2>&1
auth_request_id='example-request-123'
grep -nF -- "$auth_request_id" "$auth_diag_dir/backend.log"
```

The raw file and adjacent log lines are for private inspection. For a ticket or support message, transcribe only the five allowed fields from the structured auth event; a generic HTTP log line or stack trace is not a sanitized export. Keep the original capture and its time window. Do not replace an existing incident capture with a later empty rolling-window query.

This documentation example has application status **503** and provider status **404**:

```json
{
  "event": "oidc-jwks-failed",
  "errorClass": "configuration-error",
  "endpoint": "https://keycloak.example.com/realms/coding-box/protocol/openid-connect/certs",
  "httpStatus": 404,
  "requestId": "example-request-123"
}
```

Do not include Authorization/Cookie headers, access/refresh/ID tokens, client secrets, callback/exchange codes, PKCE values, complete HAR files, provider response bodies or person/response data. This procedure does not require inspecting token values or dumping environment/configuration files.

**Choose and verify the operational action**

- For `provider-unavailable`, check DNS, routing/VPN, TLS and reachability **from the backend** to the failing endpoint. A successful browser login does not establish backend-to-provider or JWKS connectivity. Restore that connection and retry; the draft must remain intact and saving must succeed afterwards.
- For `configuration-error`, compare `OIDC_ISSUER`, `OAUTH2_CLIENT_ID` and the failing endpoint with the intended provider/realm. The issuer must match the provider's token issuer exactly. An intentionally internal `OIDC_JWKS_URI`/token endpoint may use another address, but it must be reachable by the backend. A structurally valid but wrong issuer can produce JWT 401 instead of `configuration-error`. Correct the specific deployed setting using the deployment's change/rollback procedure, then retry and confirm that the old warning disappears.
- For `session-invalid`, reauthenticate the same person and verify the recovered coding context and draft. For 403, verify the intended permission; do not broaden access as a diagnostic shortcut.
- Record the before/after application status, matching request ID, safe event and recovery result. The live F05/F06 example in the acceptance protocol correlates application 503 with provider JWKS 404, restores the configuration and confirms the preserved draft after saving/reloading. F02 separately confirms refresh `invalid_grant` handling with application 401 and provider status 400. These are distinct recovery paths.

## 6. Security Considerations

### Token Types and Permissions

This overview describes the integrated state. The binding external allow/deny
matrix and safe legacy transition are tracked separately in
[#569](https://github.com/iqb-berlin/coding-box/issues/569); this chapter does not
preempt its acceptance.

| Type/scope | Reach and limits |
| --- | --- |
| OIDC user access token | Provider-signed RS256 JWT for the configured client; application roles, workspace membership and route determine actions. Lifetime follows provider/client and `exp`. |
| Workspace `replay:read` | Explicitly enabled replay/player/metadata routes and compatible statistics POST in the bound workspace. Default maximum 90 days, configurable through `WORKSPACE_TOKEN_REPLAY_READ_MAX_DURATION_DAYS`. |
| Workspace `replay-statistics:write` | Explicitly enabled statistics action, not general write access. Maximum 1 day. |
| Workspace `coding-job:operate` | Currently explicitly enabled job-note reading, not general job write or admin access. Maximum 1 day. |
| Provider client-credentials token | Issuance through `/api/auth/token` does not define standalone machine access. Acceptance and permissions must be specified for a concrete consumer separately. |

The statistics POST intentionally **also accepts `replay:read`** so the existing
replay can record its statistics. This historical scope is therefore not universally
read-only. `replay-statistics:write` is an additional explicit alternative; retain
this compatibility exception during the legacy transition.
[Implementation](../apps/backend/src/app/admin/replay-statistics/replay-statistics.controller.ts).

Workspace tokens are HS256 tokens with `token_use=workspace`, `iss=coding-box`,
`aud=coding-box-workspace-token`, a bound workspace ID and scopes. Combined scopes
use the shortest applicable maximum lifetime. Issuance uses user/workspace-guarded
token routes, not another workspace token. The server limits duration and audits
issuance. Use tokens only in the intended protected application/integration; do
not paste output or Authorization headers into support messages.

`ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS` currently defaults to `true`. It accepts the
checked old format without modern type/issuer/audience claims; absent scopes gain
only `replay:read`. Signature, expiration and workspace binding remain required.
Before disabling it, inventory consumers, issue modern tokens with minimum scopes
and check replay/frontend behavior against guard tests. New integrations should
not rely on the legacy format. A workspace token does not replace an OIDC user
session and cannot access a route without explicit allowance; scope checks may
also return 401.

Sources: [token rules](../apps/backend/src/app/auth/workspace-token.ts),
[strategy](../apps/backend/src/app/auth/workspace-token.strategy.ts),
[issuance](../apps/backend/src/app/admin/workspace/workspace-users.controller.ts),
[guard tests](../apps/backend/src/app/auth/jwt-or-workspace-token-auth.guard.spec.ts)
and [strategy tests](../apps/backend/src/app/auth/workspace-token.strategy.spec.ts).

### Provider Requirements and Limits

[#570](https://github.com/iqb-berlin/coding-box/issues/570) separately tracks full
provider boundaries. The current backend bearer path requires:

- JWT access tokens, RS256 and reachable JWKS with a matching key. Opaque tokens
  or other signature algorithms are not supported by this path.
- Exact `iss`, nonempty `sub`, and matching `azp` **or** `aud` containing
  `OAUTH2_CLIENT_ID`. It uses `preferred_username`, falling back to `sub`.
- Callback/userinfo uses `sub`, `preferred_username` and optional `given_name`,
  `family_name`, `email`; align these claims deliberately for another provider.
  Admin status/frontend roles expect `realm_access.roles`.
- Account management uses `referrer`/`referrer_uri`, a remaining Keycloak assumption.
  Other providers need suitable profile-management and claim mapping configuration
  or a concrete adaptation.
- Distinguish the active OIDC service, Keycloak deployment/theme and remaining
  `KeycloakAuthService` helper files. The latter are not registered as an
  alternative login implementation in the active Auth module.

Keycloak is evidenced; no additional provider has been accepted live. A new
provider needs a concrete use case and matching checks, not only a base-URL change.

### Secret Management and HTTPS Requirements

Protect provider credentials, `JWT_SECRET`, admin and database passwords separately.
Use only trusted private operator files; migrations read them as Bash. Never put
real secrets or tokens in documentation, tickets, screenshots or logs. Operational
public browser endpoints/callbacks require valid HTTPS. Explicitly define internal
backend addresses and their trust/network boundaries. HTTP examples refer to the
isolated local development network.

## 7. Migration Guide

Existing installations must follow the
[verified upgrade and restore procedure](auth-upgrade-and-restore.en.md).
It covers consistent application/provider/asset backups, private file backups,
legacy additions, rejection of duplicate/partial configuration and safe repetition
without realm reimport. For queue/application version changes also consult
[backend operations boundaries](backend-hardening.md).

Migration retains a complete operator configuration. It changes only explicitly
supported legacy configuration or a missing/unsafe workspace signing key; plan
existing-token effects beforehand. On failure the updater stops by default.
A full restore can lose provider sessions and does not globally revoke tokens.

[#565 was accepted within its documented scope](https://github.com/iqb-berlin/coding-box/issues/565#issuecomment-6395469691):
[live protocol](qa/auth-upgrade-565-2026-10-25.md) and
[sanitized evidence](qa/auth-upgrade-565-evidence-2026-10-25.json).
A complete interactive updater, Keycloak major upgrade, production TLS operation
and production queue restore were outside that evidence. Final script additions
were checked by file regressions; no repeated complete live restore is claimed.

For fresh installations use section 2.3. Fresh installation, provider change,
Auth configuration migration and DB schema rollback are different operations;
do not conflate them through repeated realm/user imports.

## Verification and Acceptance

- [#564: accepted fresh-install scope](https://github.com/iqb-berlin/coding-box/issues/564#issuecomment-6389951706).
- [#565: accepted upgrade/restore scope](https://github.com/iqb-berlin/coding-box/issues/565#issuecomment-6395469691).
- [#1018: session/error handling](https://github.com/iqb-berlin/coding-box/issues/1018),
  [diagnostic/browser protocol](qa/auth-acceptance-2026-10-23.md).
- [#569: external token permissions](https://github.com/iqb-berlin/coding-box/issues/569),
  [#570: provider limits](https://github.com/iqb-berlin/coding-box/issues/570).
- [#571 documentation verification](qa/auth-documentation-571-2026-10-25.md).

Accepted subtasks remain limited to their own verified scope.
#571 remains open until its own explicitly confirmed acceptance.
