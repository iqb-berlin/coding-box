# Frontend quality gates

For frontend changes in feature branches and pull requests targeting `develop`,
the required GitLab job `test-frontend` runs the complete frontend unit suite in
one native zoneless environment, with coverage, quality-gate regression tests,
and the existing risk-based inventory approval. It rejects failures and publishes
JUnit and Cobertura reports even when tests fail.

`test-backend` excludes the frontend and rejects backend test failures. `lint-app`
runs affected lint targets once and rejects failures. `build-app` builds the
production frontend once and builds affected backend projects separately.
`test-browser` runs all mocked end-to-end regressions against that production
artifact using `frontend:serve-static`; it does not rebuild the frontend.
Each browser suite runs once; migration wrappers no longer import other spec files.
The same job runs the existing component suites with Cypress's native zoneless
mount adapter. Component screenshots and videos use separate artifact folders.
Both browser targets fail when a discovered spec executes zero tests. Component
specs compile up front (`justInTimeCompile: false`) to avoid Cypress 15's webpack
JIT startup race, and run before E2E in the same job. Test retries remain disabled.
GitHub webhook pipelines targeting `develop` pull the same official upstream base images directly,
because the project bot has no group Dependency Proxy access. Regular branch
pipelines retain the proxy. Project registry images and all checks stay enabled.
Live Replay and Keycloak authentication remain separate integration jobs and
exercise the production frontend with their disposable backend environments.

For pull requests targeting `main`, `test-main-pr-frontend` enables the same
zoneless coverage gate inside the existing test image and copies reports from the
stopped container before artifact upload. `lint-main-pr-frontend` rejects failures.

Run the same frontend checks locally, sequentially, with `.nvmrc`'s Node version:

```sh
npx nx run frontend:test-quality-gates
npx nx lint frontend
npx nx run frontend:test --configuration=ci --maxWorkers=2
npx nx run frontend:zoneless-inventory-test
npx nx run frontend:zoneless-approval
npx nx build frontend --configuration=production
npx nx run frontend:e2e --configuration=ci --browser=electron
npx nx run frontend:component-test --browser=electron
```

Every frontend unit test asserts that Zone.js is absent. Async timer and polling
regressions use Jest's native fake timers rather than Angular's Zone.js-based
`fakeAsync` helpers. Rendering regressions await Angular stability to verify
change notifications. There is no second Jest configuration or test allowlist.

Jest recycles Angular workers exceeding 1 GB after a test file finishes, so
parallel coverage runs do not retain every component graph in memory.

The coverage thresholds remain at 60% for statements, branches, functions, and
lines, with the existing source selection unchanged. Reports are written to
`coverage/apps/frontend/` (HTML, LCOV, JSON, Cobertura and JUnit) and retained for
seven days in GitLab.

The former generic prototype smoke suite is removed because it swallowed method
and callback failures while increasing coverage. Its three concrete review
regressions now run with the actual component in Angular TestBed.
The generated zoneless inventory is refreshed for changed template bindings and
outputs. Existing review evidence remains on unchanged fingerprints; the
existing risk-based approval check remains in force.

`apps/frontend/.eslintrc.cjs` retains the repository's TypeScript rules and adds
Angular rules plus syntax, control flow, and accessibility checks for external and
inline templates. Warnings fail the Nx lint target. Angular classes resolve
dependencies with `inject()`, enforced by lint. Constructors retain initialization
logic, and optional dependencies use nullable `inject()` results. Ordinary model,
error, and explicitly constructed factory classes retain their constructor APIs.
Application components use the `coding-box-` selector prefix, enforced by lint.
The duration editor retains `iqb-formly-duration` because the metadata library
reads its numeric inputs through that host selector. Its lint exception is limited
to the duration component. Test doubles can retain third-party selectors.
Templates use direct `class` and `style` bindings; lint rejects unnecessary `ngClass`
bindings in external and inline templates. Template-only component members are
`protected`; inputs, outputs, and
members accessed by component consumers retain their public contract. Lifecycle
hooks explicitly implement the corresponding Angular interfaces.

The frontend Jest configuration explicitly selects `ts-node` and loads after
other project configurations without setting `TS_NODE_COMPILER_OPTIONS`.

`frontend:test-quality-gates` tests invalid templates, inaccessible external and
inline controls, configuration loading, and CI wiring. It also runs an isolated
Jest fixture twice using the actual workspace thresholds: full coverage passes,
while a passing test with uncovered functions fails the coverage gate.

Custom controls use a shared keyboard activation handler that returns `void`.
It delegates their own Enter/Space events to the existing click action and leaves
native key events from nested checkboxes and buttons unchanged. Component and
browser regressions cover nested checkbox selection and export-toast collapse.
The browser regressions use `cy.press()` for native key events. In the tested
Cypress/Electron runner, Enter dispatch does not activate a plain HTML button;
the nested-button browser regression therefore uses Space. Component tests
verify that both Enter and Space remain uncanceled on the native button, and the
browser regression separately exercises Enter on the custom toast header.
