import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { settleFacetQueries } from './flat-response-facets.util';

export function queryFilteredFlatResponseBookletFacets(
  connection: DataSource, query: SelectQueryBuilder<ResponseEntity>, optionLimit: number, threshold: number
): Promise<Array<Array<{ v: string }>>> {
  function buildFlatResponseFilteredBookletsSubquery(
    baseQb: SelectQueryBuilder<ResponseEntity>
  ): [string, unknown[]] {
    return baseQb
      .clone()
      .select('"bookletEntity"."id"', 'bookletId')
      .distinct(true)
      .getQueryAndParameters();
  }

  async function queryFlatResponseProcessingDurationOptions(
    baseQb: SelectQueryBuilder<ResponseEntity>,
    maxOptions: number,
    processingDurationThresholdMs: number
  ): Promise<Array<{ v: string }>> {
    const [filteredBookletsSql, filteredBookletsParams] =
      buildFlatResponseFilteredBookletsSubquery(baseQb);
    const thresholdParam = `$${filteredBookletsParams.length + 1}`;
    const limit = Math.max(1, Math.floor(maxOptions));

    return connection.query(
      `
        SELECT DISTINCT
          CASE
            WHEN first_duration.duration_ms IS NULL THEN 'Unbekannt'
            WHEN first_duration.duration_ms < ${thresholdParam} THEN 'Kurz'
            ELSE 'Lang'
          END AS v
        FROM (${filteredBookletsSql}) filtered_booklets
        LEFT JOIN LATERAL (
          SELECT (bl_terminated.ts - bl_running.ts) AS duration_ms
          FROM bookletlog bl_running
          JOIN bookletlog bl_terminated
            ON bl_terminated.bookletid = bl_running.bookletid
          WHERE bl_running.bookletid = filtered_booklets."bookletId"
            AND bl_running.key = 'CONTROLLER'
            AND bl_running.parameter = 'RUNNING'
            AND bl_terminated.key = 'CONTROLLER'
            AND bl_terminated.parameter = 'TERMINATED'
          ORDER BY bl_running.id ASC, bl_terminated.id ASC
          LIMIT 1
        ) first_duration ON TRUE
        ORDER BY v ASC
        LIMIT ${limit}
      `,
      [...filteredBookletsParams, processingDurationThresholdMs]
    );
  }

  async function queryFlatResponseUnitProgressOptions(
    baseQb: SelectQueryBuilder<ResponseEntity>,
    maxOptions: number
  ): Promise<Array<{ v: string }>> {
    const [filteredBookletsSql, filteredBookletsParams] =
      buildFlatResponseFilteredBookletsSubquery(baseQb);
    const limit = Math.max(1, Math.floor(maxOptions));

    return connection.query(
      `
        SELECT DISTINCT progress.v AS v
        FROM (${filteredBookletsSql}) filtered_booklets
        CROSS JOIN LATERAL (
          SELECT
            CASE
              WHEN COUNT(DISTINCT progress_unit.id) > 0
                AND COUNT(DISTINCT progress_unit.id) =
                  COUNT(DISTINCT CASE
                    WHEN progress_log.id IS NOT NULL THEN progress_unit.id
                  END)
              THEN 'complete'
              ELSE 'incomplete'
            END AS v
          FROM unit progress_unit
          LEFT JOIN bookletlog progress_log
            ON progress_log.bookletid = filtered_booklets."bookletId"
            AND progress_log.key = 'CURRENT_UNIT_ID'
            AND progress_log.parameter = progress_unit.alias
          WHERE progress_unit.bookletid = filtered_booklets."bookletId"
            AND progress_unit.alias IS NOT NULL
        ) progress
        ORDER BY progress.v ASC
        LIMIT ${limit}
      `,
      filteredBookletsParams
    );
  }

  return settleFacetQueries([
    queryFlatResponseProcessingDurationOptions(query, optionLimit, threshold),
    queryFlatResponseUnitProgressOptions(query, optionLimit)
  ]);
}
