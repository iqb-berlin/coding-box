# Frontend state and request ownership

Local coding views own their state through component-scoped facades. Views read
signals and invoke named commands. Writable signals stay private; ordinary
facades expose `asReadonly()`, and Subject producers expose `asObservable()`.
These APIs protect writes through the signal/stream interface, not deep mutation
of the returned DTO objects.

## Request semantics

- Replaceable reads use `switchMap`. The job definition filter replaces both
  the variable query and scope summary together, including when preloaded rows
  replace a pending request. Each response still renders independently.
- Ordered settings writes retain `concatMap`: unsubscribing a client request
  cannot undo a write already accepted by the server.
- The reliability CSV command uses `exhaustMap` to ignore repeated export
  commands until the active request has finished or been cancelled.
- Catch recoverable failures inside the inner request so later commands remain
  usable. Release loading state on success, failure and cancellation.
- Draft recovery can synchronously replace preloaded rows with a filtered
  request. Only the current request may release its loading state.
- Cancel workspace-bound requests on the first workspace change, including an
  A-to-B-to-A round trip, and on destruction of their owning view.

## SignalStore pilot

`TrainingReliabilityFacade` is a dialog-local NgRx SignalStore using
`@ngrx/signals` 21.1.1, compatible with the application's Angular 21 peers. It
owns accepted backend statistics, calculation options and loading/export state.
Mean agreement and variable summaries are computed from the original statistics
without mutating the backend DTO. Its public signals are read-only; weighting
and calculation level change through commands.

The view retains Material dialogs, feedback and browser downloads. The store
publishes read-only error/download streams. Reloading statistics for table
paging preserves an export of the same cohort; changing the cohort, mode,
calculation options or workspace cancels that export.

The pilot does not introduce a global store or migrate unrelated features.
Future adoption should be justified by repeated state/request logic and preserve
the same lifecycle and context-isolation tests. Jest, Typed Reactive Forms and
the existing API contracts remain in place.

## Typed Reactive Forms

Complex forms keep their typed controls, initial values and validation policies
in feature-local `*-form.ts` modules. The job definition dialog, coder training
and Testcenter import use independent factory-created forms. Factories do not
need an Angular injector and do not subscribe to events or own application state.

The owning component retains lifecycle-bound subscriptions, permissions,
selection state, feedback, recovery and API orchestration. It delegates rules
such as reference-mode requirements, effective training sample limits and
individual Testcenter URL activation to the form module. Changes to available
case counts are checked against current metadata as well as control validators.
Disabled controls remain available through `getRawValue()` for existing payloads.

Focused form tests cover domain boundaries and conditional validation; existing
component and browser tests cover integration. Small view-only filter controls
stay with their view. Signal Forms remain experimental in this Angular 21
installation; the application continues to use stable Typed Reactive Forms.

See [the large-component inventory](large-component-refactoring.md) for the
remaining responsibility and view boundaries.
