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

## Authentication rate limits

All routes on `AuthController` use Nest's controller-scoped throttler, including
login redirects, callbacks, token exchange, refresh, validation and logout.
The default is **120 requests per client and route in 60 seconds**. Set
`AUTH_RATE_LIMIT_LIMIT` and `AUTH_RATE_LIMIT_TTL_MS` to tune this for shared-NAT
deployments. Invalid settings fail API startup. IPv6 addresses share a `/64`
tracker, and route keys are based on handlers rather than user-controlled URLs.
For tokens with an issued-at claim, the browser caps proactive renewal at 10%
of the token lifetime, up to 30 seconds. Fresh short-lived tokens can therefore
serve API requests without triggering a refresh for every request.

The counter and block interval live in one expiring Redis hash below
`${REDIS_PREFIX}:auth-rate-limit:`. A Lua script uses Redis time and updates them
atomically, so replicas share the same limit. Requests beyond the limit receive
HTTP 429 with `Retry-After`; repeated blocked requests do not extend the block.
Redis failures return HTTP 503 before contacting the identity provider. The
dedicated Redis connection has one-second connect/command timeouts and does not
queue requests while disconnected. Health checks and coding routes are unaffected.

Forwarded client addresses are ignored unless `HTTP_TRUSTED_PROXIES` explicitly
lists proxy IPs, CIDR subnets or Express aliases (`loopback`, `linklocal`,
`uniquelocal`). The value `1` explicitly trusts a single ingress hop; unrestricted
trust and other numeric hop counts are rejected. Production Compose uses that
single-ingress contract: its API exposes no public host port, and each API request
arrives through one proxy. If the deployment changes, configure the actual proxy
addresses/subnets instead. In single-hop mode only the rightmost forwarded
address is used, including for private-network clients; forged earlier entries
cannot select a different rate-limit bucket. With address/subnet trust, Express
resolves the nearest untrusted address.

The mandatory backend integration gate also runs the real Redis counter tests.
Its fixture is shared only with the test Redis service, using a unique key prefix;
it never flushes application data.

## Reproducible backend runtime dependencies

Nest's core, common, Express adapter and testing packages use the 11.2.8 patch
line. Build and runtime Docker stages use npm 11.18.0. The runtime installs from
the unchanged workspace `package.json`, `package-lock.json` and local `vendor`
targets using `npm ci --omit=dev`. This preserves the locked dependency locations;
Nx's reduced lockfile can incorrectly relocate incompatible nested packages such
as Express 4 and 5. The image retains the manifests used for installation when
copying the compiled application. It includes all workspace production dependencies,
but omits development dependencies. The PostgreSQL driver and overrides come from
the workspace lockfile; no packages are added or resolved separately in Docker.

`npx nx run backend:verify-runtime-package` repeats the fresh production installation
with the Docker npm version in a temporary directory. It verifies unchanged
manifests and loads the HTTP adapter, queue, database and native XML/SQLite modules
without access to the workspace's `node_modules`. Both backend CI gates run it.

## BullMQ queues and cutover

All twelve queues use `@nestjs/bullmq` and BullMQ 6. Producers enqueue named jobs;
processors extend `WorkerHost` and retain a concurrency of one per worker. The
API/export-worker selection through `JOB_QUEUE_PROCESSORS` and
`DISABLED_JOB_QUEUE_PROCESSORS` is retained. Progress is stored with
`updateProgress()`, cooperative pause/cancellation with `updateData()`. Workers
turn failures of stopped jobs into `UnrecoverableError` so automatic retries do
not restart cancelled work. Ordinary retries and backoff remain available.
Prioritized jobs participate in workspace ownership, conflict and cancellation
checks, and appear as waiting work in the process overview (paused when their
queue is paused).
New jobs use UUIDs so the new queues cannot reuse old numeric IDs that still
identify cached export results. Explicit IDs for deduplicated cache work are
retained.

Bull and BullMQ do not guarantee compatible Redis data formats. The new queue
prefix is **`${REDIS_PREFIX}:bullmq`**, for example `coding-box:bullmq`. The cache
prefix stays separate. See the [BullMQ migration guidance](https://docs.bullmq.io/guide/migrations/bull-to-bullmq)
and [Nest queue integration](https://docs.nestjs.com/techniques/queues).

Before deploying the new API and export worker:

1. Block new queue-producing requests and quiesce scheduled producers while
   keeping the old workers running until their work is drained.
2. Drain all twelve old queues listed in `job-queue.config.ts`. Check the old
   `${REDIS_PREFIX}:${queue}` namespace: `LLEN` of `wait`, `paused` and `active`,
   and `ZCARD` of `delayed`, must all be zero. Resume or otherwise explicitly
   settle paused/delayed work before proceeding.
   Cooperative auto-coding pauses can also be completed jobs with
   `data.isPaused=true`; explicitly settle those planned runs as well.
   Stop the old API/workers and verify the counts again. If a producer raced
   with shutdown, restart the old version to finish that work before cutover.
3. Archive old job history and downloadable results if they must remain
   accessible. Completed/failed jobs stay under the old prefix; the new API
   does not read that history or automatically replay failed jobs.
4. Deploy the API and export worker together with the same Redis settings,
   verify a new job, and allow queue-producing requests again.

Do not reuse the old prefix, flush Redis, or copy raw Bull keys into BullMQ.
Application data and the old queue keys are retained. A rollback after accepting
new jobs also requires draining the BullMQ queues with BullMQ workers; changing
the application image does not transfer those jobs back to Bull.

### Queue verification

`npx nx run backend:verify-bullmq-live` starts its own loopback Redis process in a
temporary directory, runs the real Nest worker integration suite, and closes
both worker and Redis afterwards. A `redis-server` binary must be available on
`PATH`, or supplied with `BULLMQ_REDIS_SERVER=/path/to/redis-server`. Add
`--configuration=full` to run the complete backend suite against that fixture.
The runner does not connect to the application's Redis instance.

Both backend CI gates provide disposable Redis and enable this suite using
`BULLMQ_TEST_REDIS_HOST`/`BULLMQ_TEST_REDIS_PORT`. These variables participate in
the Nx test cache key, so a local run that skipped Redis tests cannot satisfy a
CI run with Redis enabled. The tests cover persisted
progress/results, namespace isolation, pause, prioritized work, ownership,
conflicts, cancellation and retries. The domain autocoder is mocked in these
queue tests; PostgreSQL workflows remain covered by their existing gates.

The Nest BullMQ 12 adapter supports Nest 11 but is ESM-only. The Node 22 Jest
configuration transforms only this adapter and its shared helpers to CommonJS;
the production dependency is used directly.

## Strict diagnostics

`backend:typecheck` also validates all PostgreSQL entity metadata using the
production TypeScript configuration, without connecting to a database. Nullable
union properties need explicit `@Column` types: with strict null checks their
reflected JavaScript type is `Object`, which PostgreSQL cannot map automatically.


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
npx nx run backend:verify-runtime-package
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
