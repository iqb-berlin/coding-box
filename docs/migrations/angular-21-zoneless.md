# Angular 21 zoneless preparation

The production entry point still uses `provideZoneChangeDetection()` and ZoneJS.
The migration configuration is opt-in and is not a production release switch.

## Run the candidate

- `npx nx serve frontend --configuration=zoneless`
- `npx nx build frontend --configuration=zoneless`
- `env -u ELECTRON_RUN_AS_NODE npx nx e2e frontend --configuration=zoneless`

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

## Release gates still required

A successful smoke test is not evidence that all application views are zoneless
compatible. Before changing the production entry point:

The isolated suite below covers login/logout, a complete coding job, delayed
notes, a simulated save failure, real session invalidation and draft recovery in
both builds. Before changing the production entry point:

1. Repeat authentication against the intended deployed Keycloak test realm and
   its actual client settings.
2. Validate embedded-player messages, route changes, dialogs, uploads, exports,
   timers and asynchronous subscriptions for missing change notifications.
3. Run these remaining flows in the zoneless build. Signals, AsyncPipe, bound events or
   `markForCheck()` must notify Angular for every visible asynchronous update.
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
against the real backend, selects a code and checks notes after reload. Only the
notes endpoint is temporarily made to fail to create an unsaved draft. The test
invalidates the real Keycloak session, signs in again and checks draft persistence
and cleanup, then pauses, resumes, finishes the job and signs out. The zoneless
variant also asserts that `window.Zone` is absent.

The JavaScript adapter is updated from 23 to 26.2.4. Keycloak 25+ only puts the
nonce in the ID token; the old adapter also expected it in access and refresh
tokens. Nonce validation remains enabled, and PKCE S256 is explicit. See the
[Keycloak migration guide](https://www.keycloak.org/docs/latest/upgrading/#using-older-javascript-adapter).
The adapter requires a secure browser context (HTTPS, or localhost for these
tests). This isolated realm does not verify the deployed realm's settings.

Reference: [Angular 21 zoneless guide](https://github.com/angular/angular/blob/v21.2.0/adev/src/content/guide/zoneless.md).

## Verification on 2026-09-25

- Frontend lint: passed.
- Frontend tests: 206 suites, 2,098 tests passed.
- Production build and opt-in zoneless build: passed.
- Regular browser suite: 7 tests passed. The default Cypress configuration now
  excludes the two live specs, which require their own backend harness.
- Zoneless browser suite: 4 tests passed, including absence of `window.Zone`.
- Isolated live suite: replay and item-matrix export both passed against the
  real backend, PostgreSQL, Redis and embedded Aspect player. The temporary
  containers were removed by the harness.
- Isolated real Keycloak coding/session suite: passed with ZoneJS and zoneless.
  It covers login, persisted code and notes after reload, a failed note save,
  server-side session invalidation, draft recovery and cleanup, pause/resume,
  completion and logout.
