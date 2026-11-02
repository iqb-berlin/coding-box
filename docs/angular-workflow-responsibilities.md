# Workflow responsibilities

The job-definition and training-comparison dialogs compose feature-local units.
Keep new business rules in those units instead of extending the dialog's event handlers.

| Unit | Owns | Leaves to the dialog |
| --- | --- | --- |
| `CodingJobForm` / `CodingJobDefinitionRules` | Typed controls, validation and definition payload rules | Submit intent and UI feedback |
| `CodingJobDefinitionPersistence` | Job writes followed by coder assignments | Closing and save feedback |
| `JobVariableDataFacade` | Replacing variable/scope requests, cancellation, loading and errors | Applying loaded rows and triggering draft restoration |
| `JobDefinitionCodersFacade` | Coder catalog/assignment requests, ID-based CDK selection, immutable capacities and coder payloads | Read-only policy, selection commands and waiting for the catalog before draft restoration |
| `JobDistributionPreviewFacade` | Immediate cancellation of old previews, 300 ms debounce, workspace/destruction cancellation and authoritative totals | Form validity, current selection projection, stable seed and memoized fallback workload |
| `JobVariableAvailability` | Backend availability snapshots and draft reservations | Refreshing rows, bundles and selections |
| `JobVariableCasePolicy` | Regular vs. derive-error case counts and explicit opt-in requirements | Workspace setting and user choices |
| `job-variable-selection` | Stable variable identity and reconciliation with fresh or filtered rows | SelectionModel replacement and reactive event bridges |
| `job-definition-recovery` | Draft context, dirty-state rules and saved variable/bundle mapping | Provider registration, dependency readiness and form application |
| `CodingWorkload` | Deterministic workload estimates | Memoization and authoritative distribution previews |
| `TrainingComparisonDataFacade` / `TrainingReliabilityFacade` | Comparison/reliability requests and lifecycle | Current selection and table updates |
| `TrainingDiscussionEditorFacade` | Discussion draft signals, score inference, row writes, queued replay notes, error feedback and recovery integration | Editing permission/context, current page, replay-row matching and session recovery registration |
| `TrainingDiscussionRecovery` | Dirty discussion capture, merging pages and clearing accepted entries per context | Applying entries and initiating saves |
| `training-discussion-values` | Integer parsing, display normalization, score lookup and unchanged-value decisions | Editing, authorization and save feedback |
| `training-comparison-replay` | Replay-row identity and review code choices | Message subscription, permissions and opening replay |
| `training-comparison-presentation` | Selected code slots, comparison status and modal-code calculation | Translated labels and table binding |

Facades and recovery services are provided by each dialog, while pure calculations
receive typed values. The dialogs still own the form/table lifecycle, user actions,
variable/bundle selection subscriptions and the existing save orchestration. No shared mutable
selection store or additional UI/state library is introduced.

Coder facade signals are read-only to consumers. The existing CDK selection API
remains available to the capacity view; replacing the selection detaches its old
listener and emits one change to invalidate the owner's workload calculation.
Catalog completion also releases recovery after failures, so a later retry remains
possible. Catalog and assignment requests may finish in either order.

The preview facade reads a typed request from the owner after debouncing, keeping
the latest form and selection values. Invalid inputs retain the local fallback;
HTTP errors do not end the command stream. A new command cancels the old request
before waiting for its debounce, and a workspace round trip cannot accept the old
response. The authoritative preview signal does not invalidate the expensive,
separately memoized fallback estimate. Native facade tests cover these boundaries;
component and browser tests continue to exercise the existing form and recovery.

The discussion editor facade is provided by each comparison dialog. Its signals
are read-only to consumers; input, replay and recovery commands own their writes.
The existing recovery service still merges entries across pages and removes only
accepted entries. An explicit replay/recovery score, including `null`, retains its
meaning. Replay notes arriving during a code write keep the latest text visible
and cause one follow-up write with the returned score. Auth failures capture that
pending text for recovery; other save failures retain editable input and feedback.

The owner supplies a captured editing context with current permission checks.
Training/cohort changes invalidate old completions even after an A-to-B-to-A
round trip. Paging keeps the cohort context. Closing the dialog or changing the
workspace cancels subscriptions; already accepted backend writes keep their
existing semantics. Direct facade tests, native component tests and a browser
regression exercise the delayed code/notes sequence and explicit score.

Keep the SelectionModel-to-signal bridges when replacing selections after loading
or recovery: mutating a SelectionModel alone does not invalidate Angular computed
consumers. Reentrant draft restoration may start another variable load before a
synchronous preloaded response finalizes; its loading state must remain active.

Regression coverage includes focused domain/facade tests, the existing native
zoneless component tests, and `cypress/zoneless/manual-preparation.cy.ts` plus
`cypress/zoneless/training-comparison.cy.ts`. The browser suites exercise delayed
requests, filter ordering, recovery, selections, workload estimates and discussion saves.
