# Persistent item matrix diagnosis acceptance

Use the disposable Compose fixture from `../codebook/README.md`, including its
database migrations and OIDC realm. Build frontend and backend separately.
Start the production backend twice, once with `APP_ROLE=api` and once with
`APP_ROLE=export-worker`. Both processes must share this checkout's `temp`
directory and use `REDIS_PREFIX=item-matrix-proof`. All remaining database,
Redis and authentication settings are the codebook fixture's settings.

Run from this checkout with Node 24.22.1:

```sh
ITEM_MATRIX_DISPOSABLE_FIXTURE=true npx nx run backend:verify-item-matrix-live
```

The runner inserts synthetic records into the dedicated local database. It
creates 2,740 people and 5,480 unresolved derived cells, evenly divided between
`derived-result-missing` and `derived-source-unresolved`. CSV/score and Excel/code
exports use the authenticated HTTP API and the real export worker. Assertions
cover exact cell counts, identifiers and coordinates, deterministic output,
both diagnosis files in the incomplete ZIP, workspace isolation, and unchanged
response records. It removes each export job through HTTP, verifies its removal
from BullMQ, and downloads the same archived CSV again after job/cache cleanup.

Stop and restart only the two backend processes, preserving `temp`. Then run:

```sh
ITEM_MATRIX_DISPOSABLE_FIXTURE=true npx nx run backend:verify-item-matrix-live --args="--after-restart"
```

The second phase verifies the archived bytes and unchanged response data after
both process restarts. Evidence is written to `dist/item-matrix-proof/`; set
`ITEM_MATRIX_PROOF_DIR` to use another directory. Synthetic workspaces remain
available for a separate browser acceptance against the built frontend.

This is an isolated API/database/queue acceptance. It does not establish an
acceptance with the original issue's data or a production deployment.
