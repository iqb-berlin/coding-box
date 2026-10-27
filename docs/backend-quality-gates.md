# Backend reliability checks

`GET /api/health` checks process liveness. `GET /api/health/ready` checks
PostgreSQL and Redis concurrently and returns 503 if either check fails or takes
longer than 1.5 seconds. Pending probes are shared until the underlying operation
settles, so health requests cannot accumulate database queries during an outage.
The Compose healthcheck uses readiness. The existing Redis diagnostics endpoint
also returns 503 on failure and has the same timeout.

Statistics calculation and queue errors propagate to the HTTP exception filter
or fail the worker job. Successful empty results remain valid statistics. A
missing or inaccessible statistics job returns 404; a queue outage returns 5xx.
Redis cache writes remain best effort and do not turn valid calculations into
failures when the cache service returns false.

Coding job IDs must be positive PostgreSQL integers. Profile ID `0` remains the
existing sentinel for selecting the default missings profile. Counts and durations must
be integers in their documented ranges, and double-coding percentages must be
between 0 and 100. Distribution requests use the same limits. Unknown display
fields remain accepted for existing clients; persistence must select explicit
write fields. Statistics query versions accept only `v1`, `v2`, and `v3`.

## Mandatory database and queue integration gate

Run `npx nx run backend:test-integration` with:

- `BACKEND_INTEGRATION_TEST_DATABASE_URL`: a dedicated, disposable PostgreSQL
  test server with permission to create databases.
- `BULLMQ_TEST_REDIS_HOST` and `BULLMQ_TEST_REDIS_PORT`: a dedicated test Redis.
- `PSQL_BIN` if `psql` is not available on PATH.

The runner never falls back to application database settings. It creates a unique
database, applies the repository's formatted SQL changelogs in include order,
enables every PostgreSQL suite and the real BullMQ tests, and runs them serially
without Nx caching. Suites that provision their own schema also receive the
explicit test server. The runner drops only its own database in cleanup.

Missing services, migration errors, failed tests and skipped suites fail the
gate. The optional Kappa benchmark remains disabled by default. JUnit and JSON
results are written separately from unit-test reports under
`coverage/apps/backend/integration-*`.

The GitLab `test-backend-integration` job is mandatory under the shared quality
gate rules, including develop/main pull requests and releases. Backend image and
publication jobs depend on it. It uses isolated PostgreSQL and Redis service
containers. Local development can still run ordinary mocked unit tests without
those services; explicit PostgreSQL test variables are included in their Nx
cache inputs.
