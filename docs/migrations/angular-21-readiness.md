# Angular 21 migration

Checked 2026-09-24. Status: implemented and locally validated on branch
`upgrade-angular-21`, based on `origin/develop` at
`ef3b898d967f4e059248cdd1d1756d62c2d1852b`.

## Upgrade

- Angular runtime, CLI, compiler and build/devkit: 21.2.24.
- Angular Material and CDK: 21.2.14.
- Nx remains 22.5.4; TypeScript is 5.9.3.
- `@iqb/metadata-components` is 1.0.0, whose Angular 21 compatibility was
  validated and published separately before this app migration.
- `keycloak-angular` is 21.0.0 and `@swimlane/ngx-charts` is 25.0.2.
- Angular migrations converted legacy structural template syntax to
  `@if`/`@for` and retained Zone change detection. The frontend now uses
  `@angular/build:application`; `outputPath.browser` is empty so production
  files stay directly under `dist/apps/frontend`, as expected by the Docker
  image.
- The frontend spec TypeScript config uses Node16 module resolution for
  Angular Material's package export types. `isolatedModules` stays enabled,
  while decorator metadata emission is disabled for specs to avoid the
  ts-jest warning. Jest 30 test expectations and jsdom CSS serialization were
  updated.
- Stable tracking keys were added for generated comparison warnings and
  process detail items to avoid Angular 21 view recreation and change-detection
  errors.
- The backend ExcelJS call sites use the declared `workbook.xlsx.load` input
  type to bridge its legacy Buffer declaration under TypeScript 5.9.
- The lockfile retains `@iqb/responses` 5.2.0 and its existing compatible
  response types; no unrelated response-library upgrade is included.

## Local verification

- `npx nx lint frontend` — passed.
- `npx nx test frontend` — passed: 205 suites, 2,076 tests.
- `npx nx build frontend` — passed (production).
- `CYPRESS_CACHE_FOLDER=/tmp/kodierbox-cypress-cache npx nx e2e frontend --spec cypress/e2e/app.cy.ts` — passed: 3 tests using the application builder's dev server. The dev server logged expected refused API proxy requests because no backend was started; the tested landing page, login prompt and unauthenticated route behavior passed.
- `npx nx lint backend` — passed.
- `npx nx test backend` — passed: 171 suites passed, 3 skipped; 2,570 tests passed, 17 skipped.
- `npx nx build backend` — passed.

The remaining Cypress live/replay specs were not run: they require an isolated
test backend and data set. The local landing-page E2E does not validate those
backend-backed flows.
