# Test strategy and required quality gates

## Required checks

Every pull request to `develop` or `main`, direct branch pipeline, and valid
release or prerelease tag selects these blocking checks on its own revision:

1. Complete backend Jest suite with coverage and reporter regression tests.
2. Complete frontend Jest suite with coverage.
3. Live replay and incomplete item-matrix export against an isolated stack.
4. The existing real Keycloak login, permissions, session recovery and file settings suite.
5. The additional browser import → coding → reload → submit → export/download
   workflow against an isolated stack.
6. Lint for both applications.

The frontend and backend unit suites run sequentially. Application image uploads and
public release publication depend on all six gates. A failed or
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
30 days, including failed runs. Report paths are `coverage/apps/<project>/junit.xml`
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
| A manual note impersonates a backend action or actor | Real authenticated API rejects event/actor/job claims; persisted notes use the authenticated user and manual event type; journal CSV neutralizes formula cells |
| Persisted import data loses its provenance | Browser upload checks the persisted batch event against its exact Bull job, workspace and authenticated user without raw response values |
| A failed audit or persistence write leaves a partial mutation | Import rollback regressions include pre-query failures and pending concurrent writes; isolated PostgreSQL fault injection proves deletion rollback with dependent rows, followed by a successful data-and-audit commit |

Requirement-specific datasets and independent reference limits remain documented
in `docs/requirements/`. Add an acceptance row and a test for each material new
failure mode. Review expected files as domain fixtures; do not regenerate goldens
from the implementation merely to make a failing test pass.

## Local commands

Run commands from the repository root, one at a time:

```sh
npx nx test backend --configuration=ci --skipNxCache --maxWorkers=2
npx nx test frontend --configuration=ci --skipNxCache --maxWorkers=2
npx nx lint backend
npx nx lint frontend
npx nx run frontend:test-e2e-harness
npx nx run frontend:e2e-replay-live --configuration=production
npx nx run frontend:e2e-auth-live --configuration=production
npx nx run frontend:e2e-workflows --configuration=production
```

The live suites require Docker, Docker Compose and Cypress. Each run creates its
own Compose project, database, Redis prefix, random credentials, workspace and
ports. Cleanup removes only that project's resources. Never point the acceptance
fixtures at an existing production or development database.

The workflow's audit rollback case temporarily rejects one synthetic person's
deletion event with a PostgreSQL constraint in that disposable database. It removes
the constraint in `finally`, verifies the failed deletion preserved all dependent
rows, then repeats the real API call and checks both deletion and trusted audit.
This is representative transaction evidence, not exhaustive coverage of every
audited mutation or a production database test.

The test stack disables Nx daemon/plugin subprocesses, limits Node heaps to
2 GiB per process and uses two Angular build workers. The synthetic Keycloak
container has a 1 GiB memory limit. These limits reduce local and CI resource
pressure without replacing real services or application responses.

The workflow fixtures upload baseline player assets through the API, then import
a new person through the browser. Fixture preparation marks only that synthetic
response as ready for manual coding and excludes the baseline replay persons
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

## Integration with the current Angular baseline

The existing zoneless frontend coverage, browser tests, security checks and
authentication harness remain in place. The additional workflow uses `--workflows`
and its own Cypress configuration; it does not replace the authentication suite.
The earlier note-save race correction is already in the baseline. Backend coverage
and required main/release checks close the remaining gaps. Run the functional
CI-scenario fixtures through `nx run frontend:test-quality-gates`.
