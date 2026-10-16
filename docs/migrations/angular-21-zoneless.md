# Angular 21 zoneless migration

The regular `main.ts` entry point now uses `provideZonelessChangeDetection()`.
Production and development builds omit the ZoneJS polyfill. All frontend Jest
tests now use `setupZonelessTestEnv()`; timer tests use native Jest timers. Cypress
component tests use the native zoneless mount adapter and omit the polyfill.
`zone.js` is no longer a direct dependency;
Angular tooling can still resolve it as an optional peer without loading it.

This is a source/build change, not confirmation of a deployed production switch.
The production artifact from PR #1039 was validated on the test instance on
2026-09-28. The production deployment is a separate release step. For rollback,
retain the previous frontend image and restore it without changing the backend
or database; no database migration is involved.

## Signal state

Mutable view state in the coding, replay, validation, export and administration
components is now stored in writable signals. Pure state-derived getters use
`computed()`. Templates read the signals and write through `set()` or `update()`;
array, object, Map and Set updates replace the affected value. Missing profiles
retain their DTO prototype when updated, including its serialization methods.
Component code no longer calls `markForCheck()` or `detectChanges()`.

Shared application state and replay job status also use signals. Existing service
getters and setters retain their API while tracking the underlying signal reads.
Validation task, result and batch records update immutably so the dialog can track
service state directly. RxJS remains responsible for HTTP requests, cancellation,
ordered events and background-job streams. Their existing synchronous workspace
notifications are preserved. Form controls and Material table data sources retain
their own supported update APIs.

Tests assign writable signal values with `set()` and verify the derived values and
views. Native zoneless tests wait for Angular stability after delayed results,
progress, timer callbacks and context changes. The inventory records source
changes; test execution and CI remain separate validation requirements.

### Local signal migration validation (2026-10-02)

The signal conversion covers 667 state fields in 60 components and 77 pure
getters converted to computed signals, plus shared application, replay and
validation state and per-row replay-anchor signals. It was checked locally
against PR #1039 at `45cf2e09`.

| Check | Result |
| --- | --- |
| `npx nx run frontend:lint --fix` | Passed |
| `npx nx run frontend:test --maxWorkers=2` | 2,518 tests, 225 suites passed |
| `npx nx run frontend:test-zoneless --maxWorkers=2` | 756 tests, 30 suites passed |
| `npx nx run frontend:build --configuration=production` | Passed |
| `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e --configuration=zoneless --spec=cypress/zoneless/file-validation-info.cy.ts` | 14 tests, 1 affected spec passed |
| `npx nx run frontend:zoneless-approval` | Current inventory and risk coverage references passed |

The browser checks use fixture responses for backend and identity endpoints.
Global HTTP errors now render immediately; information-dialog retry tests close
that visible error through its button before trying the table action again.
Regression tests also verify derived service state, immutable workspace snapshots
and preservation of missing-profile DTO methods. CI and deployment verification
remain separate release steps.

The subsequent review found two remaining asynchronous view-state regressions.
Replay-anchor drafts, saved values and save/reset status now use per-row signals.
Note presence and response frequencies use signals containing immutable Set and
Map updates. Six native zoneless regression cases failed before these fixes and
passed afterwards: save/reset success and errors, delayed note indicators and
delayed frequencies. They assert the rendered controls and cells without manual
change-detection calls. A browser case separately gates note and frequency
responses until after the result rows have rendered.

A further review found quadratic Map copying when the file-validation dialog
initialized or refreshed duplicate selections. Duplicate-selection and file
expansion maps now build locally and publish one signal value after the loop.
Three regression cases cover large duplicate lists in both entry paths and
preservation of expansion states. Before the fix, each large-list case copied
1,999,000 entries for 2,000 logins; the corrected implementation avoids those
copies. An isolated benchmark of the duplicate-selection initializer with
10,000 logins measured 4,556 ms before and 1 ms afterwards with identical results.
This measures Map construction, excluding browser rendering.
The full 85-test, 13-spec browser run passed before this performance fix;
the affected file-validation spec was rerun afterwards.

## Run and validate

- `npx nx test frontend --configuration=ci --maxWorkers=2`
- `npx nx serve frontend`
- `npx nx build frontend --configuration=production`
- `env -u ELECTRON_RUN_AS_NODE npx nx e2e frontend --configuration=ci` (requires the production build above)
- `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e-replay-live --configuration=production`
- `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e-auth-live --configuration=production`

