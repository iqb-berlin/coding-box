Backend build comparison pilot
=============================

Base: develop, 7a4197c5badd19a89c220c4c1c83e85f1cff82dd (PR #1157 merged).
The regular backend:build target is unchanged. All pilot targets are opt-in.

Prerequisites
-------------
Use Node 24.22.1 and the repository lockfile. Install dependencies physically
inside this checkout (npm ci), or use a filesystem clone. A node_modules symlink
changes esbuild's embedded module paths and fails the existing generated-engine
reproducibility assertion. No generated engine is rewritten for this pilot.

The fixture needs PostgreSQL 14 command-line tools, Redis 7.4.2 (server and CLI),
a Java runtime, Keycloak 26.4.0 and Liquibase 4.28.0. It owns only loopback ports
25441, 26441, 28441, 3333 and 24200. Never point it at application databases.

Prepare the private distributions in tmp/backend-build-comparison/infra:

  curl -fL https://github.com/keycloak/keycloak/releases/download/26.4.0/keycloak-26.4.0.tar.gz -o keycloak.tar.gz
  tar -xzf keycloak.tar.gz
  mkdir liquibase
  curl -fL https://github.com/liquibase/liquibase/releases/download/v4.28.0/liquibase-4.28.0.tar.gz -o liquibase.tar.gz
  tar -xzf liquibase.tar.gz -C liquibase

From the repository root, with a real Redis binary on PATH or explicitly set:

  BUILD_COMPARISON_REDIS_SERVER=/path/to/redis-server python3 tools/backend-build-comparison/local-infra.py --serve

Keep this process alive in its own terminal. It creates fresh private data,
applies the actual Liquibase changelog, imports synthetic Keycloak realms and
starts local Redis. Existing directories and occupied ports require inspection;
it never clears an unknown database. serve-local-infra.py resumes Redis/Keycloak
after an interrupted provisioning process, preserving the private realm data.

Measurements
------------
Run without concurrent frontend or backend validation. The measurement runner
uses fresh processes, removes only its own variant output, disables Nx task
caching and changes the build order over three rounds. Both bundlers use blocking
type checking. Watch updates cover a small HTTP helper and a shared DTO; source
files are restored and rebuilt before the watcher is stopped.

  NX_DAEMON=false NX_NO_CLOUD=true npx nx run backend:compare-builds --skip-nx-cache

Build equivalence
-----------------
The experiment applies the same source annotations to all variants:
  - explicit varchar for ValidationTask.validation_type (same SQL schema);
  - explicit string for AppLogoDto.alt (required by SWC/Swagger metadata).
The controller import test explicitly imports its reflect-metadata prerequisite.

backend:build-webpack-pilot:production uses the existing production configuration.
backend:build-rspack-pilot:production uses Nx/Rspack's builtin SWC loader, ES2021,
native ESM externals and an independently checked TypeScript checker plugin.
backend:build-tsc-pilot uses the TypeScript compiler without a bundler; it adds
Node file extensions and JSON import attributes only to emitted files, copies
assets and keeps the generated CJS autocoder in a .cjs file.

The capture-metadata.mjs preloader intercepts the actual artifact's registered
DataSource before connecting to PostgreSQL. It builds full TypeORM metadata and
writes the existing schema snapshot representation. It does not synchronize or
modify a schema. BUILD_COMPARISON_METADATA_FILE selects the output JSON path.

Checks
------
Run each target sequentially. The frontend production build must complete before
the API proof hashes it or the browser fixture serves it.

  npx nx build frontend --configuration=production
  npx nx run backend:compare-build-common-checks --skip-nx-cache

For each of webpack, rspack and tsc:

  npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=codebook --skip-nx-cache
  npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=worker --skip-nx-cache
  npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=browser --skip-nx-cache

The browser phase serves the same frontend build with its own local proxy and
runtime configuration. All existing workflow assertions run against real local
services. local-docker-transport.py translates only the fixture's known SQL/Redis
transport calls; no application response, SQL result or assertion is simulated.

The existing Codebook proof runner is adapted for private loopback ports, artifact
hash input, imports and the actual 169-change migration ledger. Export/autocoder
assertions are unchanged. The original and adapted runner hashes are recorded.

  python3 tools/backend-build-comparison/compare-openapi.py
  python3 tools/backend-build-comparison/report.py

Evidence and cleanup
--------------------
Measurements, reports and logs are in tmp/backend-build-comparison. Auth fixture
state and passwords are private prerequisites, not public evidence. The HTML
report distinguishes a local sequential CI-cost model from actual GitLab runner
or critical-path timing; no candidate remote pipeline was published.

Stop the private service supervisor when finished. Stop only this fixture's
PostgreSQL with pg_ctl -D tmp/backend-build-comparison/infra/postgres stop.
Never use Docker prune, application Redis flushes or application volume cleanup.

Actual GitLab/Linux follow-up
---------------------------
The compare-backend-builds branch retains the opt-in local targets. Three separate
measurement branches replace backend:build with exactly one pilot, outputting to
dist/apps/backend. Application sources and all other checks remain identical.
They use the complete branch pipeline, explicit backend builds and no Nx cache.
CI Docker builds use fresh Docker-in-Docker daemons, --pull --no-cache and the
actual production Dockerfiles, including an npm ci --omit=dev. The tsc output
keeps its ESM package.json under runtime/, since Docker restores the workspace
manifest without a type field at the image root. A countercheck confirmed that
Node 24.22.1 also loads the original layout; the nested scope makes ESM explicit,
rather than fixing a demonstrated startup crash. No shared latest image tags are updated.
The standard production setup on develop is not changed by these experiments.

The initial local report is historical evidence. Its computed local cost model
cannot establish GitLab duration or a significant end-to-end improvement.

The measurement helper is sourced by the container job; actual docker build
commands remain inline and are still checked by the existing quality gate.
Docker diagnostics have time bounds; build logs stream live while being saved.
The initial remote preparation series exposed a test-parser conflict with a
second global CI variable map. Benchmark variables now live in .gitlab-ci.yml.
Preparation runs are recorded separately from the final comparison series.
