# Autocoding schema resolution: verification record

## Change and expected behavior

Whitespace around a coding scheme reference is removed before lookup. A declared
reference to a missing, malformed or empty scheme fails preflight instead of using
an empty scheme. The readiness response reports the same file blockers even when
other tasks in the selected scope are codeable.

Tasks that intentionally declare no coding scheme are skipped. Their response
data and manual results are preserved. Only processed tasks enter persistence,
generated-response cleanup and the `CURRENT` transition.

Automatic freshness summaries and scopes exclude verified Unit files without a
scheme reference. Existing pending rows for these tasks therefore do not block
run 2. Manual freshness remains visible. Missing Unit files and declared scheme
references remain relevant; legacy null lookup metadata is supported.

## Local verification, 2026-11-09

Runtime: Node 24.22.1, baseline `7a4197c5badd19a89c220c4c1c83e85f1cff82dd`.

| Check | Result |
| --- | --- |
| Complete backend Jest suite | 4,250 passed; 163 infrastructure cases skipped |
| Isolated PostgreSQL freshness module suite | 9 passed, including the run-1/run-2 regression |
| Backend lint | Passed |
| Backend production build | Passed |
| Existing Cypress job-feedback workflow, API fixtures | 2 passed |
| Counterfactual removal of both review fixes | All 6 selected regression cases failed as expected |

The PostgreSQL checks used a disposable local cluster and the real module,
repositories and migrated schema. They verified preserved skipped responses,
manual freshness visibility, exact alias preference, missing-file blockers and a
new declared reference making an existing pending row relevant again. The cluster
was stopped and removed after the run.

Reproduce from the repository root, using the pinned runtime and separate backend
and frontend commands:

```sh
NX_DAEMON=false npx nx test backend --maxWorkers=2
NX_DAEMON=false npx nx lint backend
NX_DAEMON=false npx nx build backend
POSTGRES_INTEGRATION_TESTS=true NX_DAEMON=false npx nx test backend --runInBand --testPathPatterns=coding-freshness.postgres.spec.ts
NX_DAEMON=false npx nx e2e frontend --spec=cypress/zoneless/test-person-coding-feedback.cy.ts --browser=electron --watch=false
```

The PostgreSQL command requires an isolated PostgreSQL database, `psql` and the
`POSTGRES_*` connection settings. Its fixture creates and drops a separate test
database; do not point it at an application instance.

## Evidence boundary

Local automated validation is complete. The browser tests use API fixtures and
verify job feedback; they are not an authenticated production acceptance.
Remote CI, merge, release and production availability must be verified separately.