The separate `zoneless` build, serve, Jest and Cypress configurations have been
removed. The normal entry points and test environments are zoneless. CI runs the
complete frontend unit suite once, serves the production artifact for one browser
suite, and retains independent live replay and authentication checks.
The dated validation notes below and above describe earlier migration stages.

The code-selector replay integration tests and user-menu tests explicitly use
`provideZonelessChangeDetection()` and wait for Angular stability rather than
forcing view updates. These cover pending saves, failures/retries, completion,
recovery resets, comment validation and delayed profile/role changes.

## Work completed during preparation

- Code selector: OnPush, signals for derived lists, stable tracking keys,
  render callbacks for focus/scrolling and reactive service notifications.
- User menu: OnPush, signal state, ignored late profile responses after destruction
  and lifecycle-bound authentication subscriptions.
- Home and application shell: lifecycle-bound subscriptions. Home also cancels
  pending workspace-access requests, preventing navigation after destruction.
- Replay: notify Angular when a new response arrives or a failed navigation
  clears the embedded player. The live replay test caught the stale player.
- Export status: notify Angular when background job updates arrive. The zoneless
  browser suite covers the success toast and the incomplete-export dialog.
- Test files: notify Angular after the file list refreshes. The zoneless browser
  suite uploads a file, checks the result dialog and sees the refreshed row.
- VOCS preview: notify Angular after Schemer loading finishes, preserve the XML
  Schemer and scheme-type reference in the coding overview, and resolve the unit
  reference for direct VOCS previews. Select the requested version range instead
  of the latest uploaded module. Delayed-response component and browser tests
  cover automatic iframe rendering, missing versions and failed downloads.
- Test results: notify Angular when the overview, list or upload progress changes.
  The zoneless browser suite checks the response upload from the import dialog
  through chunk transfer, job completion, result dialog and refreshed overview
  with stubbed server responses.
- System administration: notify Angular when the user list, user workspace list,
  system-notification list, or workspace mutation state changes after a server
  response. Refresh the workspace list only after a real mutation so a pending
  refresh does not reset a user's checkbox selection. Keep asynchronous
  workspace-access preselection in sync with its dialog. The isolated Keycloak
  suite covers workspace creation/deletion, user and workspace lists, access
  preselection, and notification creation/deletion with confirmation dialogs
  against the real backend.
- System and workspace settings: notify Angular when settings load or save,
  including legal notices, Content Pool settings, replay export options and
  database export progress. Delayed-response component tests cover visible
  settings and export status; the Keycloak suite saves Content Pool settings
  and verifies them after reload.
- Manual coding administration: notify Angular after coding job lists and result
  dialogs load, and after process overview updates. Delayed-response component
  tests cover the job list, results and processes. The Keycloak suite opens a
  completed job's results and the process overview against the real backend.

## Release gates and current status

Since 2026-10-01, PR acceptance uses the user-approved risk-based scope in
[the audit](../qa/zoneless-audit.md) and `docs/qa/zoneless-risk-coverage.json`.
Representative workflows and asynchronous mechanisms, regression tests for
confirmed defects, successful final checks and CI are required. Individual
inventory bindings are no longer separate release gates. The documented
residual limits apply; production rollout remains a separate operation.

A successful smoke test is not evidence that all application views are zoneless
compatible. The isolated suite below covers login/logout, a complete coding job,
delayed notes, a simulated save failure, real session invalidation and draft
recovery in both builds. The production entry point has since been changed;
before a production deployment:

1. The real `coding-box` Keycloak realm and client accepted a manual PKCE login
   to a local zoneless frontend. The same frontend also loaded real workspaces
   through the deployed `kodierbox-test.iqb.hu-berlin.de` backend. The PR's
   production frontend was then deployed to the test instance, and login,
   redirect origin, authenticated views and real workspace data were checked.
2. Broaden zoneless browser checks to views and state changes outside the
   isolated suites. The current suites cover the replay player, uploads,
   item-dataset export, workspace administration, manual job creation and
   coding, read-only review, result application, Content Pool and legal-notice
   settings, replay URL export mode, process overview, system notifications,
   and the workspace database export through progress and download. Component
   tests cover delayed database export progress in both settings views. A small
   real export completed on the test instance, while a longer background export
   and delayed progress polls passed in the isolated Keycloak suite. A
   production-scale background job on the deployed test instance remains a
   release gate before production rollout.
