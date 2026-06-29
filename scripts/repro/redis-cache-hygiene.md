# Redis cache hygiene notes

Use `scripts/repro/redis-cache-inventory.mjs` before deleting Redis data. The
script is read-only and reports key counts, `MEMORY USAGE`, TTL distribution,
and the largest keys grouped by Kodierbox/Bull prefix.

## Current local finding

Measured on the local scale-test Redis after the 5000-person workspace run:

- `cache:responses`: about 72k keys, 1.8 GiB, all expiring. These are replay
  response cache entries from `ResponseCacheSchedulerService`.
- `queue:response-analysis`: 179 keys, 402 MiB, mostly without expiry. These
  are Bull job hashes. Completed response-analysis jobs used to retain large
  job return values.
- `cache:response-analysis`: 39 keys, 108 MiB. These are application result
  caches and derived page caches. Some have TTL, some are revision/run marker
  style keys without expiry.
- `cache:coding_applied_results_overview` and
  `cache:workspace-overview-stats`: under 1 KiB each. They are not the Redis
  pressure source.

## Cleanup classes

Safe to delete in local/performance test environments:

- `coding-box:cache:responses:<workspaceId>:*`
  Rebuilt from PostgreSQL on demand. Deleting this may make replay/unit-response
  views cold again, but does not lose source data.
- `coding-box:cache:response-analysis:<workspaceId>*`
  Recomputed by response-analysis. Deleting this may trigger a new analysis.
- Completed/stale Bull jobs in `coding-box:response-analysis:*`
  These should not be used as the durable result store. Results live in
  `cache:response-analysis:*`. New jobs now use `removeOnComplete` and
  `removeOnFail` to prevent future accumulation.

Do not delete blindly:

- Active, waiting, or delayed Bull queue keys for imports, exports, validation,
  coding jobs, and response-analysis. Use the process overview or Bull APIs to
  confirm job state first.
- `coding-box:cache:workspace_unit_variables:*` or similar workspace-file
  derived caches while users are actively coding. They are rebuildable, but
  deleting them can create avoidable cold UI work.
- Revisioned overview caches for active workspaces unless invalidating after
  data changes. They are tiny and intentionally no-expiry.

## Recommended local cleanup sequence

1. Run:

   ```bash
   node scripts/repro/redis-cache-inventory.mjs > /tmp/kodierbox-redis-inventory.json
   ```

2. If Redis memory pressure is local-test-only, delete expiring response cache
   keys for the scale workspace first:

   ```bash
   docker exec kodierbox-redis-1 redis-cli --scan --pattern 'coding-box:cache:responses:54:*' \
     | xargs -r -n 500 docker exec kodierbox-redis-1 redis-cli UNLINK
   ```

3. Clean completed response-analysis jobs through Bull/application APIs where
   possible. Avoid raw deletion while a response-analysis job is active.

4. Re-run the inventory and compare group totals.

## Product follow-up

- Keep `response-analysis` queue jobs small/short-lived. Completed jobs can be
  removed because the API reads durable results from Redis cache keys.
- Consider making the nightly response-cache warmup skip very large workspaces
  or use a lower explicit TTL. The default 24h TTL can consume multiple GiB on
  synthetic 5000-person data.
