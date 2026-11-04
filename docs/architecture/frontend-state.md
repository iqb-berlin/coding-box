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
  A-to-B-to-A round trip, and on destruction of their owning view. Accepted
  workspace-setting writes are an exception: the application owns their queue;
  only feedback to the former view is cancelled.

## Workspace settings writes

`WorkspaceSettingsSaveFacade` is local to the settings page. The root-provided
`WorkspaceSettingsWriteQueueService` serializes its accepted writes, including
evaluation-mode presets that update several values. Every command retains its
original workspace ID and finishes across navigation and workspace changes.
Reopening settings waits for outstanding writes to that workspace before reading
values, so an old read cannot hide the final persisted change.
Inputs remain optimistic. Each field tracks its latest intent and last confirmed
value, so an older failure cannot revert a newer input. Numeric drafts have their
own revision: editing during a save preserves the draft even when it returns to
the submitted value. Initial reads update the rollback value without replacing
an edited draft. Evaluation-mode rollback values use the loaded server mode
independently of the optimistic input and the order of initial responses.
Automatic-refresh inputs stay disabled until the initial evaluation mode is
loaded and evaluation-mode writes settle, including queued presets. A failed latest write
restores the last accepted value; later commands still run. Delayed initial reads
cannot overwrite pending or successfully saved inputs. The first workspace
change or view destruction stops local rollback, signal updates and feedback,
including an A-to-B-to-A transition, while the write queue continues. A failed
request releases its workspace's pending count and does not block later writes.

`WorkspaceSettingsService` composes parsed reads with `map` and `catchError`.
Consumers share in-flight reads; removing the last subscriber cancels the HTTP
request. Successful reads retain the existing ten-second value cache. Writes
continue to invalidate that cache.

## Dialog workflow ownership

`ManualCodingExportWorkflowFacade` owns export selection, definition/training
scope snapshots, worksheet-limit confirmation and startup feedback. Its dialogs
close on workspace change or view destruction. The existing export facade and
root export service retain estimation and background-job ownership.

`CodingJobMutationsFacade` owns single/bulk delete confirmations and result
application. It publishes completed mutations to the job list, which retains
selection, filters and pagination. Its subscriptions and loading feedback end
with the original view/context. Result application still notifies the existing
global statistics consumers.

The two page components still have remaining size exceptions. The structure
baseline is tightened for the extracted responsibilities; new facades use the
standard limits without additional exceptions.

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

## Feature view boundaries

The four prioritized large views use local OnPush child components with explicit
inputs and named output events. Children do not inject the owning component or
backend services and do not create copies of forms, selections, timers or stores.
View projections are derived from current owner data; they are not writable
sources for recovery or payloads.

- Job definition: variable cards, bundle cards, coder capacities and distribution
  summary are separate views. Availability and DERIVE_ERROR decisions stay with
  the owner. The summary consumes the same memoized `CodingWorkloadSummary` that
  the owner uses for its calculations. Capacity events return to the owner,
  which replaces coder objects and invalidates the existing preview.
- Coder training: participant/reference selection and the variable/bundle sample
  editor receive the existing typed form. Sample rows refer to the original
  FormArray controls. Selection commands, bundle updates, available-case policy,
  permission changes, create/edit and recovery remain at the owner. The form
  module remains the only implementation of reference/sample validation.
- Testcenter import: login, options, groups and progress/outcome have separate
  views. The same owner retains authentication, polling, confirmation,
  overwrite decisions, retries and uncertain result reconciliation. Progress is
  projected into the active step; recreating a step starts no work.
- Results comparison: selection, the paged table and discussion fields have
  separate views. Page and sort outputs go back to the dialog; its existing
  dialog-local reliability store retains the full cohort/export context. The
  table tracks projected rows by response ID so editing a draft preserves the
  editor DOM and keyboard focus. Code/notes inputs and blur commits return to
  the owner, which retains validation, recovery, API writes and error feedback.

A comparison cohort change invalidates the discussion response context even on
an A-to-B-to-A transition. An already accepted server write may still finish;
its response cannot overwrite drafts in the new context. The first workspace
change closes the old comparison dialog and cancels its subscriptions. Paging
alone preserves the cohort and the pending reliability export. A delayed workspace
setting reloads the table only when the effective regex mode changes; an unchanged
setting preserves the current page.
