# Workspace deletion integrity (Refs #964)

The previous service deleted uploads and persons explicitly, then the workspace. Job definitions, coding jobs and other data survived because TypeORM synchronization is disabled and their workspace relations had no corresponding database constraints.

## Ownership audit

| Tables | Ownership and deletion |
| --- | --- |
| `workspace_user`, `testcenter_import_run`, `double_coding_review_decision` | Workspace ownership; existing database cascades retained. Entity relations describe these cascades. |
| `file_upload`, `persons`, `job_definitions`, `coding_job`, `coder_training`, `coder_training_discussion_result`, `variable_bundle`, `missings_profile`, `replay_statistics`, `journal_entries`, `job`, `coding_unit_freshness`, `workspace_test_results_revision` | Workspace ownership; Liquibase adds `ON DELETE CASCADE`. Journal entries follow the workspace's data lifecycle. Validation/analysis/coding child entities share `job` through TypeORM single-table inheritance. The revision table is accessed through raw SQL, not an entity. |
| `variable_analysis_job`, `test_person_coding_job` | Legacy physical tables, distinct from current TypeORM child entities. Retained historical data gets its own workspace cascade. |
| `coding_job_unit` | Denormalized workspace owner follows its coding job. Migration repairs historical NULL/mismatched values; job and response cascades remain, plus a direct workspace cascade. |
| `resource_package` | Workspace-scoped packages cascade via a generated `owner_workspace_id`. Global packages retain the existing API convention `workspaceId=0` and have no workspace owner. Physical directories are removed only when no package references remain. |
| Booklets, sessions, booklet/unit logs, units, responses, chunks, tags, notes, freshness, coding-job coders/variables/bundles/units, training coders/variables/bundles/discussion results | Existing parent foreign keys already cascade. PostgreSQL integration fixtures exercise all these paths. |
| `bookletinfo`, users, settings, system notifications | Shared/system data; retained. `bookletinfo` is a shared catalogue keyed by name. |
| `logs`, `responses`, `person` | Obsolete tables dropped by earlier Liquibase migrations. Obsolete `Logs` entity remains outside this task's scope. |

## Worker and deletion ordering

Every registered workspace worker, including workspace SQLite exports and validation tasks with legacy task-only payloads, runs through `WorkspaceWorkerHost`. A shared PostgreSQL advisory lock covers the complete processing and artifact-publication lifetime. Deletion acquires an exclusive nonblocking lock for every requested workspace, in stable ID order, inside the existing file/test-result mutation locks. An active worker makes deletion return HTTP 409 before any changes. A queued worker arriving during or after deletion checks the workspace under its shared lock and fails permanently before invoking its operation.

Lifecycle leases use dedicated one-connection DataSources rather than occupying the application pool while services acquire their own mutation connections. Concurrent worker tasks therefore each require one additional PostgreSQL connection. System-wide database exports are system data and retain their existing behavior.

Queue ownership and package names are captured before deleting database rows, including validation-task ownership. After commit, completed/waiting queue entries, cached result files and staged imports under the application's temp directory are removed. An entry activated during cleanup is left for the guarded worker to fail. Existing diagnostics archives are deleted while the exclusive lock is held. Queue workers cannot recreate artifacts after a successful deletion. API and export workers must share the configured temp/packages volumes, as in the supplied Compose files.

## Migration and rollout

Deploy with API writes and all workers stopped; then apply Liquibase, and start the updated API and workers together. Mixed old/new workers would bypass the new lifecycle guard. Back up the database before applying the migration. Orphan cleanup is irreversible and logs deleted row counts per table; only rows without an existing owning workspace are removed. Existing cross-workspace references to an orphan missing profile are cleared before profile cleanup. Cascades clean their dependent trees. Global packages are preserved. A database rollback can remove the new constraints but cannot reconstruct deleted orphan data.

Before deletion, a durable cleanup manifest is written to the shared temp volume. Filesystem/Redis cleanup occurs after the database commit and deliberately propagates errors. If it fails, retry the workspace deletion to recover the manifest and finish cleanup; workspace IDs are not reused. Historical orphan files whose queue metadata/package records have already expired are outside database ownership reconstruction and retain their existing expiry/manual cleanup behavior.

## Validation

Run `npx nx lint backend` and `npx nx test backend --runInBand`.

For real PostgreSQL coverage, set `WORKSPACE_DELETION_TEST_DATABASE_URL` to an **isolated test server** where the test user may create/drop a database, ensure `psql` (or `PSQL_BIN`) is available, then run `npx nx test backend --runInBand --testPathPatterns=workspace-deletion.postgres`. The suite creates a uniquely named database, applies all included historical SQL with the Liquibase changeset transaction boundaries, reproduces the original leak, applies the repair, and checks orphan cleanup, metadata, all workspace columns, dependency cascades, other workspaces, globals and worker/deletion races. The temporary database is dropped afterward. The regular unit suite skips these PostgreSQL-only tests unless the environment variable is set.

Verified locally on 2026-10-23 against `develop` at `b80bf65ac5a19847ce510ad36eba857cef3c290f`:

| Check | Result |
| --- | --- |
| `npx nx lint backend` | Passed |
| `npx nx build backend` | Passed |
| `npx nx test backend --runInBand --skipNxCache` | 229 suites / 3,531 tests passed; 10 environment-dependent suites / 80 tests skipped |
| `WORKSPACE_DELETION_TEST_DATABASE_URL=… npx nx test backend --runInBand --testPathPatterns=workspace-deletion.postgres --skipNxCache` | 5 tests passed against isolated PostgreSQL 14.24 |

The SQL migration was exercised against the complete historical schema using the changeset transaction boundaries. Liquibase CLI validation, remote CI and deployment have not been performed.
