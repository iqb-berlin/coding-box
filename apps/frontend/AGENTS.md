# Frontend Agent Guide

These instructions apply to `apps/frontend` and supplement the root `AGENTS.md`.

## Project Shape
- This is an Angular 21 application using standalone components, Angular Material, RxJS, ngx-translate, and Keycloak integration.
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
- Use `inject()` for Angular dependency injection. Constructors can contain initialization logic; optional dependencies must account for `null`.
- Use the `coding-box-` prefix for application component selectors and update template, style, and test references together.
- Preserve selectors required by external integration contracts: the metadata library reads duration inputs through `iqb-formly-duration`, with a lint exception limited to that component.
- Prefer `@if`/`@for` and direct `class`/`style` bindings in external and inline templates.
- Mark template-only component members `protected`; retain public inputs, outputs, and members used by component consumers. Implement the interface for each lifecycle hook.
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

## Translation Maintenance
- Keep ngx-translate and reuse an existing key when its meaning and UI context match. New keys in `ui-text` follow `ui-text.<feature-or-component>.<purpose>`, for example `ui-text.coder-list.load-failed` or `ui-text.note-dialog.text-required`.
- Use short, stable English identifiers in kebab-case. Do not derive IDs from complete German sentences, truncate sentences, or append generated hashes. Changing visible wording alone should not require renaming an ID.
- Keep each new namespace as nested JSON objects. Avoid dots within object property names; existing legacy namespaces remain compatible.
- Translate complete messages with named parameters. Keep grammatical variants and different contexts separate; do not assemble new sentences from translated fragments. Backend data and imported content remain data rather than translation IDs.
- Keep UI IDs as literals where possible. `frontend:test-quality-gates` checks literal `ui-text` references in TypeScript and external/inline Angular templates, and checks required interpolation parameters when the parameter object is statically known. Dynamic IDs and parameter objects still need focused integration tests.
- Every additional application language file must contain the same IDs and interpolation placeholders as `de.json`. The quality gate checks all files in `src/assets/i18n`; adding English is a separate feature and is not required for German-only operation.
- Use `GermanTranslationsTestingModule` for tests asserting actual German labels. Add language-change tests when a behavior depends on switching languages; avoid asserting translation internals in unrelated logic tests.
- Run `NX_DAEMON=false npx nx run frontend:test-quality-gates` after catalog or key changes, alongside the normal frontend validation.
