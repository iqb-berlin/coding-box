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

This `AGENTS.md` provides context and guidelines for AI agents working on the Kodierbox project.

## Project Overview
**Kodierbox** (Coding Box) is a web application used to code/score test results from Verona-compatible test systems.
- **Documentation**: [TBA-Info](https://iqb-berlin.github.io/tba-info/)
- **Repository**: [iqb-berlin/coding-box](https://github.com/iqb-berlin/coding-box)

## Tech Stack
- **Frontend**: Angular 20+, Angular Material, RxJS.
- **Backend**: NestJS 11+, TypeORM, PostgreSQL.
- **Infrastructure**: Docker, Docker Compose, Make, Traefik.
- **Tooling**: Nx (Monorepo), Jest, Cypress, ESLint, Prettier.

## Workspace Structure
- **`apps/frontend`**: The Angular web application (coding interface).
- **`apps/backend`**: The NestJS REST API microservice.
- **`api-dto`**: Shared Data Transfer Objects (DTOs) used by both frontend and backend.
- **`packages`**: Shared libraries (if any).
- **`database`**: Database migration and setup files.
- **`scripts`**: Utility scripts (bash, make, python) for ops and maintenance.
- **`Makefile`**: Central entry point for development and ops commands.

## Key Development Commands

### Docker/Make Workflow (Recommended for Full Stack)
- **Start Environment**: `make dev-up` (Starts DB, Backend, Frontend in Docker)
- **Stop Environment**: `make dev-down`
- **Build Images**: `make dev-build`
- **View Logs**: `make dev-logs`
- **Clean Volumes**: `make dev-volumes-clean` (Resets DB data)

### Local Development (Hybrid)
- **Start Database**: `make dev-db-up`
- **Start Frontend**: `npm run start-frontend` (Proxies to backend)
- **Start Backend**: `npm run start-backend`

### Nx Commands (Code Tasks)
- **Serve Locally**: `nx serve frontend` / `nx serve backend`
- **Run Tests**: `nx test frontend` / `nx test backend`
- **Linting**: `nx lint frontend` / `nx lint backend`
- **Build**: `nx build frontend` / `nx build backend`

## Coding Guidelines
- **Angular**: Follow modern Angular practices (Signals, Standalone Components where applicable, strict typing).
- **NestJS**: Use Dependency Injection, DTOs for validation, and TypeORM entities.
- **Style**: Prettier and ESLint are enforced. Run `nx lint` to verify.
- **Testing**:
    - Unit tests (Jest) are required for new logic.
    - E2E tests (Cypress) for critical user flows.

## Troubleshooting
- **Database Connection**: Ensure the Postgres container is running (`make dev-db-status` or `docker ps`).
- **Dependencies**: Run `npm install` if you encounter missing packages.
- **Ports**:
    - Frontend: `4200`
    - Backend: `3333`
    - Swagger UI: `http://localhost:3333/api`
