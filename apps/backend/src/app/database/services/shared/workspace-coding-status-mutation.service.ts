import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  DataSource,
  EntityManager,
  QueryRunner
} from 'typeorm';

const WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE = 774020251;

export type WorkspaceCodingStatusMutation = {
  revision: number;
};

export const WORKSPACE_CODING_STATUS_RECONCILER =
  Symbol('WORKSPACE_CODING_STATUS_RECONCILER');

export type WorkspaceCodingStatusReconciler = {
  markUnitsStaleAfterResultChange(
    workspaceId: number,
    unitIds: number[],
    reason: 'RESULT_UPDATED'
  ): Promise<void>;
};

type WorkspaceMutationContext = {
  workspaceId: number;
  queryRunner: QueryRunner;
  operation: WorkspaceCodingStatusMutation | null;
  operationFailed: boolean;
  reconciling: boolean;
  phase: 'idle' | 'starting' | 'running' | 'closing' | 'inactive';
  pendingNestedMutations: Set<Promise<unknown>>;
};

@Injectable()
export class WorkspaceCodingStatusMutationService {
  private static readonly contexts =
    new AsyncLocalStorage<Map<number, WorkspaceMutationContext>>();

  private readonly logger =
    new Logger(WorkspaceCodingStatusMutationService.name);

  private readonly revisionFailureRecoveries = new Set<number>();

  constructor(
    private readonly connection: DataSource,
    private readonly moduleRef: ModuleRef
  ) {}

  async run<T>(
    workspaceId: number,
    mutation: (operation: WorkspaceCodingStatusMutation) => Promise<T>
  ): Promise<T> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const activeContext = WorkspaceCodingStatusMutationService.contexts
      .getStore()?.get(normalizedWorkspaceId);

    if (
      activeContext?.phase === 'running' &&
      activeContext.operation
    ) {
      return this.executeNestedMutation(
        activeContext,
        activeContext.operation,
        mutation
      );
    }

    const queryRunner = this.connection.createQueryRunner();
    let locked = false;
    let context: WorkspaceMutationContext | null = null;
    await queryRunner.connect();

    try {
      await queryRunner.query(
        'SELECT pg_advisory_lock($1::int, $2::int)',
        [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
      );
      locked = true;

      const parentContexts =
        WorkspaceCodingStatusMutationService.contexts.getStore();
      const contexts = new Map(parentContexts || []);
      context = {
        workspaceId: normalizedWorkspaceId,
        queryRunner,
        operation: null,
        operationFailed: false,
        reconciling: false,
        phase: 'idle',
        pendingNestedMutations: new Set()
      };
      contexts.set(normalizedWorkspaceId, context);

      return await WorkspaceCodingStatusMutationService.contexts.run(
        contexts,
        async () => {
          await this.prepareForMutation(context);
          return this.executeOperation(context, mutation);
        }
      );
    } finally {
      if (context) {
        context.phase = 'inactive';
      }
      try {
        if (locked) {
          await queryRunner.query(
            'SELECT pg_advisory_unlock($1::int, $2::int)',
            [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, normalizedWorkspaceId]
          );
        }
      } finally {
        await queryRunner.release();
      }
    }
  }

