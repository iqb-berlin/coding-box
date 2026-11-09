Docker build optimization with Webpack
=====================================

Application code, Webpack and the workspace lockfile remain unchanged.
The root Dockerfile still produces the full development/test builder by default.
docker-bake.json links that builder directly into the existing application
Dockerfiles. Only the backend runtime image is exported; no full builder image is loaded
into Docker Engine first. The new Bake path requires Docker Buildx/Bake.

Build the backend production image from the repository root:

  docker buildx bake --file docker-bake.json backend

Optional environment variables: REGISTRY_PATH, BACKEND_IMAGE.
Inspect the complete configuration without building:

  docker buildx bake --file docker-bake.json --print backend

The two npm installations retain the full workspace lockfile, local vendor
overrides and the pinned npm version. Native runtime modules still compile on
Bookworm with Python/make/g++, and are copied into the slim Bookworm runtime.
The GitLab install job caches only downloaded npm packages in .npm. Its
node_modules artifact is retained for all dependent jobs; npm ci recreates that
tree on every install anyway. The project-local .npm cache is excluded from
the Docker context. The npm-downloads-v1 cache key separates this format from older archives that
include node_modules. The first run creates the new download cache; the old
archive is neither restored nor deleted.

Installation layers depend on package.json, package-lock.json and vendor only.
An application source edit therefore must not rerun either installation.

Measurement
-----------
The before/after measurement branches run the full existing branch pipeline.
A normal container job builds once. Set DOCKER_BUILD_BENCHMARK=true to record
a cold build in its own fresh Docker-in-Docker daemon, an unchanged rebuild and
a source-only rebuild. Set NX_SKIP_NX_CACHE=true, NX_DAEMON=false and
NX_NO_CLOUD=true for both sides of the comparison. The source-only change appends a
comment to AppLogoDto; the exact original file is restored, including on error.
No cache or volume belonging to another job or developer is removed.

Both variants use Node 24.22.1, npm 11.19.1, Webpack, linux/amd64 and the same
application source and lockfile. Nx task caching is disabled for the experiment.
The shared external registry/dependency proxy is not cleared. Actual GitLab
created_at/finished_at, reported duration, job time and job queues are separate
metrics; sums of parallel job times are not pipeline wall time.

Original logs, phase timings, image inspections, artifact hashes and 43 entity
metadata records are archived under dist/docker-build-benchmark in the job.
Existing native-module, ESM interop, API, worker and SIGTERM checks remain blocking.
The baseline uses the old two-build/export workflow; the optimized run uses Bake.
Use the original branch SHAs from tmp/docker-build-benchmark/experiment.json.
The former compiler comparison is historical context, not this experiment's
before measurement. New measurements are required for end-to-end conclusions.

After importing each job's archive under tmp/docker-build-benchmark/before or
tmp/docker-build-benchmark/after, validate and summarize it:

  python3 tools/docker-build-benchmark/summarize.py

Review limits
-------------
The new production path avoids a builder export. Existing legacy commands that
explicitly build/publish coding-box-base still export a full builder; release
test-image consumers need that full image. The development and release-testing
contracts are preserved. There is no persistent cross-pipeline BuildKit cache
in this change: warm/source-only cache results describe the same daemon only.
One full pipeline per variant does not establish a statistically stable CI gain.
