import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CodingFreshnessSummaryItemDto, CodingFreshnessReason } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import { CodingJobFreshnessStatus } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { getNonCodingIssueReviewJobSqlCondition } from './coding-job-type.util';
import { ManualJobFreshnessRow, ReconcileAppliedManualCodingJobsOptions } from './coding-freshness.types';
import { uniquePositiveIds, uniqueStrings } from './coding-freshness.util';

@Injectable()
export class CodingJobFreshnessService {
  private readonly logger = new Logger(CodingJobFreshnessService.name);

  constructor(private readonly connection: DataSource) {}

  async markCodingJobsStaleForUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source',
    manager?: EntityManager
  ): Promise<void> {
    await this.markCodingJobsStaleForScope(workspaceId, unitIds, [], reason, status, manager);
  }

  async markCodingJobsStaleForResetScope(
    workspaceId: number,
    unitIds: number[],
    responseIds: number[],
    manager: EntityManager
  ): Promise<void> {
    await this.markCodingJobsStaleForScope(workspaceId, unitIds, responseIds, 'RESET', 'stale_source', manager);
  }

  async updateStaleCodingJobResetCountsForResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) return;

    await manager.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.status = 'completed'
            AND cj.freshness_status = 'stale_source'
            AND cju.response_id = ANY($2::int[])
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET freshness_affected_units = GREATEST(
              COALESCE(cj.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(cj.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            freshness_updated_at = now(),
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids]
    );
  }

  private async markCodingJobsStaleForScope(
    workspaceId: number,
    unitIds: number[],
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'>,
    manager?: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(unitIds);
    const additionalResponseIds = uniquePositiveIds(responseIds);
    if (ids.length === 0 && additionalResponseIds.length === 0) {
      return;
    }

    const includeResponseIds = additionalResponseIds.length > 0;
    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          INNER JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND (resp.unitid = ANY($2::int[])${includeResponseIds ? ' OR cju.response_id = ANY($5::int[])' : ''})
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR cj.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN cj.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(cj.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(cj.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      includeResponseIds ? [workspaceId, ids, status, reason, additionalResponseIds] : [workspaceId, ids, status, reason]
    );
  }

  async markCodingJobsStaleForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source',
    manager?: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cju.response_id = ANY($2::int[])
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR cj.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN cj.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(cj.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(cj.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async markAppliedCodingJobsResultsClearedForUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    await this.markAppliedCodingJobsResultsCleared(
      workspaceId,
      'unit',
      ids,
      reason,
      status,
      manager
    );
  }

  async markAppliedCodingJobsResultsClearedForResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    await this.markAppliedCodingJobsResultsCleared(
      workspaceId,
      'response',
      ids,
      reason,
      status,
      manager
    );
  }

  async reconcileAppliedManualCodingJobs(
    workspaceId: number,
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    options: ReconcileAppliedManualCodingJobsOptions = {}
  ): Promise<number> {
    const queryRunner = options.manager ?? this.connection;
    const params: unknown[] = [workspaceId, status, reason];
    const scopeConditions: string[] = [];

    const unitNames = uniqueStrings(options.unitNames || []);
    if (unitNames.length > 0) {
      params.push(unitNames);
      scopeConditions.push(`AND cju.unit_name = ANY($${params.length}::text[])`);
    }

    const variableIds = uniqueStrings(options.variableIds || []);
    if (variableIds.length > 0) {
      params.push(variableIds);
      scopeConditions.push(`AND cju.variable_id = ANY($${params.length}::text[])`);
    }

    const missingManualResultCondition = `
      resp.id IS NULL OR (
        resp.status_v2 IS NULL
        AND resp.code_v2 IS NULL
        AND resp.score_v2 IS NULL
      )
    `;

    const rows = await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name))
              FILTER (WHERE ${missingManualResultCondition}) AS affected_units,
            COUNT(DISTINCT cju.response_id)
              FILTER (WHERE ${missingManualResultCondition}) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          LEFT JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.status = 'results_applied'
            ${scopeConditions.join('\n            ')}
          GROUP BY cju.coding_job_id
          HAVING COUNT(*) FILTER (WHERE ${missingManualResultCondition}) > 0
        )
        UPDATE coding_job cj
        SET status = 'completed',
            freshness_status = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN 'stale_source'
              ELSE $2
            END,
            freshness_reason = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN cj.freshness_reason
              WHEN $2 = 'current'
                THEN NULL
              ELSE $3
            END,
            freshness_updated_at = now(),
            freshness_affected_units = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_units, 0),
                affected_jobs.affected_units::int
              )
            END,
            freshness_affected_responses = CASE
              WHEN $2 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_responses, 0),
                affected_jobs.affected_responses::int
              )
            END,
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
        RETURNING cj.id
      `,
      params
    );

    const reconciledCount = Array.isArray(rows) ? rows.length : 0;
    if (reconciledCount > 0) {
      this.logger.log(
        `Reconciled ${reconciledCount} applied manual coding jobs in workspace ${workspaceId}`
      );
    }

    return reconciledCount;
  }

  async markCodingJobsCurrent(
    workspaceId: number,
    codingJobIds: number[],
    manager?: EntityManager
  ): Promise<void> {
    const ids = uniquePositiveIds(codingJobIds);
    if (ids.length === 0) {
      return;
    }

    const queryRunner = manager ?? this.connection;
    await queryRunner.query(
      `
        UPDATE coding_job
        SET freshness_status = 'current',
            freshness_reason = NULL,
            freshness_updated_at = now(),
            freshness_affected_units = 0,
            freshness_affected_responses = 0,
            updated_at = now()
        WHERE workspace_id = $1
          AND id = ANY($2::int[])
          AND training_id IS NULL
          AND COALESCE(freshness_status, 'current') <> 'stale_source'
      `,
      [workspaceId, ids]
    );
  }

  private async markAppliedCodingJobsResultsCleared(
    workspaceId: number,
    scope: 'unit' | 'response',
    ids: number[],
    reason: CodingFreshnessReason,
    status: CodingJobFreshnessStatus,
    manager?: EntityManager
  ): Promise<void> {
    const queryRunner = manager ?? this.connection;
    const scopeCondition = scope === 'unit' ?
      'resp.unitid = ANY($2::int[])' :
      'cju.response_id = ANY($2::int[])';

    await queryRunner.query(
      `
        WITH affected_jobs AS (
          SELECT
            cju.coding_job_id,
            COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS affected_units,
            COUNT(DISTINCT cju.response_id) AS affected_responses
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          LEFT JOIN response resp ON resp.id = cju.response_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.status = 'results_applied'
            AND ${scopeCondition}
          GROUP BY cju.coding_job_id
        )
        UPDATE coding_job cj
        SET status = 'completed',
            freshness_status = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN 'stale_source'
              ELSE $3
            END,
            freshness_reason = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') = 'stale_source'
                THEN cj.freshness_reason
              WHEN $3 = 'current'
                THEN NULL
              ELSE $4
            END,
            freshness_updated_at = now(),
            freshness_affected_units = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_units, 0),
                affected_jobs.affected_units::int
              )
            END,
            freshness_affected_responses = CASE
              WHEN $3 = 'current' AND COALESCE(cj.freshness_status, 'current') <> 'stale_source'
                THEN 0
              ELSE GREATEST(
                COALESCE(cj.freshness_affected_responses, 0),
                affected_jobs.affected_responses::int
              )
            END,
            updated_at = now()
        FROM affected_jobs
        WHERE cj.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async markCodingJobsStaleForAddedUnitIds(
    workspaceId: number,
    unitIds: number[],
    reason: Extract<CodingFreshnessReason, 'RESULT_ADDED'>,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source'
  ): Promise<void> {
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return;
    }

    await this.connection.query(
      `
        WITH added_responses AS (
          SELECT
            response.id AS response_id,
            unit.name AS unit_name,
            response.variableid AS variable_id,
            CONCAT_WS('|', person.login, COALESCE(bookletinfo.name, ''), unit.name) AS unit_key
          FROM response
          INNER JOIN unit ON unit.id = response.unitid
          INNER JOIN booklet ON booklet.id = unit.bookletid
          LEFT JOIN bookletinfo ON bookletinfo.id = booklet.infoid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
            AND person.consider = true
            AND response.unitid = ANY($2::int[])
            AND response.is_autocoder_generated IS NOT TRUE
        ),
        matched_job_responses AS (
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN coding_job_variable
            ON UPPER(coding_job_variable.unit_name) = UPPER(added_responses.unit_name)
            AND coding_job_variable.variable_id = added_responses.variable_id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
          UNION
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN variable_bundle
            ON variable_bundle.workspace_id = $1
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(variable_bundle.variables) bundle_variable
              WHERE UPPER(bundle_variable ->> 'unitName') = UPPER(added_responses.unit_name)
                AND bundle_variable ->> 'variableId' = added_responses.variable_id
              )
          INNER JOIN coding_job_variable_bundle
            ON coding_job_variable_bundle.variable_bundle_id = variable_bundle.id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable_bundle.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
        ),
        affected_jobs AS (
          SELECT
            coding_job_id,
            COUNT(DISTINCT unit_key) AS affected_units,
            COUNT(DISTINCT response_id) AS affected_responses
          FROM matched_job_responses
          GROUP BY coding_job_id
        )
        UPDATE coding_job
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR coding_job.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN coding_job.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(coding_job.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(coding_job.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE coding_job.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async markCodingJobsStaleForAddedResponseIds(
    workspaceId: number,
    responseIds: number[],
    reason: Extract<CodingFreshnessReason, 'RESULT_ADDED'>,
    status: Exclude<CodingJobFreshnessStatus, 'current'> = 'stale_source'
  ): Promise<void> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return;
    }

    await this.connection.query(
      `
        WITH added_responses AS (
          SELECT
            response.id AS response_id,
            unit.name AS unit_name,
            response.variableid AS variable_id,
            CONCAT_WS('|', person.login, COALESCE(bookletinfo.name, ''), unit.name) AS unit_key
          FROM response
          INNER JOIN unit ON unit.id = response.unitid
          INNER JOIN booklet ON booklet.id = unit.bookletid
          LEFT JOIN bookletinfo ON bookletinfo.id = booklet.infoid
          INNER JOIN persons person ON person.id = booklet.personid
          WHERE person.workspace_id = $1
            AND person.consider = true
            AND response.id = ANY($2::int[])
            AND response.is_autocoder_generated IS NOT TRUE
        ),
        matched_job_responses AS (
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN coding_job_variable
            ON UPPER(coding_job_variable.unit_name) = UPPER(added_responses.unit_name)
            AND coding_job_variable.variable_id = added_responses.variable_id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
          UNION
          SELECT
            coding_job.id AS coding_job_id,
            added_responses.unit_key,
            added_responses.response_id
          FROM added_responses
          INNER JOIN variable_bundle
            ON variable_bundle.workspace_id = $1
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(variable_bundle.variables) bundle_variable
              WHERE UPPER(bundle_variable ->> 'unitName') = UPPER(added_responses.unit_name)
                AND bundle_variable ->> 'variableId' = added_responses.variable_id
              )
          INNER JOIN coding_job_variable_bundle
            ON coding_job_variable_bundle.variable_bundle_id = variable_bundle.id
          INNER JOIN coding_job
            ON coding_job.id = coding_job_variable_bundle.coding_job_id
          WHERE coding_job.workspace_id = $1
            AND coding_job.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('coding_job')}
        ),
        affected_jobs AS (
          SELECT
            coding_job_id,
            COUNT(DISTINCT unit_key) AS affected_units,
            COUNT(DISTINCT response_id) AS affected_responses
          FROM matched_job_responses
          GROUP BY coding_job_id
        )
        UPDATE coding_job
        SET freshness_status = CASE
              WHEN $3 = 'stale_source' OR coding_job.freshness_status = 'stale_source'
                THEN 'stale_source'
              WHEN coding_job.freshness_status = 'review_required' OR $3 = 'review_required'
                THEN 'review_required'
              ELSE $3
            END,
            freshness_reason = $4,
            freshness_updated_at = now(),
            freshness_affected_units = GREATEST(
              COALESCE(coding_job.freshness_affected_units, 0),
              affected_jobs.affected_units::int
            ),
            freshness_affected_responses = GREATEST(
              COALESCE(coding_job.freshness_affected_responses, 0),
              affected_jobs.affected_responses::int
            ),
            updated_at = now()
        FROM affected_jobs
        WHERE coding_job.id = affected_jobs.coding_job_id
      `,
      [workspaceId, ids, status, reason]
    );
  }

  async getReviewRequiredUnitIds(
    workspaceId: number,
    unitIds: number[],
    excludedCodingJobIds: number[] = [],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = uniquePositiveIds(unitIds);
    if (ids.length === 0) {
      return [];
    }

    const excludedIds = uniquePositiveIds(excludedCodingJobIds);
    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        SELECT DISTINCT resp.unitid AS "unitId"
        FROM coding_job_unit cju
        INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
        INNER JOIN response resp ON resp.id = cju.response_id
        WHERE cj.workspace_id = $1
          AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cj.freshness_status IN ('review_required', 'stale_source')
          AND resp.unitid = ANY($2::int[])
          AND (
            cardinality($3::int[]) = 0
            OR cj.id <> ALL($3::int[])
          )
      `,
      [workspaceId, ids, excludedIds]
    ) as Array<{ unitId: number | string }>;

    return uniquePositiveIds(rows.map(row => Number(row.unitId)));
  }

  async getReviewRequiredCodingJobIdsCoveredByResponseIds(
    workspaceId: number,
    responseIds: number[],
    manager?: EntityManager
  ): Promise<number[]> {
    const ids = uniquePositiveIds(responseIds);
    if (ids.length === 0) {
      return [];
    }

    const queryRunner = manager ?? this.connection;
    const rows = await queryRunner.query(
      `
        WITH candidate_jobs AS (
          SELECT DISTINCT cju.coding_job_id
          FROM coding_job_unit cju
          INNER JOIN coding_job cj ON cj.id = cju.coding_job_id
          WHERE cj.workspace_id = $1
            AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
            AND cj.training_id IS NULL
            AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
            AND cj.freshness_status = 'review_required'
            AND cju.response_id = ANY($2::int[])
        )
        SELECT cj.id AS "jobId"
        FROM coding_job cj
        INNER JOIN candidate_jobs candidate ON candidate.coding_job_id = cj.id
        INNER JOIN coding_job_unit cju ON cju.coding_job_id = cj.id
        WHERE cj.workspace_id = $1
          AND COALESCE(cju.workspace_id, cj.workspace_id) = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND cj.freshness_status = 'review_required'
        GROUP BY cj.id
        HAVING BOOL_AND(cju.response_id = ANY($2::int[]))
      `,
      [workspaceId, ids]
    ) as Array<{ jobId: number | string }>;

    return uniquePositiveIds(rows.map(row => Number(row.jobId)));
  }

  async getManualCodingJobFreshnessBlocker(
    workspaceId: number
  ): Promise<CodingFreshnessSummaryItemDto | null> {
    const raw = await this.connection.query(
      `
        SELECT
          COUNT(DISTINCT cj.id) AS "jobCount",
          COUNT(DISTINCT CONCAT_WS('|', cju.person_login, cju.booklet_name, cju.unit_name)) AS "affectedUnits",
          COUNT(DISTINCT cju.response_id) AS "affectedResponses"
        FROM coding_job cj
        LEFT JOIN coding_job_unit cju
          ON cju.coding_job_id = cj.id
          AND COALESCE(cju.workspace_id, cj.workspace_id) = cj.workspace_id
        WHERE cj.workspace_id = $1
          AND cj.training_id IS NULL
          AND ${getNonCodingIssueReviewJobSqlCondition('cj')}
          AND (
            cj.freshness_status IN ('review_required', 'stale_source')
            OR (
              cj.status <> 'results_applied'
              AND cju.id IS NOT NULL
            )
          )
      `,
      [workspaceId]
    ) as ManualJobFreshnessRow[] | undefined;

    const row = Array.isArray(raw) ? raw[0] : undefined;
    const jobCount = Number(row?.jobCount || 0);
    if (jobCount === 0) {
      return null;
    }

    const affectedUnits = Number(row?.affectedUnits || 0);
    const affectedResponses = Number(row?.affectedResponses || 0);

    return {
      version: 'v2',
      state: 'MANUAL_REVIEW_REQUIRED',
      unitCount: affectedUnits > 0 ? affectedUnits : jobCount,
      affectedResponseCount: affectedResponses
    };
  }
}
