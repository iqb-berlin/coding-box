# Test results and coder training use cases

This follow-up targets `develop` at
`f9a06fe0628e50a1592ea9ff172c667081e89b0b` (30 October 2026), which already
contains merged [PR #1131](https://github.com/iqb-berlin/coding-box/pull/1131).
The three existing decomposition commits were rebased onto that base rather than
reimplementing the split. The backend starting implementations are identical to
the former prerequisite head. Newer frontend, authentication-inventory and browser
startup changes from `develop` are retained. Runtime/authentication hardening and
`WorkspaceDataModule` separation are prerequisites already integrated in the base.

The starting implementations had 8,207 and 5,178 lines. They combined unrelated
reads, data processing, writes and exports. Method ownership and dependencies,
rather than file length, determine the boundaries below. Existing HTTP controllers,
DTOs, queue producers/processors and the two application facades keep their contracts.

## Test results

`WorkspaceTestResultsService` delegates its 38 existing public methods to providers
in the existing `database/services/test-results` directory:

| Provider | Responsibility | Other new providers used |
| --- | --- | --- |
| `TestResultsQueryService` | Overview, person/booklet/unit navigation, quick search and log reads | None |
| `TestResultsResponsesService` | Flat response pages, including bounded regex/value searches | Anomalies |
| `TestResultsFrequenciesService` | Response-value frequency aggregation, probabilities and its workspace-scoped cache | None |
| `TestResultsFilterOptionsService` | Filter choices and bounded log-derived duration/progress queries | None |
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
| `CoderTrainingSelectionService` | Workspace bundle configuration, reference-case loading and package generation | Sampling |
| `CoderTrainingSamplingService` | In-memory reference filtering, case sampling and response ordering; no database dependencies | None |
| `CoderTrainingMutationService` | Training/job creation, configuration updates, labels and deletion | Selection, Sampling |
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
Sampling and ordering are shared by package selection and transactional training
writes through one stateless provider. Direct tests cover timestamp/ID ordering,
group balance, bundle case coherence, reference filtering and source preservation.

The follow-up boundary review also separates flat-response pages, frequency
aggregation and filter choices. Frequency cache hits no longer require a provider
that depends on anomaly reconstruction; filter choices depend only on response
queries, exclusions and the data source. Direct owner tests cover scoped predicates,
log-derived options, cache hits, repeated combinations and zero-count values.
The remaining larger providers keep complete workflows together: anomaly SQL and
batched evidence reconstruction, browsing queries, deletion consistency checks and
comparison assembly. Their size alone does not justify splitting transaction or
stream cleanup boundaries.

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
TypeScript configuration. New cache/mutation, frequency, sampling and
discussion/display tests use the owning providers directly. The existing ownership,
audit and PostgreSQL pool tests also target the mutation providers directly rather than partially constructing a
facade prototype. The real GeoGebra/index tests resolve the export owner instead
of automatically mocking the facade dependency.

An independent comparison against the immutable `develop` base checked all
**241 extracted method bodies** and **54 public signatures** with TypeScript syntax tokens. Only
comments, formatting, static-helper qualification and explicit provider ownership
are normalized; SQL/template text, arguments and operations must still match.
All 54 facade delegates also forward every parameter to their owning method in
the original order. This supplements behavioral tests; it does not establish
deployed acceptance.

## Validation on current develop

Validation was repeated in the dedicated `nest-backend-review/Kodierbox` worktree
on 30 October 2026. Commands use `NX_DAEMON=false NX_NO_CLOUD=true` and
`npx --no-install nx`. Frontend and backend checks run separately.

| Check | Result |
| --- | --- |
| Full backend Jest suite, `test backend --runInBand --skip-nx-cache --no-cache` | 4,045 passed; 135 environment-dependent tests skipped; 251 suites passed |
| `run backend:test-integration`, isolated native PostgreSQL 14.24 and Redis 7.4.2, current changelog | 129 passed in 16 suites; only the optional Kappa benchmark skipped |
| `run backend:typecheck` | Zero strict diagnostics; all 43 entity metadata checks passed |
| `lint backend --skip-nx-cache` | Passed |
| Focused owner, facade-fixture, AppModule and dependency-DAG tests after the final fixture correction | 104 passed in 5 suites |
| `build backend --configuration=production --skip-nx-cache` | Passed |
| `build frontend --configuration=production --skip-nx-cache` | Passed |
| Native production API with the browser fixture database and Redis | Health `ok`; 325 OpenAPI paths |
| `run frontend:zoneless-inventory-test --skip-nx-cache` | Both checks passed |
| Immutable-base comparison | All 241 method bodies, SQL/string/template literals and 54 public signatures preserved after ownership normalization |
| Public facade delegation | All 54 methods forward every parameter in its original order |

The group-deletion fixture retains its typed `WorkspaceStatsCacheService` mock.
The integration gate includes real advisory-lock, transaction/audit rollback,
ownership, pool, deletion, query, Redis and BullMQ checks. It creates and removes
its own test database; application PostgreSQL and Redis data are not used.

The full suite precedes one test-factory-only correction to include the frequency
and filter-option owners in legacy private-probe routing. Affected owner, facade
fixture, AppModule composition and dependency-DAG tests are rerun afterwards.

The previous remote head `5c149507d8c8817c7525e8f4fdc1c251ad620586` failed
[GitLab job #490787](https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/490787)
in `frontend:zoneless-inventory-test`, after all 3,548 frontend unit tests passed.
The current base includes the updated authentication inventory; the same gate now
passes locally. That old pipeline is not evidence for this updated source.

The final diff and commit sequence were reviewed before publication. Review checked
facade argument forwarding, repository/provider identities, optional dependencies,
transaction and advisory-lock ownership, audit ordering, invalidation, stream
cleanup, exclusions, error propagation and production exclusion of test adapters.
The original three extraction commits are unchanged by the rebase (`range-diff`);
response-query separation and training sampling are two subsequent focused commits.
Self-review found no remaining regression findings. The automated preservation
comparison supplements this review; no independent human review is claimed.

Remote CI is separate evidence and must refer to the published head. Production
Docker dependency installation was not repeated; package manifests and runtime packaging are
unchanged from the base. No merge or domain acceptance is implied.

## Production browser validation

The current production sources at `3d9cb0367785f583929adf3bd6f5a6d9fc09c553`
were exercised with native production frontend/backend builds and disposable
Keycloak 26.4.0, PostgreSQL 14.22 and Redis 7.4 containers. A temporary hybrid
startup adapter uses the existing realm preparation, fixtures, readiness,
Cypress configs, assertions and cleanup, invoked through
`nx e2e frontend --skipServe --skip-nx-cache --cypressConfig=... --browser=electron`.
Only service startup and static hosting differ from the full Docker harness.

| Suite | Result |
| --- | --- |
| `cypress/auth/coding-session.cy.ts` | 12/12 passed; none pending or skipped |
| `cypress/workflows/coding-ownership.cy.ts` | 5/5 passed; none pending or skipped |
| `cypress/workflows/core-workflows.cy.ts` | 5/5 passed; none pending or skipped |

All 22 cases passed in Cypress 15.21.1 / Electron 138 with Node 22.23.1.
Coverage includes real session expiry/provider interruption/401 handling, uploads,
file and settings permissions, manual coding/review/result application, background
export, training creation/ownership, transactional audit rollback and queue isolation.
Both browser stacks and their volumes were removed cleanly. Native integration
PostgreSQL and Redis were stopped after their gate. Docker Desktop used 6 GiB RAM
for these runs; its original 12,032 MiB setting was restored afterwards.
The only later commit updates this document; tested production sources are unchanged.
