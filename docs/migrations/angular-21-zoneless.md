# Angular 21 zoneless preparation

The production entry point still uses `provideZoneChangeDetection()` and ZoneJS.
The migration configuration is opt-in and is not a production release switch.

## Run the candidate

- `npx nx serve frontend --configuration=zoneless`
- `npx nx build frontend --configuration=zoneless`
- `env -u ELECTRON_RUN_AS_NODE npx nx e2e frontend --configuration=zoneless`
- `env -u ELECTRON_RUN_AS_NODE npx nx run frontend:e2e-replay-live --configuration=zoneless`

The candidate uses `main.zoneless.ts`, omits the ZoneJS polyfill and writes builds
to `dist/apps/frontend-zoneless`. The dedicated Cypress configuration keeps the
ZoneJS absence assertion out of the regular E2E suite.

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

## Release gates still required

A successful smoke test is not evidence that all application views are zoneless
compatible. The isolated suite below covers login/logout, a complete coding job,
delayed notes, a simulated save failure, real session invalidation and draft
recovery in both builds. Before changing the production entry point:

1. The real `coding-box` Keycloak realm and client accepted a manual PKCE login
   to a local zoneless frontend. The same frontend also loaded real workspaces
   through the deployed `kodierbox-test.iqb.hu-berlin.de` backend. Deploy the
   PR's zoneless frontend to the intended test instance and confirm its redirect
   and origin settings before production rollout.
2. Complete zoneless browser checks for the remaining views and state changes,
   especially manual job creation, review and application of coding results,
   further settings mutations, and long-running background jobs. The replay
   player, uploads, item-dataset export, workspace administration, manual job
   and result lists, Content Pool settings, process overview and system
   notifications have dedicated coverage now. Component tests cover delayed
   database export progress in both settings views.
3. Audit visible timer and subscription updates across those views. Signals,
   AsyncPipe, bound events or `markForCheck()` must notify Angular for every
   visible asynchronous update.
4. Only then switch the default entry point, remove the ZoneJS polyfill and audit
   test/component-test dependencies before removing the package.

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
of existing workspaces succeeded. The deployed test frontend itself still
includes ZoneJS, so this does not replace a zoneless test deployment.

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
