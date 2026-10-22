# Backend Agent Guide

These instructions apply to `apps/backend` and supplement the root `AGENTS.md`.

## Project Shape
- This is a NestJS 11 application using TypeORM, PostgreSQL, BullMQ queues, Redis, Swagger, and Jest.
- The bootstrap file is `src/main.ts`; the API prefix is `/api`, and Swagger UI is served at `/api/docs`.
- `src/app/app.module.ts` wires the main application modules.
- `src/app/database` contains TypeORM entities, repositories, database services, and database utilities.
- `src/app/admin` contains most REST controllers for workspace, coding, files, users, jobs, and admin-facing behavior.
- `src/app/job-queue` contains BullMQ queue registration, queue services, and WorkerHost processors. Queue-backed behavior generally needs Redis.
- `src/app/cache` contains Redis-backed caching and cache schedulers.

## Commands
- Serve locally from the repo root with `POSTGRES_HOST=localhost REDIS_HOST=localhost npm run start-backend` or `POSTGRES_HOST=localhost REDIS_HOST=localhost npx nx serve backend` when DB and Redis are exposed on localhost.
- Full Docker development uses `make dev-up`; hybrid development needs `make dev-db-up` and `make dev-redis-up` before local backend serve.
- Verify backend changes with `npx nx lint backend` and `npx nx test backend`.
- Run `npx nx build backend` for build-sensitive changes.
- For database changelog work, use the root Make targets such as `make dev-db-validate-changelog` and `make dev-db-update`.

## Implementation Guidelines
- Follow the existing module/controller/service split; do not place business logic directly in controllers when a service already owns that domain.
- Register new entities in `src/app/database/database.module.ts` and keep `synchronize: false`.
- Schema changes should be represented through Liquibase changelogs under `database`, not by relying on TypeORM synchronization.
- Keep Swagger decorators up to date on new or changed public endpoints.
- Use existing guards, decorators, and workspace access patterns for admin and workspace-scoped endpoints.
- For queue-backed work, register queues in `src/app/job-queue/job-queue-client.module.ts`, processors in `job-queue.module.ts`, and use `JobQueueService` rather than ad hoc queue creation. Processors extend `WorkerHost`; use named jobs, `updateProgress()` and `updateData()`.
- Producers use `withQueueJobId()` for options so new jobs have UUIDs and cannot collide with old numeric cache IDs. Preserve explicit IDs when a caller needs deduplication.
- Keep DTO imports consistent with surrounding code, usually relative imports into `api-dto`.
- Preserve existing GeoGebra/package asset behavior in `src/main.ts` when changing static asset handling.

## Testing Notes
- Backend tests use Jest with `ts-jest` and `testEnvironment: node`.
- Add focused unit tests near changed services, controllers, processors, guards, or utilities.
- For controller tests, mock services and guards using the local patterns already present in `*.controller.spec.ts`.
- For queue or cache unit tests, mock BullMQ queues and Redis clients. Run `npx nx run backend:verify-bullmq-live` for real Redis/Nest worker checks; it starts an isolated local `redis-server` (override the binary with `BULLMQ_REDIS_SERVER`). Never point this runner at application Redis data.
- When changing API contracts shared with the frontend, run the relevant frontend tests as well.
