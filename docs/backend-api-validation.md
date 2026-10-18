# API validation and error handling (first part of #1047)

This change ports the HTTP boundary work from `nest-validation-error-ci` onto
`develop`, independently of the CodingJobService decomposition. The audited PR
head is `286fe0982e574c81116370f8a2f25896240c07bd`; the initial base is
`a8a48d0216f5bb48feae99b578f9e09153ffa785`. The isolated branch was then
updated to `3e9ce1d027ad439727b97d68d2e9bbbc3b6c233d`, including merged #1036.
There are no changed-file overlaps with #1036; backend, shared DTO and build/test
configuration index entries remained byte-identical during this base update.

## Request contracts

- The API bootstrap installs a global validation pipe. Decorated DTOs, nested
  variables, numeric path parameters and scalar query parameters are checked
  before handlers run. DTO bodies must be objects: arrays cannot bypass
  class-validator when `forbidUnknownValues` is disabled.
- `api-dto/request-contracts.ts` supplies JSON schemas for erased interfaces,
  inline objects, arrays and DTOs that previously only described Swagger fields.
  `RequestBody<Name>` derives the input type and `ValidatedBody(Name)` attaches
  runtime validation and the matching OpenAPI request schema together.
- No JSON coercion or global property stripping is enabled. Existing display
  fields, optional bodies, nullable discussion results and `maxCodingCases: null`
  remain supported. Entity writes select their writable fields explicitly;
  unknown fields cannot overwrite user/workspace IDs or bundle ownership.
- Existing manual Codebook normalization remains authoritative for its legacy
  numeric-string inputs, defaults and export-format normalization. Existing
  stricter local DTO pipes for job definitions, review and notifications remain.
- Chunked-upload sizes must be positive safe integers before a session or
  temporary directory is created.
- Bulk job deletion validates the array elements and retains workspace and actor
  context. Unit annotation reads/writes include workspace ownership predicates;
  their batch service callers pass the workspace too.

## Errors

Service HTTP exceptions retain their status. Generic controller catches must
propagate unexpected errors to `GlobalHttpExceptionFilter`, which returns a safe
500 with a request ID and logs the original stack. Coder directory failures and
Codebook status failures no longer appear as successful empty/error responses.
Download failures clear pending download headers before reaching that filter.
Malformed JSON, oversized requests and malformed multipart fields produce
400/413/400 respectively. Server error log URLs omit query parameters, including
Testcenter credentials. Deliberate per-file upload results and streaming progress
events retain their existing protocols.

## Quality gates and validation

PR #1046 (`31ad79f3ddd1d29c9e9fd77bc786433712e50782`) already made full backend and
frontend tests, lint, replay, authentication and workflow gates mandatory, with
JUnit/Cobertura reports and publication dependencies. Those current definitions
are retained. The old #1047 CI files would remove functional dependencies and
reintroduce obsolete frontend configuration, so they are not copied. The new
HTTP suites are discovered by the existing full backend test gate.

Run the checks separately, waiting for each command to finish:

```sh
npx nx lint backend
npx nx test backend --configuration=ci --maxWorkers=2
npx nx build backend --configuration=production
npx nx lint frontend
npx nx test frontend --configuration=ci --maxWorkers=2
npx nx build frontend --configuration=production
npx nx run frontend:test-quality-gates
```

The HTTP suites open real Nest listeners and use real controllers/pipes/filter,
with database/queue infrastructure mocked. They prove request rejection before
service calls, accepted frontend payloads, HTTP status preservation, safe server
errors, multipart recovery and cross-workspace annotation isolation. Query tests
also compile annotation predicates using TypeORM's PostgreSQL metadata without
connecting to a database. These checks do not prove a live full-stack deployment.

## Separate follow-up: service decomposition

Do not cherry-pick the old service extraction wholesale: current `develop` adds
ownership checks, actor IDs, audit events, locking and status-transition rules
that its extracted providers do not contain. Port against the current service,
preserving transaction/EntityManager boundaries and public facade signatures.

Suggested dependency order from the provider graph in #1047:

1. Extract common types and the derived-variable reader contract. Register its
   implementation in the owning module and retain the HTTP contracts from this
   first part. `ResponseMatchingFlag` is already shared here, with the old service
   export retained for compatibility.
2. Extract Query, Access, Scheme and Aggregation. Query owns visibility/exclusions;
   Access owns permissions; Aggregation depends on the derived-variable reader.
3. Extract Responses (Query, exclusions, peers and missings), then Mutation
   (Query, Access, Aggregation, Responses, cache, connection and repositories).
   Preserve ownership, journaling and lock semantics inside each transaction.
4. Extract Distribution (Query, Access, Aggregation, Responses, Mutation and the
   derived-variable reader), Progress (Query, Scheme), Replay (Query, Scheme),
   and Status (Query, Mutation). Keep CodingJobService as the compatible facade.
5. Update module/provider exports and factories together. Test the real AppModule
   graph with infrastructure stubbed, the built backend, ownership/status races,
   and the mandatory live replay/auth/workflow gates before integration.

Settings persistence, async logo storage, startup configuration validation and
the strict-diagnostics baseline are separate concerns also present in #1047.
They are not prerequisites for this HTTP change and are not included here.

Before integration, fetch `develop` again and recheck intervening changes. #1036
is already merged into this branch's base; this work requires its own review.

## Local delivery evidence (18 October 2026)

The final base is `3e9ce1d027ad439727b97d68d2e9bbbc3b6c233d` (merged #1036).
All commands below used the local Nx installation, with frontend and backend
validation performed sequentially. No application source changed during the
final test processes.

| Check | Result |
| --- | --- |
| Backend lint | Passed |
| Full backend tests, CI configuration with coverage disabled | 3,213 passed; 63 skipped; 203 passing suites |
| Focused HTTP, logo and bundle-controller tests | 215 passed |
| HTTP coverage, limited to five HTTP infrastructure files | 210 tests passed; 91.52% lines, 80.58% branches, 100% functions |
| Backend production build | Passed |
| Frontend lint on the updated base | Passed |
| Full frontend tests, CI configuration with coverage disabled | 2,985 passed in 277 suites |
| Frontend production build on the updated base | Passed |
| Existing CI/functional/JUnit gate regressions | 27 passed |
| Selected Cypress suites against the final production artifact in Chrome | 20 passed in seven suites |

The browser suites use controlled HTTP/authentication fixtures and cover the
landing page, workspace access, administration forms, upload, Testcenter import,
item-dataset export and failed export startup. They do not exercise a live
PostgreSQL/Redis/Keycloak stack. The new HTTP integration suites use real Nest
listeners and controllers with mocked infrastructure.

Full-project coverage is not claimed: the initial backend coverage attempt hit
`ENOSPC` while writing Jest transform-cache files. Fresh final processes disabled
the transform cache; full tests and focused coverage then passed. JUnit and the
focused Cobertura report were parsed successfully and saved in the attached
worktree's sibling `validation/` directory, together with the command logs and
machine-readable summary. Existing full-coverage CI requirements remain enabled.

These local results were recorded before publishing the focused branch as a
separate PR against `develop`. Remote pipeline results and integration must be
verified separately. The original #1047 branch remains at
`286fe0982e574c81116370f8a2f25896240c07bd`; its service decomposition stays separate.
