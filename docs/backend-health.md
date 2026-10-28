# Backend health checks

`GET /api/health` is the process liveness check. It returns HTTP 200 while the
HTTP server can respond, independently of PostgreSQL and Redis availability.

`GET /api/health/ready` checks PostgreSQL with `SELECT 1` and the existing BullMQ
Redis connection with `PING`. It returns HTTP 200 only when both checks succeed;
failures, timeouts and application shutdown return HTTP 503. The response contains
only `status` and `checks` (`database` and `redis`, each `up` or `down`). During
shutdown, `status` is `shutting_down` and checks may be empty. Responses are not
cacheable and contain no driver errors, connection addresses or credentials.

The checks run concurrently with a one-second response budget per dependency.
Concurrent polls share an outstanding operation. If a driver call outlives the
response budget, later polls reuse it until it settles, preventing an outage
from accumulating queries or Redis commands. The probe does not create new
connections, mutate data, scan Redis keys or inspect queue contents.

The supplied base Compose configuration uses the readiness endpoint for the API
backend healthcheck. External traffic readiness probes should use
`/api/health/ready`; process liveness probes should use `/api/health`. The
diagnostic `GET /api/health/redis` endpoint preserves successful responses but
returns HTTP 503 for disconnected or unready Redis. Its diagnostics share the
one-second response budget and never expose driver error details on failure.

The health endpoints do not prove successful authentication, correct migrations,
worker progress or functional acceptance. Exercise those separately when
qualifying a deployment.