3. Known visible timer and subscription updates in these workflows use
   signals, AsyncPipe or bound events to notify Angular.
   The live tests exercise representative status changes without a second
   user action; untested views remain a rollout risk.
4. The default entry point now uses zoneless change detection and has no ZoneJS
   polyfill. The `zone.js` package remains for Jest and Cypress component tests.
5. For production, build and publish the release frontend image, retain the
   previous image for rollback, deploy only the frontend, and observe login,
   coding, export and background-job health after rollout.

The isolated `npx nx run frontend:e2e-replay-live` harness uses a real backend,
database and embedded player, but uses replay tokens and deliberately does not
provide a real Keycloak realm. The authentication suite below covers those flows.

## Isolated authentication and recovery test

- `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e-auth-live`
- `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e-auth-live --configuration=zoneless`

These commands extend the disposable replay stack with Keycloak 26.4.0, a generated
realm and random temporary passwords. They need Docker Compose and enough free
space for the application image, database and Keycloak. No production account or
external test realm is required. The runner removes its containers, volumes and
realm file after the run. Diagnostic logs are written beneath
`tmp/replay-e2e-artifacts` with replay tokens redacted.

The browser signs in through Keycloak with PKCE, starts a two-response coding job
against the real backend, selects a code and checks notes after reload. It also
saves and reloads a job comment and navigates backward and forward. Only the
notes endpoint is temporarily made to fail to create an unsaved draft. The test
invalidates the real Keycloak session, signs in again and checks draft persistence
and cleanup, then pauses, resumes, finishes the job and signs out. The zoneless
variant also asserts that `window.Zone` is absent.

Additional cases log in again, upload a response CSV through the real chunked
upload API, wait for its background job result, and check the result dialog.
They also open system administration, create and delete a workspace, verify
the user and workspace lists, verify the current user's preselected workspace
access, create and delete a system notification through its confirmation dialog,
and verify the completed job and its result dialog in the manual execution tab.
They save Content Pool settings and verify the value after reload, then open
the workspace process overview. The generated realm
and disposable database keep these mutations isolated.

