# Codebook / Autocoder acceptance, 18 October 2026

The PR integrates develop `3e9ce1d027ad439727b97d68d2e9bbbc3b6c233d`
without rebasing or force-pushing. The merged Replay implementation is retained.
The shared package remains `4.1.0-dev.ff15d6d`, source
`ff15d6d882417db26bc81fc88a09074eab74d57d`, SHA-256
`e67c04e07762350cb4ee3b1a70a36bcde0f2ba1c24df1f5a40000346d34fd112`.
Responses remains 5.3.1 with the private mathjs 12.4.3 adapter.

## Browser synchronization

The original test returned a pending Promise from `cy.intercept` for Missing
profiles while running unit selection, option changes and the job picker.
Cypress 15.21.1 limits the entire callback to `defaultCommandTimeout` (4 seconds),
not each interaction independently. Profile loading does not block these UI
actions; the test itself delays their response until those actions finish.
The unchanged test initially passed locally. Injecting 4.5 seconds immediately
before `releaseProfiles()` reproduced the exact CI callback timeout in both
Codebook cases (1/3 passed). With a 30-second budget scoped to those two tests,
the same injected delay passed (3/3). The injected delay was then removed.
Both gates and all existing assertions remain; the test additionally selects
the loaded profile and verifies its ID in the actual request.

## Scope regression discovered by the live test

For `idA/alias=idB` and `idB/alias=idA`, a job selecting public alias `idB`
and a bundle selecting `idA` have an empty intersection. Before this fix, the
second filter no longer saw the removed alias `idA`. It treated that selector
as the technical ID of the surviving variable and incorrectly exported it.
The live queued job completed when a failure was expected.

Both filters now resolve selectors using the original schema's aliases, then
filter the remaining variables. The existing original-ID context also remains
available for item relations. Four real-generator regression tests failed before
this change: empty intersections incorrectly succeeded in JSON/DOCX, and a
nonempty intersection included an excluded variable/item. All 31 focused
Codebook generation tests pass after the fix. The live matrix includes both
empty and nonempty intersections, with independently specified expected IDs.

## Reproduce and inspect the complete runs

See [the runner instructions](../scripts/e2e/codebook/README.md) and the Nx target
`backend:verify-codebook-autocoder-live`. The database is freshly migrated with
all 163 Liquibase changesets. PostgreSQL 14.22, Redis 7.4 and Liquibase 4.28
images are pinned by digest. Synthetic data is seeded with SQL; every export
and Autocoder job then uses the regular authenticated application HTTP path,
real Bull workers and PostgreSQL persistence. No production data is involved.

The machine-readable report records source, runner, frontend/backend build and
package hashes, expected scope/options, HTTP progress, Bull job data and worker
timestamps, download hashes, reference results and actual database rows.
Downloaded JSON and DOCX artifacts are retained alongside the report.

Studio comparison loads the actual adapter from Studio commit
`86ff5d9d8f2d61d63258e15024f04beb3ef69b50` and dependencies from its installation.
Only Studio's repository/profile boundaries are in memory. Studio receives the
explicitly expected filtered subset and normalized item identities, because it
has no Kodierbox job/bundle filtering. Complete JSON structures and all unzipped
DOCX entries are compared; only creation/modification timestamps are normalized.
The explicit variable/item/options assertions are independent of that comparison.

The Autocoder reference is the published Responses 5.2.0 development dependency.
Six cases cover ceil/equality near zero, NULL, infinity, read-only configuration
and exponent text. Each runs an actual dependent SUM_SCORE derivation. The
reference receives exactly the strings stored in PostgreSQL; numeric test
values must not silently replace persisted text. `"1e-15"` already gives
DERIVE_ERROR in 5.2.0, while `"0.000000000000001"` exercises rounding near zero.
An invalid duplicate output namespace must fail in the real queue without
altering any response rows. A failed Codebook scope must expose no download.

## Recorded outcome

[Machine-readable report](qa/codebook-live-2026-10-18/report.json) and all 24
actual downloads are retained in the same directory. The successful run used
source commit `28ef6c47` (runtime scope fix `524e0c84`). All 24 JSON/DOCX
comparisons match Studio, including the partial intersection that previously
exported an excluded variable. Six SOLVER cases and all 18 persisted result rows
match the independent reference. Empty intersection and invalid namespace fail
in Bull; failed Autocoder preflight leaves the complete before/after response
snapshot unchanged. Both production builds and both lints pass locally. The complete backend suite
passes with **3,062 tests in 196 suites**; **63 tests in seven suites are skipped**.
It ran sequentially with `npx nx test backend --maxWorkers=1 --workerIdleMemoryLimit=768MB`
and `NODE_OPTIONS=--max-old-space-size=2048` (171.774 seconds).

[Browser reproduction before](qa/codebook-live-2026-10-18/browser-reproduction-before.log),
[the same stress after](qa/codebook-live-2026-10-18/browser-reproduction-after.log)
and [four failing scope regressions before](qa/codebook-live-2026-10-18/scope-regression-before.log)
retain the negative evidence. Reproduce the browser stress by inserting
`cy.then({ timeout: 10000 }, () => new Cypress.Promise(resolve => setTimeout(resolve, 4500)));`
immediately before `releaseProfiles()` in the two cases, then run
`npx nx run frontend:e2e --configuration=ci --browser=electron --spec=cypress/zoneless/statistics-codebook.cy.ts --skip-nx-cache`.
Remove that diagnostic line afterward. This deliberate slowdown is not part of
the regular test. Full-suite and exact-head remote CI outcomes are recorded in
the PR description after they finish.

## Boundaries

This is a local production-build API/database/queue acceptance. The separate
Cypress suite covers the production frontend with simulated authentication and
HTTP responses. Studio persistence is not exercised. No new real-user browser
acceptance, Microsoft Word visual acceptance, merge or deployment is implied.
The original installed-adapter comparison and Word reports retain their own
scope; this evidence supplements rather than replaces them. Remote CI must be
checked on the final pushed PR head and recorded in the PR description.
