# Redis reliability and deployment

Redis stores Bull workflow state as well as caches. Do not use FLUSHDB/FLUSHALL as cache maintenance. Do not set an allkeys eviction policy on this instance.

## Application changes

- Filter and replay caches use monotonically increasing generations; an in-flight query writes only to its captured generation. Filter payloads expire after five minutes. Replay payloads live for 48 hours; the nightly warmup checks remaining TTL without fetching payloads. It preserves entries with more than 24 hours left and refreshes missing or soon-expiring entries from PostgreSQL before expiry. It does not extend old contents indefinitely, so even a missed invalidation remains bounded. This retains the intended replay performance for large workspaces while allowing a missed nightly run. Imports/response mutations using workspace-stat invalidation also advance replay generations. Redis cache calls fail quickly and fall back to database reads; a failed invalidation is still an operational warning and must not be ignored.
- Upload sessions are mandatory workflow state. A failed session write returns 503. Chunk acknowledgements use an atomic Lua update and refresh the session TTL.
- New upload job results are gzip files under `temp/job-results` (`export_temp_vol` on API and workers, outside the public packages directory). The public upload-status response still hydrates full results, including legacy inline results. If file storage fails after an import committed, the processor logs an error and falls back to the legacy inline result to avoid presenting a successful import as failed. Include this directory in volume backups. Keep files through deployments. Files become cleanup candidates after eight days, but remain available while their owning Bull job exists. Ownership sidecars must be backed up together with the result files. Redis errors or unknown ownership prevent deletion; completed upload and response-analysis jobs retain at most seven days/100 entries. Failed jobs retain at most 30 days/100 entries. Bull applies retention when subsequent jobs finish; this is not an exact-time TTL. Activating retention can also age out legacy finished jobs in those queues: review/export required history before deployment. No job cleanup is performed by this repository change itself.
- Analysis jobs return a compact reference to the short-lived analysis cache. Existing UI reads this cache and can request recalculation after expiry.
- The process overview captures queue IDs in a Redis transaction, then retrieves job details in batches of 50, preserving its existing API response without skipping jobs that change state between batches. Other queue retention policies are unchanged to preserve paused/manual workflow semantics.
- `/api/health` remains liveness. `/api/health/ready` returns 503 within 1.5 seconds when Redis is unavailable. Keep liveness separate from dependency readiness to avoid restart loops. Route a monitor to readiness even if Docker's process health remains green.

## Deployment and rollback

Deploy the API result reader before workers begin writing result references, or update both together in a maintenance window. API and workers must mount the same persistent `export_temp_vol` at their working-directory `temp` path and use compatible file permissions. An alternate `JOB_RESULT_DIR` must likewise be shared and private. Verify an upload and its complete status response after deployment.

After reference results exist, rolling back to an older API loses the ability to display those reports. Preserve the result files and keep the compatible reader during rollback (or migrate those specific results back to the legacy format before downgrading). Never delete the volume as part of rollback. This change does not migrate existing large Redis results; their memory is only released through reviewed retention or separate cleanup.

## Memory

Production Compose preserves unlimited memory by default (`REDIS_MAXMEMORY=0`, `REDIS_MEMORY_LIMIT=0`) and uses `noeviction`. Do not introduce a fixed budget until the full replay warmup, simultaneous imports, host headroom and peak persistence rewrite memory have been measured. Then set explicit deployment-specific limits, with a container limit above Redis maxmemory to allow persistence and overhead. Writes can fail at maxmemory; monitor and retain history deliberately. Redis database numbers or key prefixes do not provide memory isolation.

## AOF migration for an existing RDB installation

**Do not simply recreate an RDB-only Redis container with appendonly=yes.** The default stays `REDIS_APPENDONLY=no` to avoid starting against an empty AOF history. Activate AOF on the running server first, following the official Redis persistence migration procedure.

1. Check `INFO persistence`, `INFO memory`, free space on the Redis volume and existing backup/restore coverage. Confirm no simultaneous backup/rewrite and take a recoverable snapshot of the Redis volume. Include workflow/file dependencies when planning a restore.
2. On the running Redis instance, set `appendfsync everysec`, then `appendonly yes` using CONFIG SET. This initiates an AOF rewrite; do not stop the container while migration is unfinished.
3. Wait for `aof_enabled=1`, `aof_rewrite_in_progress=0`, `aof_last_bgrewrite_status=ok`, `aof_last_write_status=ok`; verify the AOF files on the persistent volume. If these checks fail, retain the running instance and investigate rather than recreating it.
4. Set `REDIS_APPENDONLY=yes` in the server environment used by Compose and validate the rendered configuration. This step requires write access to the server's deployment files. A runtime setting alone is not a persistent deployment configuration.
5. In an agreed maintenance window, verify restart/restore behavior and compare queue counts, pending work and application readiness. Test failure/replay behavior in isolation, never by crashing production.

`appendfsync everysec` reduces the usual loss window to approximately one second; it is not a zero-loss or exactly-once guarantee. Preserve PostgreSQL locking/idempotency and recovery procedures.

## Monitoring

Alert on readiness non-200 or timeout; Redis availability; memory above 80% of a configured nonzero limit, or host memory pressure when unlimited; RDB/AOF failures; queue failures and oldest waiting-job age. Include an alert if the readiness target disappears. Do not interpret Bull's blocking clients as an outage or global Redis keyspace hit rate as the application cache hit rate.

Cache and queue separation is an optional next migration. It needs separate configuration endpoints and independent budgets/persistence. Do not evict upload sessions or Bull keys when making cache eviction more aggressive.

References: [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/), [Bull retention](https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md).
