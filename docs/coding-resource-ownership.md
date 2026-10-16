# Coding resource ownership rollout

Apply the Liquibase changelog before starting the updated backend. Four nullable
`creator_user_id` fields record the creator of bundles, job definitions, coding
jobs and trainings. Existing rows remain unchanged with a null creator. Deleting
a creator sets these fields to null and preserves the resources.

Level 2 can create resources and change its own resources. Foreign resources and
legacy resources without a creator remain readable but become read-only for
Level 2, as required by issue #833. Level 3 and administrators can still edit and
delete these resources. Assigned-coder actions retain their separate checks.
Level 2 cannot apply results, including training and double-coding reviews.

This deliberately changes legacy Level-2 editing. Before rollout, ensure a
Level-3 study manager or administrator is available for existing resources.
There is no public creator-reassignment endpoint. Do not infer or backfill an
owner from assigned coders or the first workspace manager: those are not evidence
of who created a resource. Any administrative backfill needs independently
verified ownership and a separate, reviewed data migration.

The migration can be rolled back independently, but rollback discards the newly
recorded ownership values. Use the previous backend with the previous schema;
do not roll back the schema underneath the updated backend.

The opt-in `coding-ownership.postgres.spec.ts` uses persisted roles and resources
to verify legacy/foreign/owned authorization, immutable creators, atomic mixed
bulk deletion, audit persistence, and competing row-lock/state/role changes.
`cypress/workflows/coding-ownership.cy.ts` exercises real Keycloak role login and
HTTP authorization for all four resource types in the disposable workflow stack.

## Protected coding job states

New jobs accept only pending, active, paused or open status. Review and applied
states cannot be manufactured at creation. Restart requires at least one open
unit and rejects review/applied jobs. A stale client request to change an applied
job receives a bad-request response without changing its state.

Progress, notes, pause/resume, manager updates, restarts and result application
coordinate through the workspace mutation lock and the coding-job row lock.
They re-read state after waiting for concurrent changes. Applying results reuses
the caller's transaction; it does not commit an independent partial operation.
The PostgreSQL tests exercise real lock waiters, including progress and notes
that arrive while a job is being submitted for review.

Coder writes also recheck the current workspace coding capability and job
assignment after acquiring those locks, using the caller's transaction manager.
Removing an assignment or disabling coding while a request waits therefore
prevents a late pause, resume, submission, progress write or note write.