  async lockInTransaction(
    manager: EntityManager,
    workspaceId: number
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      [
        WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE,
        this.normalizeWorkspaceId(workspaceId)
      ]
    );
  }

  async getRevision(workspaceId: number): Promise<number> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const raw = await this.connection.query(
      'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
      [normalizedWorkspaceId]
    ) as Array<{ revision: number | string }>;
    return Number(raw[0]?.revision || 0);
  }

  async recoverExpired(workspaceId: number): Promise<boolean> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const activeContext = WorkspaceCodingStatusMutationService.contexts
      .getStore()?.get(normalizedWorkspaceId);
    if (activeContext?.phase === 'running') {
      await this.failExpiredOperations(
        activeContext.queryRunner,
        normalizedWorkspaceId
      );
      return this.reconcileWithinLock(activeContext);
    }

    return (await this.withAdvisoryLockIfAvailable(
      normalizedWorkspaceId,
      async context => {
        await this.failExpiredOperations(
          context.queryRunner,
          normalizedWorkspaceId
        );
        return this.reconcileWithinLock(context);
      }
    )) === true;
  }

  async recoverAllExpired(): Promise<number> {
    const rows = await this.connection.query(
      `
        SELECT recovery_candidate.workspace_id
        FROM (
          SELECT status_revision.workspace_id
          FROM workspace_coding_status_revision status_revision
          WHERE status_revision.failed_test_results_revision IS NOT NULL
          UNION
          SELECT expired_operation.workspace_id
          FROM workspace_coding_status_revision_operation expired_operation
          WHERE expired_operation.started_at < now() - interval '24 hours'
        ) recovery_candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM workspace_coding_status_revision_operation active_operation
          WHERE active_operation.workspace_id = recovery_candidate.workspace_id
            AND active_operation.started_at >= now() - interval '24 hours'
        )
        ORDER BY recovery_candidate.workspace_id
      `
    ) as Array<{ workspace_id: number | string }>;
    let recoveredWorkspaceCount = 0;

    for (const row of rows) {
      if (await this.recoverExpired(Number(row.workspace_id))) {
        recoveredWorkspaceCount += 1;
      }
    }
    return recoveredWorkspaceCount;
  }

  async reconcile(workspaceId: number): Promise<boolean> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const activeContext = WorkspaceCodingStatusMutationService.contexts
      .getStore()?.get(normalizedWorkspaceId);
    if (activeContext?.phase === 'running') {
      return this.reconcileWithinLock(activeContext);
    }

    return (await this.withAdvisoryLockIfAvailable(
      normalizedWorkspaceId,
      context => this.reconcileWithinLock(context)
    )) === true;
  }

  private async prepareForMutation(
    context: WorkspaceMutationContext
  ): Promise<void> {
    await this.failExpiredOperations(context.queryRunner, context.workspaceId);
    if (await this.hasRecordedFailure(context.workspaceId)) {
      const recovered = await this.reconcileWithinLock(context);
      if (!recovered) {
        throw new Error(
          'Could not reconcile coding status revision for workspace ' +
          `${context.workspaceId} before starting a new mutation.`
        );
      }
    }
  }

  private async executeOperation<T>(
    context: WorkspaceMutationContext,
    mutation: (operation: WorkspaceCodingStatusMutation) => Promise<T>
  ): Promise<T> {
    context.phase = 'starting';
    const operation = await this.beginOperation(
      context.queryRunner,
      context.workspaceId
    );
    context.operation = operation;
    context.operationFailed = false;
    context.phase = 'running';

    try {
      const result = await mutation(operation);
      await this.closeNestedMutationWindow(context);
      if (context.operationFailed) {
        await this.failAndReconcileOperation(context, operation);
        return result;
      }
      await this.completeOperation(
        context.queryRunner,
        context.workspaceId,
        operation
      );
      return result;
    } catch (error) {
      await this.closeNestedMutationWindow(context);
      await this.failAndReconcileOperation(context, operation);
      throw error;
    } finally {
      if (context.operation === operation) {
        context.operation = null;
      }
      context.operationFailed = false;
      context.phase = 'closing';
    }
  }

  private executeNestedMutation<T>(
    context: WorkspaceMutationContext,
    operation: WorkspaceCodingStatusMutation,
    mutation: (operation: WorkspaceCodingStatusMutation) => Promise<T>
  ): Promise<T> {
    const nestedMutation = (async () => {
      try {
        return await mutation(operation);
      } catch (error) {
        context.operationFailed = true;
        throw error;
      }
    })();
    context.pendingNestedMutations.add(nestedMutation);
    nestedMutation.then(
      () => context.pendingNestedMutations.delete(nestedMutation),
      () => context.pendingNestedMutations.delete(nestedMutation)
    );
    return nestedMutation;
  }

  private async closeNestedMutationWindow(
    context: WorkspaceMutationContext
  ): Promise<void> {
    while (context.pendingNestedMutations.size > 0) {
      await Promise.allSettled(
        Array.from(context.pendingNestedMutations)
      );
    }
    context.phase = 'closing';
  }

  private async failAndReconcileOperation(
    context: WorkspaceMutationContext,
    operation: WorkspaceCodingStatusMutation
  ): Promise<void> {
    let failureRecorded = false;
    try {
      await this.failOperation(
        context.queryRunner,
        context.workspaceId,
        operation.revision
      );
      failureRecorded = true;
    } catch {
      // The orphaned lease keeps snapshots unstable until scheduled recovery.
    }
    context.operation = null;
    if (failureRecorded && !context.reconciling) {
      try {
        await this.reconcileWithinLock(context);
      } catch {
        // The recorded failure keeps snapshots unstable until recovery succeeds.
      }
    }
  }

  private async beginOperation(
    executor: Pick<EntityManager, 'query'>,
    workspaceId: number
  ): Promise<WorkspaceCodingStatusMutation> {
    const raw = await executor.query(
      `
        WITH operation AS (
          SELECT clock_timestamp() AS started_at
        ), next_revision AS (
          INSERT INTO workspace_test_results_revision (workspace_id, revision, updated_at)
          VALUES ($1, 1, now())
          ON CONFLICT (workspace_id)
          DO UPDATE SET revision = workspace_test_results_revision.revision + 1,
                        updated_at = now()
          RETURNING revision
        ), status_update AS (
          INSERT INTO workspace_coding_status_revision (
            workspace_id,
            revision,
            processed_test_results_revision,
            updated_at
          )
          SELECT $1, 1, 0, now()
          FROM operation
          CROSS JOIN next_revision
          ON CONFLICT (workspace_id)
          DO UPDATE SET revision =
                          workspace_coding_status_revision.revision + 1,
                        updated_at = now()
        ), operation_insert AS (
          INSERT INTO workspace_coding_status_revision_operation (
            workspace_id,
            test_results_revision,
            started_at
          )
          SELECT $1, next_revision.revision, operation.started_at
          FROM next_revision
          CROSS JOIN operation
        )
        SELECT next_revision.revision
        FROM next_revision
        CROSS JOIN operation
      `,
      [workspaceId]
    ) as Array<{ revision: number | string }> | undefined;
    const revision = Number(raw?.[0]?.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error(
        `Could not start coding status revision operation for workspace ${workspaceId}.`
      );
    }
    return { revision };
  }

  private async completeOperation(
    executor: Pick<EntityManager, 'query'>,
    workspaceId: number,
    operation: WorkspaceCodingStatusMutation
  ): Promise<void> {
    await executor.query(
      `
        WITH completed_operation AS (
          DELETE FROM workspace_coding_status_revision_operation
          WHERE workspace_id = $1
            AND test_results_revision = $2
        )
        INSERT INTO workspace_coding_status_revision (
          workspace_id,
          revision,
          processed_test_results_revision,
          updated_at
        )
        VALUES ($1, 1, $2, now())
        ON CONFLICT (workspace_id)
        DO UPDATE SET revision =
                        workspace_coding_status_revision.revision + 1,
                      processed_test_results_revision = GREATEST(
                        workspace_coding_status_revision.processed_test_results_revision,
                        EXCLUDED.processed_test_results_revision
                      ),
                      updated_at = now()
      `,
      [workspaceId, operation.revision]
    );
  }

  private async failOperation(
    executor: Pick<EntityManager, 'query'>,
    workspaceId: number,
    revision: number
  ): Promise<void> {
    await executor.query(
      `
        WITH failed_operation AS (
          DELETE FROM workspace_coding_status_revision_operation
          WHERE workspace_id = $1
            AND test_results_revision = $2
        )
        UPDATE workspace_coding_status_revision
        SET failed_test_results_revision = GREATEST(
              COALESCE(failed_test_results_revision, 0),
              $2
            ),
            last_test_result_update_failed_at = now(),
            revision = workspace_coding_status_revision.revision + 1,
            updated_at = now()
        WHERE workspace_id = $1
      `,
      [workspaceId, revision]
    );
  }

  private async failExpiredOperations(
    executor: Pick<EntityManager, 'query'>,
    workspaceId: number
  ): Promise<boolean> {
    const rows = await executor.query(
      `
        WITH expired_operations AS (
          DELETE FROM workspace_coding_status_revision_operation
          WHERE workspace_id = $1
            AND started_at < now() - interval '24 hours'
          RETURNING test_results_revision
        ), latest_expired AS (
          SELECT MAX(test_results_revision) AS revision
          FROM expired_operations
        )
        INSERT INTO workspace_coding_status_revision (
          workspace_id,
          revision,
          processed_test_results_revision,
          failed_test_results_revision,
          last_test_result_update_failed_at,
          updated_at
        )
        SELECT $1, 1, 0, latest_expired.revision, now(), now()
        FROM latest_expired
        WHERE latest_expired.revision IS NOT NULL
        ON CONFLICT (workspace_id)
        DO UPDATE SET failed_test_results_revision = GREATEST(
                        COALESCE(
                          workspace_coding_status_revision.failed_test_results_revision,
                          0
                        ),
                        EXCLUDED.failed_test_results_revision
                      ),
                      last_test_result_update_failed_at = now(),
                      revision = workspace_coding_status_revision.revision + 1,
                      updated_at = now()
        RETURNING workspace_id
      `,
      [workspaceId]
    ) as Array<{ workspace_id: number | string }> | undefined;
    return Array.isArray(rows) && rows.length === 1;
  }

  private async reconcileWithinLock(
    context: WorkspaceMutationContext
  ): Promise<boolean> {
    const { workspaceId } = context;
    if (this.revisionFailureRecoveries.has(workspaceId)) {
      return false;
    }
    this.revisionFailureRecoveries.add(workspaceId);
    const previousReconciling = context.reconciling;
    context.reconciling = true;

    try {
      if (!(await this.hasRecordedFailure(workspaceId))) {
        return false;
      }

      const unitRows = await this.connection.query(
        `
          SELECT unit_record.id
          FROM "unit" unit_record
          INNER JOIN booklet ON booklet.id = unit_record.bookletid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
        `,
        [workspaceId]
      ) as Array<{ id: number | string }>;
      const codingFreshnessService =
        this.moduleRef.get<WorkspaceCodingStatusReconciler>(
          WORKSPACE_CODING_STATUS_RECONCILER,
          { strict: false }
        );
      const reconcileFreshness = () => (
        codingFreshnessService.markUnitsStaleAfterResultChange(
          workspaceId,
          unitRows.map(row => Number(row.id)),
          'RESULT_UPDATED'
        )
      );
      if (context.phase === 'running' && context.operation) {
        await reconcileFreshness();
      } else {
        await this.executeOperation(
          context,
          () => reconcileFreshness()
        );
      }
      await this.markAllProductiveCodingJobsStale(workspaceId);

      const reconciledRevision = await this.getRevision(workspaceId);
      const recovered = await this.clearFailureAfterReconciliation(
        workspaceId,
        reconciledRevision
      );
      if (recovered) {
        this.logger.warn(
          `Recovered coding status revision for workspace ${workspaceId} ` +
          `after a full conservative reconciliation at revision ${reconciledRevision}.`
        );
      }
      return recovered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        'Could not reconcile failed coding status revision for workspace ' +
        `${workspaceId}: ${message}`
      );
      return false;
    } finally {
      context.reconciling = previousReconciling;
      this.revisionFailureRecoveries.delete(workspaceId);
    }
  }

  private async hasRecordedFailure(workspaceId: number): Promise<boolean> {
    const rows = await this.connection.query(
      `
        SELECT failed_test_results_revision
        FROM workspace_coding_status_revision
        WHERE workspace_id = $1
          AND failed_test_results_revision IS NOT NULL
      `,
      [workspaceId]
    ) as Array<{ failed_test_results_revision: number | string }>;
    return rows.length > 0;
  }

  private async markAllProductiveCodingJobsStale(
    workspaceId: number
  ): Promise<void> {
    await this.connection.query(
      `
        UPDATE coding_job
        SET freshness_status = 'stale_source',
            freshness_reason = 'RESULT_UPDATED',
            freshness_updated_at = now(),
            updated_at = now()
        WHERE workspace_id = $1
          AND training_id IS NULL
          AND COALESCE(job_type, 'coding') <> 'coding_issue_review'
      `,
      [workspaceId]
    );
  }

  private async clearFailureAfterReconciliation(
    workspaceId: number,
    reconciledRevision: number
  ): Promise<boolean> {
    if (!Number.isSafeInteger(reconciledRevision) || reconciledRevision < 1) {
      throw new Error('A valid reconciled revision is required.');
    }
    const rows = await this.connection.query(
      `
        UPDATE workspace_coding_status_revision status_revision
        SET failed_test_results_revision = NULL,
            last_test_result_update_failed_at = NULL,
            revision = status_revision.revision + 1,
            updated_at = now()
        WHERE status_revision.workspace_id = $1
          AND status_revision.failed_test_results_revision IS NOT NULL
          AND status_revision.failed_test_results_revision <= $2
          AND status_revision.processed_test_results_revision = $2
          AND EXISTS (
            SELECT 1
            FROM workspace_test_results_revision test_revision
            WHERE test_revision.workspace_id = status_revision.workspace_id
              AND test_revision.revision = $2
          )
          AND NOT EXISTS (
            SELECT 1
            FROM workspace_coding_status_revision_operation active_operation
            WHERE active_operation.workspace_id = status_revision.workspace_id
          )
        RETURNING status_revision.workspace_id
      `,
      [workspaceId, reconciledRevision]
    ) as Array<{ workspace_id: number | string }> | undefined;
    return Array.isArray(rows) && rows.length === 1;
  }

  private async withAdvisoryLockIfAvailable<T>(
    workspaceId: number,
    callback: (context: WorkspaceMutationContext) => Promise<T>
  ): Promise<T | undefined> {
    const queryRunner = this.connection.createQueryRunner();
    let locked = false;
    let context: WorkspaceMutationContext | null = null;
    await queryRunner.connect();

    try {
      const rows = await queryRunner.query(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked',
        [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, workspaceId]
      ) as Array<{ locked: boolean | string }> | undefined;
      locked = rows?.[0]?.locked === true || rows?.[0]?.locked === 't';
      if (!locked) {
        return undefined;
      }

      const parentContexts =
        WorkspaceCodingStatusMutationService.contexts.getStore();
      const contexts = new Map(parentContexts || []);
      context = {
        workspaceId,
        queryRunner,
        operation: null,
        operationFailed: false,
        reconciling: false,
        phase: 'idle',
        pendingNestedMutations: new Set()
      };
      contexts.set(workspaceId, context);
      return await WorkspaceCodingStatusMutationService.contexts.run(
        contexts,
        () => callback(context)
      );
    } finally {
      if (context) {
        context.phase = 'inactive';
      }
      try {
        if (locked) {
          await queryRunner.query(
            'SELECT pg_advisory_unlock($1::int, $2::int)',
            [WORKSPACE_TEST_RESULTS_LOCK_NAMESPACE, workspaceId]
          );
        }
      } finally {
        await queryRunner.release();
      }
    }
  }

  private normalizeWorkspaceId(workspaceId: number): number {
    const normalized = Number(workspaceId);
    if (!Number.isInteger(normalized) || normalized < 1) {
      throw new Error(
        'A valid workspace id is required for the coding status mutation.'
      );
    }
    return normalized;
  }
}
