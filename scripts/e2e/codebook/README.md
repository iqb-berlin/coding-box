# Local Codebook and Autocoder acceptance

This fixture uses a dedicated PostgreSQL database (port 15441), Redis (16441),
Keycloak (18441), and a production backend on `127.0.0.1:3333`. It seeds synthetic records with
SQL, submits jobs through the regular authenticated HTTP endpoints, observes
HTTP status and Bull records, downloads the output, and reads persisted results.
It never uses production data. Run it from an isolated checkout with Node 22.

Check available disk space first. Install the lockfile with `npm ci` if needed.
Frontend and backend tasks must run separately and sequentially:

```sh
export NX_DAEMON=false NX_ISOLATE_PLUGINS=false
NG_BUILD_MAX_WORKERS=2 npx nx build frontend --configuration=production
npx nx build backend --configuration=production

docker compose -p codebook-1041 -f scripts/e2e/codebook/docker-compose.yml up -d db redis keycloak
docker compose -p codebook-1041 -f scripts/e2e/codebook/docker-compose.yml run --rm liquibase
```

Wait until Keycloak's discovery endpoint responds:
<http://127.0.0.1:18441/realms/codebook-proof/.well-known/openid-configuration>.
The imported realm and its fixed credentials belong only to this loopback-only,
disposable fixture. Its password grant supplies an actual RS256 access token;
the backend verifies it with the realm's JWKS and configured client. Browser
authorization-code/PKCE login is covered separately by `frontend:e2e-auth-live`.

Start the backend in a separate terminal. The following credentials are only
for the disposable fixture. Do not use an existing backend on this address:

```sh
JWT_SECRET=codebook-disposable-local-proof-only \
OAUTH2_CLIENT_ID=codebook-proof \
OIDC_ISSUER=http://127.0.0.1:18441/realms/codebook-proof \
OIDC_JWKS_URI=http://127.0.0.1:18441/realms/codebook-proof/protocol/openid-connect/certs \
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=15441 \
POSTGRES_USER=codebook_test POSTGRES_PASSWORD=disposable_test_only \
POSTGRES_DB=codebook_test REDIS_HOST=127.0.0.1 REDIS_PORT=16441 \
REDIS_PREFIX=codebook-proof API_HOST=127.0.0.1 \
node dist/apps/backend/main.js
```

Once `/api/health` responds, run the acceptance target:

```sh
CODEBOOK_PROOF_DIR=/tmp/codebook-1041-evidence/live \
npx nx run backend:verify-codebook-autocoder-live
```

To also compare against a real installed Studio checkout, add
`STUDIO_REFERENCE_ROOT=/absolute/path/to/studio-checkout`. It must contain the
shared `4.1.0-dev.ff15d6d` tarball and installed dependencies. The reference loads
the actual Studio adapter and its installed generator without modifying the
checkout. Studio receives the explicitly expected filtered subset and item
identities; Studio repository/profile boundaries remain in memory. DOCX
comparison removes only creation/modification timestamps, then compares every
ZIP entry. The JSON comparison is structural and complete.

The report includes build, runner and package SHA-256 values, jobs, progress,
worker timestamps, expected scope/options, actual download hashes, independent
Responses 5.2.0 results and PostgreSQL result rows. Exports cover all/job/bundle/
intersection/reverse scopes, score/instruction toggles, missing profiles,
internal IDs before aliases, and legacy metadata values `0` and `false`.
Six SOLVER cases cover rounding/equality near zero, NULL, non-finite results,
read-only configuration and a scientific-notation text value; each includes
an actual dependent SUM_SCORE. Failed Codebook scope and invalid Autocoder
namespace must fail in the queue; failed Autocoder preflight must leave every
response unchanged.

The runner creates a fresh workspace per run and leaves synthetic evidence for
inspection. Stop only this backend process and these containers when finished.
The report is an API/DB/queue acceptance, not a real-user browser or Word-layout
acceptance. Browser option/progress behavior has a separate Cypress suite.
