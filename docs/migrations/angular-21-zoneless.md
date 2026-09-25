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

1. Validate login and logout against the intended Keycloak test realm.
2. Open a coding job, select codes and notes, verify persisted data after reload,
   then complete/pause/resume the job. Check delayed saves and network failures.
3. Expire the session during an unsaved change, reauthenticate, restore the draft,
   and verify it is cleared only after persistence succeeds.
4. Validate embedded-player messages, route changes, dialogs, uploads, exports,
   timers and asynchronous subscriptions for missing change notifications.
5. Run the same flows in the zoneless build. Signals, AsyncPipe, bound events or
   `markForCheck()` must notify Angular for every visible asynchronous update.
6. Only then switch the default entry point, remove the ZoneJS polyfill and audit
   test/component-test dependencies before removing the package.

The isolated `npx nx run frontend:e2e-replay-live` harness uses a real backend,
database and embedded player, but uses replay tokens and deliberately does not
provide a real Keycloak realm. It cannot replace gates 1–3.

Reference: [Angular 21 zoneless guide](https://github.com/angular/angular/blob/v21.2.0/adev/src/content/guide/zoneless.md).

## Verification on 2026-09-25

- Frontend lint: passed.
- Frontend tests: 206 suites, 2,097 tests passed.
- Production build and opt-in zoneless build: passed.
- Regular browser smoke suite: 3 tests passed.
- Zoneless browser suite: 4 tests passed, including absence of `window.Zone`.
- Isolated live suite: replay and item-matrix export both passed against the
  real backend, PostgreSQL, Redis and embedded Aspect player. The temporary
  containers were removed by the harness.
- Real Keycloak login, session expiry and coding-draft recovery remain unverified:
  no designated test realm/account was supplied. Existing unit tests cover the
  corresponding recovery logic but are not a substitute for those live flows.
