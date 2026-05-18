# Frontend Agent Guide

These instructions apply to `apps/frontend` and supplement the root `AGENTS.md`.

## Project Shape
- This is an Angular 20 application using standalone components, Angular Material, RxJS, ngx-translate, and Keycloak integration.
- Application-wide providers live in `src/app/app.config.ts`; root routes live in `src/app/app.routes.ts`.
- Feature routes are split by area, for example `coding/coding.routes.ts`, `replay/replay.routes.ts`, `sys-admin/sys-admin.routes.ts`, and `ws-admin/ws-admin.routes.ts`.
- `src/app/core` is for singleton services, guards, interceptors, auth, and app-wide state.
- `src/app/shared` is for reusable components, pipes, dialogs, models, services, and utilities.
- Feature folders should keep their own `components`, `services`, `models`, and `utils` close to the feature.

## Commands
- Serve locally from the repo root with `npm run start-frontend` or `npx nx serve frontend`.
- The dev server proxies `/api` to `http://localhost:3333` through `apps/frontend/proxy.conf.json`.
- Verify frontend changes with `npx nx lint frontend` and `npx nx test frontend`.
- Run `npx nx build frontend` for build-sensitive changes.
- Run `npx nx e2e frontend` when routing, auth, uploads, coding workflows, or other critical UI flows change.

## Implementation Guidelines
- Prefer standalone components and explicit `imports` arrays, matching the existing component style.
- Use Angular Material components already used in the app; do not introduce new UI libraries without a clear need.
- Put component templates and SCSS next to the component unless the local pattern clearly differs.
- Add or update translation keys in `src/assets/i18n/de.json` for user-facing text instead of hard-coding German UI strings in templates or services.
- Keep backend calls in existing backend/facade services where possible; avoid calling `HttpClient` directly from components.
- Use `SERVER_URL` and the existing environment setup for API URLs rather than hard-coded backend URLs.
- Keep DTO imports consistent with the surrounding code, usually relative imports into `api-dto`.

## Testing Notes
- Component and service tests use Jest with `jest-preset-angular`.
- For Angular Material dialogs and translated templates, follow existing tests that import `TranslateModule`, Material modules, and provide dialog data/mocks.
- When changing facades or backend services, cover request URLs, request bodies, and returned observable values.
- When touching complex coding workflows, add focused unit coverage first and use Cypress only for full user-flow risk.
