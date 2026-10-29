# Test results and coder training use cases

This follow-up targets `nest-runtime-hardening` at
`f602256f81a9acce7e5b03dabbd85399c48a1de7`, the 30 October 2026 head of
[PR #1131](https://github.com/iqb-berlin/coding-box/pull/1131).
Work originally started at `615d78d33c1ec2b204df9f1a4362b2308c5b6913`. The later
parent update only adds a typed statistics-cache mock to a PostgreSQL fixture;
production implementations are identical. That PR remains open. Its runtime/authentication
changes and `WorkspaceDataModule` separation are prerequisites, outside this patch.
The larger service split belongs on its own follow-up branch.

The starting implementations had 8,206 and 5,178 lines. They combined unrelated
reads, data processing, writes and exports. Method ownership and dependencies,
rather than file length, determine the boundaries below. Existing HTTP controllers,
DTOs, queue producers/processors and the two application facades keep their contracts.

## Test results

`WorkspaceTestResultsService` delegates its 38 existing public methods to providers
in the existing `database/services/test-results` directory:

| Provider | Responsibility | Other new providers used |
| --- | --- | --- |
| `TestResultsQueryService` | Overview, person/booklet/unit navigation, quick search and log reads | None |
| `TestResultsResponsesService` | Flat response pages, frequencies and filter choices, including bounded regex/value searches | Anomalies |
| `TestResultsSearchService` | Coding-aware response search and status filtering | None |
| `TestResultsReplayService` | Workspace-scoped replay response reconstruction and its cache | None |
| `TestResultsAnomaliesService` | Log anomaly SQL, batched processing, summaries and details | None |
| `TestResultsDeletionQueryService` | Delete targets, cleanup selection, dependency snapshots and preview/count queries | None |
| `TestResultsMutationService` | Locked deletions, response-owner delegation, transactional audit and post-write validation | DeletionQuery, Cache |
| `TestResultsCacheService` | Availability, workspace-statistics and coding-statistics invalidation | None |
| `TestResultsExportService` | Streaming/file CSV exports, progress, log/session reconstruction and export choices | Anomalies |

`test-results.util.ts` contains shared, stateless query/value helpers;
`test-results-deletion.util.ts` contains deletion normalization, ID batching and
snapshot helpers. Neither can resolve providers. Shared implementation types live
in `workspace-test-results.types.ts`; the facade still re-exports the existing
public types.

The mutation provider retains the existing advisory-lock scope, transaction
managers, audit-in-transaction behavior, partial-batch reporting and invalidation
order. Deletion queries do not acquire locks or write. They run within the caller's
existing lock scope during mutations. QueryRunner reuse, regex statement timeouts,
workspace exclusions, autocoder filtering and stream cleanup retain their previous
implementations.

## Coder training

`CoderTrainingService` delegates its 16 existing public methods to providers in the
existing `database/services/coding` directory:

| Provider | Responsibility | Other new providers used |
| --- | --- | --- |
| `CoderTrainingSelectionService` | Workspace bundle configuration, reference cases, sampling, package generation and ordering | None |
| `CoderTrainingMutationService` | Training/job creation, configuration updates, labels and deletion | Selection |
| `CoderTrainingQueryService` | Training lists and associated jobs | None |
| `CoderTrainingComparisonService` | Between/within-training comparisons, filters, sorting, summaries and pages | ComparisonQuery, Display, Discussion |
| `CoderTrainingComparisonQueryService` | Aggregate/coder queries and reconstruction of selected comparison rows | Display, Discussion |
| `CoderTrainingDisplayService` | Missing-profile interpretation, display codes/scores and response/profile lookup | None |
| `CoderTrainingDiscussionService` | Automatic agreement and manual discussion-result writes, including missing scores | Display |
| `CoderTrainingKappaService` | Kappa query preparation, coder pairs, complete cases and metric assembly | Display |
| `CoderTrainingFreshnessService` | Comparison-version signatures and source freshness queries | None |

The existing `CoderTrainingResultsApplyService` remains the owner of applying
training results. Its behavior is not copied into these providers. Shared pure
selection keys, display names and numeric normalization live in
`coder-training.util.ts`; implementation types live in `coder-training.types.ts`.
The query provider has no dependency on package generation just to map a list.

Creation/update/deletion and manual discussion results retain the existing
ownership policies, actor IDs, workspace lock and transaction boundaries. Writes
still obtain repositories from the supplied transaction manager. Selection keeps
the shared `WORKSPACE_FILE_METADATA_READER` and its singleton metadata instance;
it does not preload or own another metadata cache. Profile conflicts, explicitly
null scores, reference filters, sample order and progress-sensitive updates retain
their previous behavior.

## Dependency direction and tests

Both sets of providers are private implementation registrations of their existing
feature modules. There is no extra module, service locator, `ModuleRef`, lazy
injection or production proxy. Feature providers do not depend on either facade.
The existing module direction is unchanged:

```text
WorkspaceModule -> CodingModule -> WorkspaceDataModule
WorkspaceModule ----------------> WorkspaceDataModule
```

The dependency test traverses the real provider and module metadata, including
`useExisting` aliases. The real `AppModule` composition test resolves every new
provider, verifies facade ownership and checks that training selection receives
the existing metadata-reader instance. Only external connections are replaced in
that composition test.

Legacy behavioral fixtures use explicitly test-only factories to redirect private
probes/stubs to their owners. Those factories are excluded from the production
TypeScript configuration. New cache/mutation and discussion/display tests use the
owning providers directly. The existing ownership, audit and PostgreSQL pool tests
also target the mutation providers directly rather than partially constructing a
facade prototype. The real GeoGebra/index tests resolve the export owner instead
of automatically mocking the facade dependency.

An independent comparison against the immutable base checked all **241 extracted
method bodies** and **54 public signatures** with TypeScript syntax tokens. Only
comments, formatting, static-helper qualification and explicit provider ownership
are normalized; SQL/template text, arguments and operations must still match.
This supplements behavioral tests; it does not establish deployed acceptance.

## Validation

Commands ran serially in the dedicated worktree with `NX_DAEMON=false` and
`NX_NO_CLOUD=true`, using `npx --no-install nx`:

| Check | Result |
| --- | --- |
| Full backend Jest suite, `test backend --runInBand --skip-nx-cache --no-cache` | 4,037 passed, 135 environment-dependent tests skipped; 249 suites passed, 15 skipped |
| `run backend:test-integration`, isolated native PostgreSQL 14.24 and Redis 7.4.2, current changelog | 129 passed in 16 suites; only the optional Kappa benchmark skipped |
| `run backend:typecheck` | Zero strict diagnostics; all 43 entity metadata checks passed |
| `lint backend` | Passed; rerun after the fixture-only rebase |
| PostgreSQL group-deletion cases after the parent-fixture rebase | 8/8 passed against the isolated native PostgreSQL server |
| `build backend --configuration=production --skip-nx-cache` | Passed |
| `build frontend --configuration=production --skip-nx-cache` | Passed |
| Built production API with real PostgreSQL/Redis and a fresh schema from all 44 included changelog files | Started; health `ok`; 325 OpenAPI paths, including results and training routes |
| Immutable-base comparison | 241 method bodies and their SQL/string/template literals, plus 54 public signatures, unchanged after ownership normalization |
| Application composition and dependency graph | Real domain providers resolve; metadata reader remains shared; provider and module graphs remain acyclic |

The full backend suite and integration gate were recorded before the parent
fixture-only rebase; the eight affected PostgreSQL cases were rerun afterwards.
Production sources are unchanged by that rebase.

The first full test/integration passes identified stale test constructors and a
GeoGebra fixture that automatically mocked the newly injected owner. These fixture
wiring issues were corrected without changing production logic. The full unit
suite and the complete integration gate were then successful.

Local review found no remaining regression findings. It checked the actual diff,
public delegates, dependency ownership, transaction/lock boundaries, optional
providers and aliases, and the production exclusion of legacy test adapters.
This is a self-review, with automated extraction checks and behavioral evidence.

### Live browser follow-up (30 October 2026)

The unchanged Cypress suites were run through the existing Nx targets with a
temporary hybrid runner: native production application builds, real Keycloak
26.4.0, PostgreSQL 14.22 and Redis 7.4 in separate disposable Docker infrastructure.
The runner replaced only service startup/static hosting; it used the repository's
existing realm preparation, fixtures, authentication readiness, Cypress configs,
test cases and cleanup. No application source or browser assertions were changed.

| Suite | Result |
| --- | --- |
| `cypress/auth/coding-session.cy.ts` | 12/12 passed; no pending or skipped tests |
| `cypress/workflows/coding-ownership.cy.ts` | 5/5 passed; no pending or skipped tests |
| `cypress/workflows/core-workflows.cy.ts` | 5/5 passed; no pending or skipped tests |

Coverage includes expired-session recovery, provider interruption, real 401
handling, uploads, settings/file permissions, manual coding/review/application,
background database export, training creation/ownership, audit rollback and queue
isolation. Auth took 1:11 and the two workflow specs 0:36 in Cypress Electron 138
(15.21.1), using Node 22.23.1.

The first full-Docker setup stopped before Cypress started because host storage
exhaustion triggered Docker EXT4/I/O errors. After the other local CI had stopped,
Docker was restarted and only this attempt's containers, volumes, images and two
measured build-cache records were removed. The successful runs used 2 GiB Docker
RAM for infrastructure, avoiding another application dependency installation.
Both successful stacks were removed cleanly. The original Docker memory setting
was restored to 12,032 MiB after validation; Docker Desktop is stopped again.

Production Docker runtime packaging was not revalidated by this follow-up. Remote
CI must be assessed on the published follow-up head. Browser success does not
establish deployed acceptance. PR #1131 remains a separate prerequisite; no merge
or ticket acceptance is implied.

Reference: [Nest circular dependencies](https://docs.nestjs.com/fundamentals/circular-dependency).
