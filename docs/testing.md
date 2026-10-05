# Test strategy and required quality gates

## Required checks

Every pull request to `develop` or `main`, direct branch pipeline, and valid
release or prerelease tag runs these blocking checks on its own revision:

1. Complete backend Jest suite with coverage and reporter regression tests.
2. Complete frontend Jest suite with coverage.
3. Live replay and incomplete item-matrix export against an isolated stack.
4. Real Keycloak permissions and the browser import → coding → reload → submit
   → export/download workflow against an isolated stack.

The frontend and backend unit suites run sequentially. Product image uploads and
public release publication depend on all four functional gates. A failed or
missing required gate prevents those uploads. Existing builder and test helper
images can still be uploaded before the gates. The separate Liquibase rollback
checks use the uploaded SHA images and run afterwards; a later rollback failure
does not undo shared tags already updated after the functional gates passed.
Review the individual jobs and their reports before merging; a successful build
alone is not test evidence.

## Coverage and assertions

Jest requires at least 60% statements, branches, functions and lines in each
application. This is a minimum, not an assertion of complete functional coverage.
Coverage must be collected in CI and the tests must assert observable outcomes,
including failure paths. Generic calls that ignore exceptions or count method
invocations are not acceptable substitutes for behaviour tests.

CI retains JUnit results, Cobertura, HTML, lcov and JSON coverage reports for
30 days, including failed runs. Report paths are `reports/junit/<project>.xml`
and `coverage/apps/<project>/`. Browser failures retain screenshots and redacted
stack logs under `cypress/replay-artifacts/` and `tmp/replay-e2e-artifacts/`.

## Risk and acceptance matrix

| Risk | Required evidence |
| --- | --- |
| Unauthorized administration, role escalation or workspace access | Real Keycloak login without permissions; global user listing and self-admin PATCH are denied, fresh auth data remains nonadmin, UI denies workspace access and protected APIs return their current 401 denial responses |
| Upload or queue completes without importing data | Browser chunk upload, real Redis/Bull completion and PostgreSQL overview increases by one person |
| Coding disappears or an old response replaces a new selection | Replay service regression tests; real browser save, notes, reload and persisted selected code |
| Queued note saves overwrite text while the user keeps typing | Delayed-response regression keeps the newest local text; live workflow verifies the full saved note after reload and in the downloaded export |
| Submitted jobs lose manually saved results | Real submit succeeds, stored job is complete, export includes the imported person, code and note |
| Exports report success with missing results | Live incomplete item-matrix jobs remain failed and deliver diagnostic ZIP; successful workflow checks downloaded CSV content |
| Replay mixes people, aliases or pages | Embedded Aspect player, two people, pages, aliases, anchors and delayed navigation regression |
| Unit failures are hidden in a green pipeline | Blocking complete suites, 60% coverage checks and JUnit failure/initialization-error reporting |

Requirement-specific datasets and independent reference limits remain documented
in `docs/requirements/`. Add an acceptance row and a test for each material new
failure mode. Review expected files as domain fixtures; do not regenerate goldens
from the implementation merely to make a failing test pass.

## Local commands

Run commands from the repository root, one at a time:

```sh
npx nx test backend --codeCoverage --skipNxCache --maxWorkers=2
npx nx test frontend --codeCoverage --skipNxCache --maxWorkers=2
npx nx lint backend
npx nx lint frontend
npx nx run frontend:test-e2e-harness
npx nx run frontend:e2e-replay-live
npx nx run frontend:e2e-workflows
```

The live suites require Docker, Docker Compose and Cypress. Each run creates its
own Compose project, database, Redis prefix, random credentials, workspace and
ports. Cleanup removes only that project's resources. Never point the acceptance
fixtures at an existing production or development database.

The test stack disables Nx daemon/plugin subprocesses, limits Node heaps to
2 GiB per process and uses two Angular build workers. The synthetic Keycloak
container has a 1 GiB memory limit. These limits reduce local and CI resource
pressure without replacing real services or application responses.

The workflow fixtures upload baseline player assets through the API, then import
a new person through the browser. Fixture preparation marks only that synthetic
response as ready for manual coding and excludes the two baseline replay persons
from the new coding job. It does not assert an automated coding run. Keycloak,
application responses, PostgreSQL persistence and Redis/Bull jobs are real;
observation intercepts do not replace successful server responses.

For Docker-in-Docker, CI sets `REPLAY_E2E_CONNECT_HOST=docker` and
`REPLAY_E2E_PUBLISH_HOST=0.0.0.0`. Authentication runs forward these services to
browser loopback origins so native Web Crypto and Keycloak PKCE remain enabled.

## Remaining specialist checks

The live workflow covers real persistence and queue use, but does not replace
production-scale load, worker crash/retry, accessibility or independent numerical
reference validation. The opt-in PostgreSQL suites and targeted export load
helper remain additional checks; their results must be reported separately.
The six pre-existing skipped backend unit cases remain visible in JUnit and
require a separate decision or repair rather than being counted as passed.

## Authorization regressions

Global user administration now requires `AdminGuard`, including changes to
`isAdmin`, user creation/deletion and user-to-workspace assignments. The live
Keycloak workflow verifies that a nonadmin cannot list global user details or
make themselves admin and that freshly read authentication data still reports
`isAdmin: false` after the denied write.

HTTP controller regressions exercise the real admin, workspace and access-level
guards. Study managers (workspace access level 3) retain workspace user selection
through a directory limited to `id` and `username`, and may manage access only in
their own workspace. Both access-level updates and membership replacement require
this permission, so ordinary members cannot use the second write route to bypass
the access-level check. Nonmembers
receive an empty member list used by frontend route permission resolution.
These tests cover the named user and workspace permission boundaries; they do
not establish a blanket authorization audit of all other administration APIs.
