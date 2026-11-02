# TestResults detail state and deletion recovery

`TestResultsComponent` composes the view and refreshes workspace summaries.
`TestResultsDetailsFacade` owns the selected person, booklet/unit tree, responses,
tags, notes, and their request lifetimes. `TestResultsDeletionFacade` owns cleanup
options, previews, confirmations, single-item mutations, and background deletion
jobs. `TestResultsDeletionTaskStore` retains known accepted jobs by workspace for
the current application session, so revisiting the view resumes status reads
without resubmitting a mutation. View models live in `test-results.models.ts`.

## Failure and cancellation behavior

| Situation | Behavior |
| --- | --- |
| Preview/options canceled | Close the dialog, release the operation, preserve selection, and send no mutation. |
| Preview or enqueue failure | A retry calculates a new preview and requires confirmation again. |
| Status request fails for a known job | Keep the job ID and block another deletion; retry only reads the same job. |
| Job fails after committed batches | Invalidate result/validation caches, clear stale selection/details, refresh counts and coding freshness, and show the possibility of partial deletion. Retry requires a fresh preview. |
| Completed job's report fails or is invalid | Refresh committed changes immediately. Retry only reads that job's report; it does not repeat the deletion or emit another change. |
| Completed report contains warnings | Display its warnings alongside the processed count. |
| Single unit/response deletion fails | Reconcile the workspace instead of assuming that the item was removed. A later attempt requires confirmation again. |
| Workspace or component changes | Cancel pending requests and local polling, close deletion dialogs, and ignore late replies. Reset visible progress/retry state; returning to a workspace resumes its known job. |

Cancellation before confirmation prevents a deletion job from being submitted.
Leaving a view or workspace stops local observation; an accepted server job keeps
running. Known job IDs survive feature destruction and workspace changes in the
current application session; they are not persisted across a browser reload.
Confirmed mutations also invalidate their originating caches before dispatch and
when local observation is interrupted, so a canceled HTTP subscription cannot
leave a previously cached snapshot behind. There is no server-side cancellation endpoint or rollback added here.
If an enqueue request fails without returning a job ID, the client cannot establish
whether the server accepted it; it does not automatically repeat that POST.

Removing a response updates both the visible response list and the stored unit
results. Selecting that unit again therefore cannot restore the deleted response
from a local snapshot. Note requests are canceled when their selected person or
unit changes, including an A–B–A workspace change.

## Regression coverage

- `test-results-deletion.facade.spec.ts`: partial job failures, completion warnings,
  preview cancellation, confirmation locks, request snapshots, safe retries, cleanup
  dialogs, job recovery across destroyed views and A–B–A workspace changes, and
  cancellation during preview, confirmation, enqueue, polling, and
  result retrieval.
- `test-results-details.facade.spec.ts`: delayed person/notes responses, selection
  changes, immutable deletion updates, and reselecting units after response deletion.
- `test-results.component.spec.ts`: workspace list/selection reset and facade-to-view
  wiring, alongside the existing import, search, replay, and summary regressions.
- `cypress/zoneless/test-results-deletion.cy.ts`: visible cancellation, status/report
  retry, partial failure with a fresh preview, and leaving a workspace during polling.

Run frontend validation through Nx, sequentially. Browser checks use the production
artifact built by `frontend:build:production` through `frontend:e2e:ci`.