The JavaScript adapter is updated from 23 to 26.2.4. Keycloak 25+ only puts the
nonce in the ID token; the old adapter also expected it in access and refresh
tokens. Nonce validation remains enabled, and PKCE S256 is explicit. See the
[Keycloak migration guide](https://www.keycloak.org/docs/latest/upgrading/#using-older-javascript-adapter).
The adapter requires a secure browser context (HTTPS, or localhost for these
tests). This isolated realm does not verify the deployed realm's settings.
Manual login against the deployed `coding-box` realm with the local zoneless
frontend additionally confirmed token acceptance by an isolated backend. Its
empty database exposed a home-screen loading state that stayed visible after
the successful response. The home view now marks asynchronous authentication
state updates for checking; a zoneless regression test covers the empty state.
The manual check confirmed the empty-workspace screen after that fix. It did
not exercise a deployed zoneless build or populated workspaces. A subsequent
manual check connected the local zoneless frontend through a temporary local
proxy to `https://kodierbox-test.iqb.hu-berlin.de/api/`. Login and the display
of existing workspaces succeeded. At the time of that earlier check, the
deployed test frontend still included ZoneJS; the deployment below supersedes
that limitation.

Reference: [Angular 21 zoneless guide](https://github.com/angular/angular/blob/v21.2.0/adev/src/content/guide/zoneless.md).

## Verification on 2026-09-25

- Frontend lint: passed.
- Frontend tests: 206 suites, 2,099 tests passed.
- Production build and opt-in zoneless build: passed.
- Regular browser suite: 7 tests passed. The default Cypress configuration now
  excludes the two live specs, which require their own backend harness.
- Zoneless browser suite: 10 tests passed, including absence of `window.Zone`,
  item-dataset export dialogs, a test-file upload and the stubbed test-result
  response-upload flow through job completion and refreshed overview.
- Isolated live suite: replay and item-matrix export both passed against the
  real backend, PostgreSQL, Redis and embedded Aspect player. The zoneless
  variant also passed after fixing the stale player on a failed navigation.
  The temporary containers were removed by the harness.
- Isolated real Keycloak coding/session suite: passed with ZoneJS and zoneless.
  It covers login, persisted code and notes after reload, a failed note save,
  server-side session invalidation, draft recovery and cleanup, pause/resume,
  completion and logout. The expanded three-case suite also passed in both
  modes with real response upload, system administration and manual coding entry.

## Additional verification on 2026-09-26

- Frontend lint: passed.
- Frontend tests: 206 suites, 2,112 tests passed. Delayed-response zoneless
  regression tests reproduce stale settings, export progress, process lists,
  manual coding job lists and result dialogs before the corresponding fixes.
- Production and opt-in zoneless builds: passed.
- Isolated real Keycloak zoneless suite: 3 tests passed against the real backend,
  PostgreSQL, Redis and Keycloak. It now checks persisted job comments and
  backward/forward coding navigation, completed job results, saved Content Pool
  settings after reload and the process overview. An earlier run passed the
  new administration case but timed out waiting for reauthentication in the
  existing session recovery case; the full suite passed on repeat. The comment
  check now follows recovery so it cannot alter the setup timing of that case.

The isolated suite does not prove behavior on the deployed zoneless test
instance. The deployment and remaining browser checks above remain release
gates before switching the production entry point.

## Extended manual workflow verification on 2026-09-26

- Frontend lint, 207 unit-test suites with 2,113 tests, the production build,
  and the opt-in zoneless build passed.
- The five-case isolated Keycloak suite passed in the zoneless browser against
  the real backend, PostgreSQL, Redis, and Keycloak. The added case creates and
  approves a manual job definition, distributes one coding job, codes and
  submits it, opens the read-only review page with the saved code, and applies
  the result through the completion tab. It verifies the resulting job status.
- The same five-case live suite also passed with the regular ZoneJS frontend.
- A second added case saves and reloads the legal notice, resets it, changes
  the replay URL export mode in both directions across reloads, and starts a
  real workspace SQLite export. It observes the progress indicator and the
  successful download. Three running-status polls are held at 42% to verify
  that the progress display and disabled export action persist over time.
- The recovery case logs out the real Keycloak session and then rejects the
  first refresh request with `invalid_grant`, so the reauthentication UI and
  draft recovery are checked without depending on Keycloak refresh timing.
- The browser run exposed missing change-detection notifications for manual
  planning data, definition and dialog loading, and the completed-job and
  applied-results views. These paths now call `markForCheck()` after asynchronous
  updates; a separate zoneless component test covers delayed definition loading.

These local checks do not validate the deployed zoneless test instance or
production-scale background-job durations.

## Deployed test-instance verification on 2026-09-28

- PR head `c00115460b34524df7f4366054ff402d6ac53b9b` was built with the
  regular production configuration and deployed as a frontend-only test image
  to `https://kodierbox-test.iqb.hu-berlin.de/`. Backend, export worker,
  database and Redis were unchanged. The previous frontend image remains
  available for frontend-only rollback. This test image was built on the test
  host and was not published as a release image.
- The public frontend and `/api/health` returned HTTP 200. In the authenticated
  test session, `window.Zone` was absent. Workspace lists, test files, the
  test-result overview and manual-coding administration loaded without browser
  warnings or errors.
- The workspace-rights dialog loaded all 21 workspaces and filtered an entry
  beyond the first 20. An unchanged rights selection for a test user saved
  and reloaded. A temporary additional selection was reverted before closing;
  no additional access was granted.
- A workspace with existing work showed 40 coding jobs. Filtering and opening
  a completed job's read-only review worked; navigation to the next of 46
  cases updated without another click.
- A v2 CSV test export without response values completed and its export job
  was removed without downloading the file. Reloading the authenticated export
  route kept the session and route.
- The isolated production-build Keycloak/backend suite passed again (5/5,
  exit 0), including note persistence, forced session expiration, recovery,
  manual-job creation/completion/review/application and a background export.
  The production-build rights suite passed (4/4, exit 0), including second-page
  success and failure cases. The disposable containers were removed.

These checks found no zoneless regression or test-side merge blocker. They do
not claim a production deployment or production-scale load validation. The
production-scale background-job check above remains open before rollout.
