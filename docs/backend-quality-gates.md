# Backend reliability checks

`GET /api/health` checks process liveness. `GET /api/health/ready` checks
PostgreSQL and Redis concurrently and returns 503 if either check fails or takes
longer than one second. Pending probes are shared until the underlying operation
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

Missing services, migration errors, failed tests, skipped suites and individually
skipped mandatory tests fail the gate. Only the optional Kappa benchmark may be
skipped, and it must pass when explicitly enabled. JUnit and JSON
results are written separately from unit-test reports under
`coverage/apps/backend/integration-*`.

The GitLab `test-backend-integration` job is mandatory under the shared quality
gate rules, including develop/main pull requests and releases. Backend image and
publication jobs depend on it. It uses isolated PostgreSQL and Redis service
containers. Local development can still run ordinary mocked unit tests without
those services; explicit PostgreSQL test variables are included in their Nx
cache inputs.


## Response list and total against PostgreSQL

`flat-response-filters.postgres.spec.ts` runs the real response service and its
TypeORM queries against synthetic, unlogged tables in a unique schema. It checks
response IDs and totals for NULL/blank/empty-array values, inclusive duration
bounds, session IDs, independently matched browser/OS dimensions, pagination,
multiple matching tags, exclusions and combinations of filters. Only the source
of cached workspace exclusions is replaced; list and count queries execute in
PostgreSQL. ORM metadata and raw EXISTS subqueries use the same test search path.
The suite drops its own schema during cleanup and never synchronizes entities.

The existing mandatory integration gate discovers this `.postgres.spec.ts` suite
automatically. For a focused development run, explicitly point the test variables
to disposable PostgreSQL, enable `POSTGRES_INTEGRATION_TESTS=true`, then run:

```sh
npx nx test backend --testPathPatterns=flat-response-filters.postgres.spec.ts --runInBand --skip-nx-cache
```

Use `.nvmrc`'s Node version. Database connection variables are `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`; the user
needs permission to create and drop schemas in that test database. Without the
explicit integration flag the normal unit run skips the suite, as it does the
other PostgreSQL suites; such a skip is not evidence that this test passed.
