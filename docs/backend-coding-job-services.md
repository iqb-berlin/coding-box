# Coding job service decomposition

This ports the service decomposition from #1047 onto develop after merging #1066
(base `a5d11fab13ea23337bcfbada1b3818aaad674d6e`). The implementations are extracted
from that current base, rather than copied from the old providers. HTTP request
contracts, ownership checks, actor IDs, audit events and status/locking policies
therefore retain their current behavior.

`CodingJobService` remains the application facade with all 65 public method
signatures. Its 211 implementations move to ten providers in the existing coding
service directory:

| Provider | Responsibility | Feature dependencies |
| --- | --- | --- |
| Query | Workspace-scoped reads, visibility, exclusions, progress counts | None |
| Access | Assigned-coder capability and workspace permission checks | None |
| Scheme | Coding scheme loading, selectable codes and progress validation | None |
| Aggregation | Matching flags, settings snapshots and value aggregation | Derived-variable reader port |
| Responses | Candidate responses, exclusions, peers and missing values | Query |
| Mutation | Creation, updates, assignment, deletion, audit and locked transactions | Access, Aggregation, Query, Responses |
| Distribution | Planning, refresh and transactional creation of distributed jobs | Access, Aggregation, Mutation, Query, Responses, derived-variable reader port |
| Progress | Coding progress, notes and issue review writes | Access, Mutation, Query, Scheme |
| Replay | Replay sessions, navigation and saved progress/notes | Query, Scheme |
| Status | Coder status transitions, restart and result application | Access, Mutation, Query |

The graph is acyclic. Feature providers do not depend on the facade.
`DERIVED_VARIABLE_READER` and `WORKSPACE_FILE_METADATA_READER` bind to the shared
`WorkspaceFileMetadataService` with `useExisting`; coding providers depend only
on read contracts. Query exclusions
read the workspace repository directly, avoiding a dependency back through the
mutable workspace core. Missing-workspace handling is unchanged: the ordinary
read raises the existing 404; a supplied transaction retains the empty result.

`CodingModule` owns the feature providers, response mutation and coding progress.
`WorkspaceModule` imports and re-exports it through ordinary module imports and
uses its existing Validation, Analysis, Freshness and ItemMatrixExport instances.
Both import the lower `WorkspaceDataModule`, which owns file metadata, exclusions,
player reads, journal access and workspace result-cache invalidation. That module
does not depend on either application module or queue workers.

`WorkspaceFilesService` retains its public metadata methods as delegates. Only the
metadata provider owns refresh de-duplication, startup preload and Redis map state.
Its read port preserves optional transaction managers. Workspace core and response
mutations invalidate result caches through `WorkspaceStatsCacheService`; statistics
interpret Bull job results through pure helpers rather than the job orchestrator.
This removes the reciprocal module and provider dependencies without lazy service
lookups. Composition tests verify shared instances, and dependency tests reject
cycles through both concrete providers and port aliases.

## Transaction and compatibility checks

- Every extracted method body was compared to the base using TypeScript tokens,
  ignoring comments/formatting and normalizing provider-qualified calls and the
  derived-reader property rename. All 211 bodies match; all 65 facade signatures
  match, including actor IDs and optional EntityManager arguments.
- The real `AppModule` compiles with only storage/Redis/queue connections replaced.
  The test resolves all ten providers and verifies that workspace and coding
  consumers receive the same shared instances.
- A real-facade status test crosses Status, Mutation and Access, checking the
  pessimistic row lock, supplied actor, transactional permission read and audit
  write. Revoked capability prevents both writes. Result application reuses a
  supplied manager without opening another transaction.
- Existing coding-job, distribution and realistic job-definition tests retain
  their behavioral assertions. A test-only factory redirects their legacy private
  probes/stubs to the owning providers; the AppModule tests use the real facade
  without this adapter. The factory is excluded from the production compilation.

Settings persistence, asynchronous logo storage, startup configuration validation,
strict-diagnostics baselines and the old CI/configuration changes in #1047 are
outside this port. The CI gates already on develop remain in place. Full live
replay, authentication and workflow checks must pass on this PR before integration.

## Local validation (18 October 2026)

| Check | Result |
| --- | --- |
| Backend lint | Passed |
| Full backend Jest suite (`--runInBand --no-cache`) | 3,216 passed in 203 suites; 63 optional integration tests skipped |
| PostgreSQL ownership and mutation-pool suites | 30 passed in two suites, enabled separately against an isolated database |
| Liquibase setup for that database | All 163 changesets applied successfully |
| Backend production build | Passed |
| Built production backend with real PostgreSQL and Redis | Started successfully; health `ok`, Redis connected, 311 OpenAPI routes |
| Extraction comparison against the base | 211 method bodies and 65 public signatures preserved |

Frontend, shared DTOs, database migrations and CI definitions are unchanged.
The production startup probe and PostgreSQL tests do not replace the full live
browser/replay/authentication/workflow CI gates. Remote results must be checked on
the PR head before merging this service port.
