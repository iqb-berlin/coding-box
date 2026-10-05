# Frontend quality gates

For frontend changes in feature branches and pull requests targeting `develop`,
the required GitLab job `test-frontend-zoneless` runs Angular linting, the complete
frontend unit suite with coverage, native zoneless tests, and a production build.
It rejects failures and publishes JUnit and Cobertura reports even when tests fail.
For pull requests targeting `main`, `test-main-pr-frontend` enables the same
coverage gate inside the existing test image and copies reports from the stopped
container before artifact upload. `lint-main-pr-frontend` also rejects failures.

Run the same checks locally with the Node version in `.nvmrc`:

```sh
npx nx run frontend:test-quality-gates
npx nx lint frontend
npx nx run frontend:test --configuration=ci --maxWorkers=2
npx nx run frontend:zoneless-inventory
npx nx run frontend:zoneless-inventory-test
npx nx run frontend:test-zoneless --maxWorkers=2
npx nx build frontend --configuration=production
```

Run these commands sequentially. The CI configuration enables coverage and rejects
empty test suites. The existing global thresholds in `jest.preset.js` remain at
60% for statements, branches, functions, and lines, with the existing source
selection unchanged. The zoneless suite uses its own setup and report directory;
the complete frontend suite supplies the coverage gate.

The former generic prototype smoke suite is removed because it swallowed method
and callback failures while increasing coverage. Its three concrete review
regressions now run with the actual component in Angular TestBed.
The generated zoneless inventory is refreshed for changed template bindings and
outputs. Existing review evidence remains on unchanged fingerprints; the
existing risk-based approval check remains in force.

Reports are written to `coverage/apps/frontend/` (HTML, LCOV, JSON, Cobertura,
JUnit) and `coverage/apps/frontend-zoneless/junit.xml`. GitLab retains them for
seven days and shows the complete suite's coverage.

`apps/frontend/.eslintrc.cjs` retains the repository's TypeScript rules and adds
Angular rules plus syntax, control flow, and accessibility checks for external and
inline templates. Warnings fail the Nx lint target. Constructor injection remains
allowed; introducing the gate does not require a separate DI migration.
Application components use the `coding-box-` selector prefix, enforced by lint.
The duration editor retains `iqb-formly-duration` because the metadata library
reads its numeric inputs through that host selector. Its lint exception is limited
to the duration component. Test doubles can retain third-party selectors.
Templates use direct `class` and `style` bindings; lint rejects unnecessary `ngClass`
bindings in external and inline templates. Template-only component members are
`protected`; inputs, outputs, and
members accessed by component consumers retain their public contract. Lifecycle
hooks explicitly implement the corresponding Angular interfaces.

Both frontend Jest configurations explicitly select `ts-node`. The zoneless
configuration imports the base configuration without a `.ts` extension, so it also
loads when Jest has registered its compiler for another project first. This works
on Node 22.16 without setting `TS_NODE_COMPILER_OPTIONS` in a developer shell or CI.

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
