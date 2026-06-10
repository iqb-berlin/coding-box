<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.

<!-- nx configuration end-->

# Kodierbox Project Guide

This `AGENTS.md` provides context and guidelines for AI agents working on the Kodierbox project. Keep changes focused, prefer existing project patterns, and verify commands against the local workspace before assuming global tooling exists.

## Agent Notes
- Use the Nx MCP tools from the generated section above when they are available. If they are not available in the current session, inspect `nx.json`, `apps/*/project.json`, `package.json`, and relevant local files instead.
- Prefer `npx nx ...` or the npm scripts in `package.json` over bare `nx ...`, because the repository has a local Nx installation and no global Nx binary should be assumed.
- Local performance rule: Do not run frontend and backend validation tasks in the same command or in parallel. Run frontend and backend tests, linting, builds, and e2e checks as separate commands and wait for one command to finish before starting the next.
- For Nx plugin-specific guidance, check `node_modules/@nx/<plugin>/PLUGIN.md` when present. In this workspace, not every installed Nx plugin ships such a file.
- More specific instructions exist in nested `AGENTS.md` files. Read them when working under `apps/frontend` or `apps/backend`.
- Do not invent new workspace structure or import aliases without checking the existing code first.

## Project Overview
**Kodierbox** (Coding Box) is a web application used to code/score test results from Verona-compatible test systems.
- **Documentation**: [TBA-Info](https://iqb-berlin.github.io/tba-info/)
- **Repository**: [iqb-berlin/coding-box](https://github.com/iqb-berlin/coding-box)

## Tech Stack
- **Frontend**: Angular 20+, Angular Material, RxJS.
- **Backend**: NestJS 11+, TypeORM, PostgreSQL.
- **Infrastructure**: Docker, Docker Compose, Make, Traefik, Redis, Liquibase.
- **Tooling**: Nx (Monorepo), Jest, Cypress, ESLint, Prettier.

## Workspace Structure
- **`apps/frontend`**: The Angular web application (coding interface).
- **`apps/backend`**: The NestJS REST API microservice.
- **`api-dto`**: Shared Data Transfer Objects (DTOs) used by both frontend and backend. Existing code imports these DTOs mostly through relative paths.
- **`database`**: PostgreSQL, Liquibase changelogs, and database support files.
- **`scripts/make`**: Make target implementations for dev, prod, lint, scan, and database workflows.
- **`packages`**: Runtime/static package assets, currently including GeoGebra assets. Do not treat this as a general shared-code library folder.
- **`Makefile`**: Central entry point for development and ops commands.
- **No active `libs/api-dto` project**: `tsconfig.base.json` still contains an old `@coding-box-lib/api-dto` path, but the current DTO sources live in `api-dto`.
- **Nested agent guides**: `apps/frontend/AGENTS.md` and `apps/backend/AGENTS.md` contain area-specific implementation guidance.

## Key Development Commands

### Docker/Make Workflow (Recommended for Full Stack)
- **Build Images**: `make dev-build`
- **Start Environment**: `make dev-up` (starts DB, Redis, Liquibase, Backend, and Frontend in Docker)
- **Stop Environment**: `make dev-down`
- **View Logs**: `make dev-logs`
- **Container Status**: `make dev-status` or `SERVICE=db make dev-status`
- **Clean Volumes**: `make dev-volumes-clean` (destructive; ask before running)

### Local Development (Hybrid)
- **Start Database**: `make dev-db-up`
- **Start Redis**: `make dev-redis-up`
- **Start Frontend**: `npm run start-frontend` (Proxies to backend)
- **Start Backend**: `POSTGRES_HOST=localhost REDIS_HOST=localhost npm run start-backend` when DB and Redis are exposed on localhost.
- **Install Dependencies**: `npm install`

### Nx Commands (Code Tasks)
- **Serve Locally**: `npx nx serve frontend` / `npx nx serve backend`
- **Run Tests**: `npx nx test frontend` / `npx nx test backend`
- **Linting**: `npx nx lint frontend` / `npx nx lint backend`
- **Build**: `npx nx build frontend` / `npx nx build backend`
- **Run Multiple Projects**: Avoid running frontend and backend together on this local machine unless the user explicitly asks for it; prefer separate commands for performance.
- Equivalent npm scripts exist for common frontend/backend test, lint, build, and serve tasks.

## Validation Checklist
- **Frontend-only changes**: Run `npx nx lint frontend` and `npx nx test frontend`.
- **Backend-only changes**: Run `npx nx lint backend` and `npx nx test backend`.
- **Shared DTO/API contract changes**: Run frontend and backend tests separately, and inspect affected controllers, services, facades, and components.
- **Build or configuration changes**: Run the affected frontend and backend builds separately.
- **Critical user flows**: Run `npx nx e2e frontend` when UI behavior, routing, auth, uploads, or coding workflows are affected.

## Coding Guidelines
- **Angular**: Follow modern Angular practices (Signals, Standalone Components where applicable, strict typing).
- **Angular Material**: Reuse existing Material and app-level UI patterns; do not add new UI libraries without a clear reason.
- **NestJS**: Use Dependency Injection, DTOs for validation, and TypeORM entities.
- **Backend structure**: Follow the established module/controller/service layout and existing queue/cache patterns.
- **Database**: Check existing TypeORM entities and Liquibase changelog conventions before changing schema or persistence behavior.
- **Style**: Prettier and ESLint are enforced. Run the relevant `npx nx lint ...` target to verify.
- **Testing**:
  - Unit tests (Jest) are required for new logic.
  - E2E tests (Cypress) are expected for critical user flows.
- **Scope control**: Avoid broad reformatting, unrelated refactors, and churn in generated or unrelated files.

## DTO and API Contract Notes
- Shared DTOs live in `api-dto` and are consumed by both frontend and backend.
- Existing imports usually use relative paths into `api-dto`; match the local pattern unless the project is intentionally migrated.
- When changing DTO shape, update validation, API responses, frontend consumers, and tests together.
- Do not create or rely on a new `libs/api-dto` layout without an explicit migration.

## Database and Redis Notes
- Full Docker development with `make dev-up` starts DB, Redis, Liquibase, backend, and frontend.
- Hybrid development needs both `make dev-db-up` and `make dev-redis-up` before starting the local backend.
- The backend database and queue configuration use `POSTGRES_HOST` and `REDIS_HOST`; set both to `localhost` or matching local `.env.dev` values for a non-containerized backend.
- Use Liquibase-oriented Make targets for database changelog validation and updates, for example `make dev-db-validate-changelog` and `make dev-db-update`.

## Safety Notes
- Do not run destructive targets unless the user explicitly asks for them. This includes `make dev-volumes-clean`, `make dev-clean-all`, `make dev-db-rollback-lastchangeset`, `make dev-redis-flush-all`, `make dev-redis-flush-db`, and Docker prune commands.
- Do not commit secrets or local credentials. Treat `.env.dev` as local environment configuration.
- If the worktree already contains unrelated changes, leave them untouched.

## Troubleshooting
- **Database Connection**: Ensure the Postgres container is running (`SERVICE=db make dev-status` or `docker ps`).
- **Redis Connection**: For hybrid development, ensure Redis is running with `make dev-redis-up` and that the backend points to `POSTGRES_HOST=localhost` and `REDIS_HOST=localhost`.
- **Dependencies**: Run `npm install` if you encounter missing packages.
- **Ports**:
  - Local Angular dev server: `http://localhost:4200`
  - Backend API root: `http://localhost:3333/api`
  - Swagger UI: `http://localhost:3333/api/docs`
  - Docker frontend port comes from `HTTP_PORT` in `.env.dev`.
  - Backend, PostgreSQL, and Redis host ports are configured through `.env.dev`.
