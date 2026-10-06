# Backend contracts and quality gates

## Request contracts

AJV-backed routes use `api-dto/request-contracts.ts`. Each named schema derives its TypeScript input through `RequestBody<Name>`. `@ValidatedBody(Name)` supplies both the runtime pipe and the OpenAPI request schema, including optional bodies and nullable fields. Update that contract rather than adding an independent request DTO or `@ApiBody` shape. Response DTOs remain independent because responses and writable fields have different contracts. Decorated class DTOs continue to use the global Nest validation pipe. The required typecheck also rejects routes whose `ValidatedBody` name and `RequestBody` type disagree.

## Coding jobs

`CodingJobService` is the public application facade. `CodingModule` registers one instance of each feature provider: access, query, mutation, status, distribution, responses, progress, scheme, replay and aggregation. Keep transaction managers and hooks intact when changing persistence operations. Other modules import the facade through `CodingModule`; do not register duplicate feature providers.

Settings persistence belongs to `WorkspaceSettingsService` in `WorkspaceSettingsModule`. Controllers use that service instead of repositories. Derived-variable reads use the `DERIVED_VARIABLE_READER` port, backed by the existing WorkspaceFilesService instance. This avoids importing the full file-management service into distribution and aggregation.

## TypeScript strict checking

Run `npx nx run backend:typecheck`. The checker enables TypeScript strict checks for the complete production program, with `strictPropertyInitialization: false` for Nest/TypeORM initialized properties. Existing strict errors are recorded by file, diagnostic code, full message and count in `apps/backend/strict-baseline.json`. New or increased diagnostics fail the required quality job. Line movement and formatting do not invalidate entries. The initial baseline contains 740 existing diagnostics, down from 759 before this change. This is a migration gate; the ordinary application build still has legacy strict debt.

Fix legacy errors gradually and run `node scripts/quality/check-backend-strict.mjs --prune-baseline` to remove resolved entries. The command first verifies that no new errors exist. Never expand the baseline to accept new code. The checker itself has tests for new files, changed messages/codes, and increased counts.

## Live replay

The separate `frontend:e2e-replay-live` target tests browser, API, PostgreSQL migrations and Redis together using synthetic replay data. Unit tests do not cover that interaction. The GitLab job runs automatically on application, shared contract, migration, dependency, harness or pipeline changes, and on main/develop and tags. It is mandatory whenever present. Backend/frontend publication in `build-images` and release publication in `publish-images` depend on it; optional needs only permit omission when its change rules do not apply.

Local execution requires Docker and Cypress. The harness creates its own Compose project, ports, credentials and fixture workspace, saves redacted logs, and cleans up only its own resources. An infrastructure or browser failure fails the job; do not turn it back into an allowed failure. The fixtures do not establish production readiness or test an external identity provider.
