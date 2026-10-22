# Backend hardening after the API/service split

This completes the independent follow-ups from #1047: #1068–#1073. It builds on
the current HTTP contracts, audit transactions, OIDC authentication and coding
providers; it does not restore the old branch's CI or dependency definitions.

## Startup configuration

Both root modules validate the effective `.env.dev`/process configuration before
creating infrastructure providers. Process variables keep precedence. PostgreSQL
host, port, user, password and database are required. Redis keeps its existing
host/port/prefix defaults; explicitly empty required fields and invalid ports fail.

The API additionally requires `JWT_SECRET`, `OAUTH2_CLIENT_ID`, `OIDC_ISSUER` and
`OIDC_JWKS_URI`. Issuer/JWKS and configured optional OIDC endpoints must be HTTP(S)
URLs without embedded credentials or surrounding whitespace. Public clients may
omit the OAuth client secret. Optional account/login/token/userinfo/logout URLs
may stay empty for deployments that do not expose those operations.

These are the values consumed by the current OIDC services. Historical
`KEYCLOAK_*` variables do not supply an implicit issuer/JWKS/client fallback.
The export worker requires its infrastructure configuration, but does not require
API authentication settings. Other settings and secret values remain unchanged.
Validation errors contain field names and rules, not configuration values.

## Files, settings and shutdown

Logo storage uses a DI-managed asynchronous service and upload interceptor.
Settings are written to a unique sibling temporary file and atomically renamed.
Readers see complete JSON; temporary files are removed after success or failure.
Missing custom assets use existing defaults; other I/O and JSON errors propagate.
Routes, permissions, upload limits, MIME types and response shapes are preserved.

Workspace settings use one `WorkspaceSettingsService` exported by its owning
module. CRUD, defaults, keys, response formats, batch transactions and audit
events retain their previous behavior. All four controller-level regex-setting
readers use the same service. Persistence and actor-aware journaling use the
same transaction manager. No data migration is needed.

API and worker enable Nest's existing shutdown signals. The cache module
disconnects its owned Redis connection in the application-shutdown phase, after
module destroy hooks. It does not wait on a Redis command that could retry while
the server is unavailable. This adds no guarantee that arbitrary in-flight
business operations can be drained without interruption.

Replay overrides whose required values become empty after trimming return
HTTP 400 before persistence. Historical invalid entries remain ignored on read.

## Authentication request validation

The `auth/token`, `auth/validate`, `auth/exchange`, `auth/refresh` and `auth/logout`
POST routes use named shared contracts for their TypeScript input, AJV validation
and OpenAPI schemas. Required strings must be non-empty; exchange requests require
a 43-character base64url browser verifier. Unknown fields and malformed or absent
bodies receive HTTP 400 before authentication services or the provider are called.

Client-credentials and token-validation provider calls use a ten-second timeout.
Invalid credentials remain HTTP 401; network/server failures and invalid provider
responses receive HTTP 503 with safe error codes and request IDs. Provider payloads
and credentials are not included in diagnostics.

## Strict diagnostics

`npx nx run backend:typecheck` checks the production TypeScript program in strict
mode and requires zero diagnostics. Strict checking is also enabled in the normal
backend build. Property initialization remains exempted for Nest/TypeORM entity
and DTO properties initialized by the framework.

The legacy diagnostic baseline has been removed. Errors must be corrected in the
source rather than added to an allowlist. The checker also follows local,
imported, renamed and generic request type aliases to verify that `ValidatedBody`
and `RequestBody` refer to the same contract. Both backend unit-test CI jobs run
this required Nx check before publishing can proceed.

## Reproduce validation

Run frontend and backend tasks separately and sequentially:

```sh
npx nx lint backend
npx nx run backend:typecheck
npx nx test backend --configuration=ci --maxWorkers=2
npx nx build backend --configuration=production
npx nx run frontend:test-quality-gates
```

The settings PostgreSQL suite creates and removes only its uniquely named
fixture schema, with synchronization disabled. It checks existing keys, actor
metadata, CRUD and real rollback on a later write or journal failure:

```sh
POSTGRES_INTEGRATION_TESTS=true \
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=15441 \
POSTGRES_USER=codebook_test POSTGRES_PASSWORD=disposable_test_only \
POSTGRES_DB=codebook_test \
npx nx test backend --runInBand --coverage=false \
  --testPathPatterns=workspace-settings.postgres
```

For production-process probes, start only the disposable database/Redis services
from the [Codebook fixture](../scripts/e2e/codebook/README.md), apply all current
Liquibase changesets, and build the backend. Keep port 3333 free:

```sh
BACKEND_HARDENING_FIXTURE=true npx nx run backend:verify-hardening-live
```

The runner uses fixed loopback-only fixture addresses and refuses occupied
fixtures. It checks that invalid API configuration opens no infrastructure
connections; valid API and worker processes establish real PostgreSQL/Redis
connections; SIGTERM closes them within the timeout and restores the initial
connection counts. Worker startup omits API authentication settings. Logs and
a binary-hashed report are written under `dist/backend-hardening-proof`.

Unit subprocess tests separately observe all three awaited Nest shutdown phases
for API and worker on SIGTERM and SIGINT. The runtime probe does not exercise an
interactive OIDC login, a real user's browser, or a production deployment.


[Recorded local runtime proof](qa/backend-hardening-live-2026-10-19.json).
