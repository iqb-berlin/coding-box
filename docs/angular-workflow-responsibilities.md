# Workflow responsibilities

The job-definition and training-comparison dialogs compose feature-local units.
Keep new business rules in those units instead of extending the dialog's event handlers.

| Unit | Owns | Leaves to the dialog |
| --- | --- | --- |
| `CodingJobForm` / `CodingJobDefinitionRules` | Typed controls, validation and definition payload rules | Submit intent and UI feedback |
| `CodingJobDefinitionPersistence` | Job writes followed by coder assignments | Closing and save feedback |
| `JobVariableDataFacade` | Replacing variable/scope requests, cancellation, loading and errors | Applying loaded rows and triggering draft restoration |
| `JobVariableAvailability` | Backend availability snapshots and draft reservations | Refreshing rows, bundles and selections |
| `JobVariableCasePolicy` | Regular vs. derive-error case counts and explicit opt-in requirements | Workspace setting and user choices |
| `job-variable-selection` | Stable variable identity and reconciliation with fresh or filtered rows | SelectionModel replacement and reactive event bridges |
| `job-definition-recovery` | Draft context, dirty-state rules and saved variable/bundle mapping | Provider registration, dependency readiness and form application |
| `CodingWorkload` | Deterministic workload estimates | Memoization and authoritative distribution previews |
| `TrainingComparisonDataFacade` / `TrainingReliabilityFacade` | Comparison/reliability requests and lifecycle | Current selection and table updates |
| `TrainingDiscussionRecovery` | Dirty discussion capture, merging pages and clearing accepted entries per context | Applying entries and initiating saves |
| `training-discussion-values` | Integer parsing, display normalization, score lookup and unchanged-value decisions | Editing, authorization and save feedback |
| `training-comparison-replay` | Replay-row identity and review code choices | Message subscription, permissions and opening replay |
| `training-comparison-presentation` | Selected code slots, comparison status and modal-code calculation | Translated labels and table binding |

Facades and recovery services are provided by each dialog, while pure calculations
receive typed values. The dialogs still own the form/table lifecycle, user actions,
selection subscriptions and the existing save orchestration. No shared mutable
selection store or additional UI/state library is introduced.

Keep the SelectionModel-to-signal bridges when replacing selections after loading
or recovery: mutating a SelectionModel alone does not invalidate Angular computed
consumers. Reentrant draft restoration may start another variable load before a
synchronous preloaded response finalizes; its loading state must remain active.

Regression coverage includes focused domain/facade tests, the existing native
zoneless component tests, and `cypress/zoneless/manual-preparation.cy.ts` plus
`cypress/zoneless/training-comparison.cy.ts`. The browser suites exercise delayed
requests, filter ordering, recovery, selections, workload estimates and discussion saves.
