import { DataSource, SelectQueryBuilder } from 'typeorm';
import { Unit } from '../../entities/unit.entity';

const dimensions = [
  ['codeRows', 'code', 'booklets'], ['groupRows', 'person_group', 'booklets'],
  ['loginRows', 'login', 'booklets'], ['bookletRows', 'booklet', 'booklets'],
  ['unitRows', 'unit', 'eligible_units'], ['responseRows', 'variableid', 'responses'],
  ['responseStatusRows', 'status', 'responses'], ['tagRows', 'tag', 'tags'],
  ['sessionBrowserRows', 'browser', 'sessions'], ['sessionOsRows', 'os', 'sessions'],
  ['sessionScreenRows', 'screen', 'sessions'], ['sessionIdRows', 'id', 'sessions'],
  ['processingDurationRows', 'duration', 'derived'], ['unitProgressRows', 'progress', 'derived']
] as const;
type Dimension = typeof dimensions[number][0];

/** Match response existence once per unit; metadata/log facets use booklet grain. */
export async function queryUnfilteredFlatResponseFacets(
  units: SelectQueryBuilder<Unit>, connection: DataSource,
  maxOptions: number, processingDurationThresholdMs: number
): Promise<Record<Dimension, Array<{ v: string }>>> {
  if (!Number.isSafeInteger(maxOptions) || maxOptions < 1) throw new Error('Invalid facet limit');
  const [scope, parameters] = units.clone()
    .select(['unit.id AS id', 'unit.bookletid AS bookletid', 'COALESCE(unit.alias, unit.name) AS unit'])
    // EXISTS chose a heap scan per unit on the full-data copy. The aggregate
    // uses the manual-response covering index, avoiding those cold heap reads.
    .andWhere(`(SELECT COUNT(*) FROM response eligible_response
      WHERE eligible_response.unitid = unit.id AND eligible_response.is_autocoder_generated IS NOT TRUE) > 0`)
    .getQueryAndParameters();
  const threshold = `$${parameters.length + 1}`;
  // Identifiers come exclusively from the fixed tuples above. Values stay bound.
  const sql = `WITH eligible_units AS MATERIALIZED (${scope}),
    booklet_ids AS MATERIALIZED (SELECT DISTINCT bookletid FROM eligible_units),
    booklets AS MATERIALIZED (
      SELECT b.id, p.code, p."group" AS person_group, p.login, bi.name AS booklet
      FROM booklet_ids ids JOIN booklet b ON b.id = ids.bookletid
      JOIN persons p ON p.id = b.personid JOIN bookletinfo bi ON bi.id = b.infoid
    ), responses AS MATERIALIZED (
      SELECT DISTINCT r.variableid, r.status FROM eligible_units u
      JOIN response r ON r.unitid = u.id WHERE r.is_autocoder_generated IS NOT TRUE
    ), tags AS MATERIALIZED (
      SELECT DISTINCT t.tag FROM eligible_units u JOIN unit_tag t ON t."unitId" = u.id
    ), sessions AS MATERIALIZED (
      SELECT s.id, s.browser, s.os, s.screen FROM booklet_ids b
      JOIN session s ON s.bookletid = b.bookletid
    ), derived AS MATERIALIZED (
      SELECT CASE WHEN first_duration.duration_ms IS NULL THEN 'Unbekannt'
        WHEN first_duration.duration_ms < ${threshold} THEN 'Kurz' ELSE 'Lang' END AS duration,
        CASE WHEN EXISTS (SELECT 1 FROM unit pu WHERE pu.bookletid = b.bookletid AND pu.alias IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM unit pu WHERE pu.bookletid = b.bookletid AND pu.alias IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM bookletlog pl WHERE pl.bookletid = b.bookletid
                AND pl.key = 'CURRENT_UNIT_ID' AND pl.parameter = pu.alias)
          ) THEN 'complete' ELSE 'incomplete' END AS progress
      FROM booklet_ids b LEFT JOIN LATERAL (
        SELECT (bt.ts - br.ts) AS duration_ms FROM bookletlog br
        JOIN bookletlog bt ON bt.bookletid = br.bookletid
        WHERE br.bookletid = b.bookletid AND br.key = 'CONTROLLER' AND br.parameter = 'RUNNING'
          AND bt.key = 'CONTROLLER' AND bt.parameter = 'TERMINATED'
        ORDER BY br.id, bt.id LIMIT 1
      ) first_duration ON TRUE
    ) ${dimensions.map(([name, column, table]) => `SELECT '${name}' AS facet,
      ARRAY(SELECT DISTINCT "${column}" FROM ${table} WHERE "${column}" IS NOT NULL
        ORDER BY "${column}" LIMIT ${maxOptions})::text[] AS values`).join(' UNION ALL ')}`;
  const rows = await connection.query<Array<{ facet: Dimension; values: string[] }>>(
    sql, [...parameters, processingDurationThresholdMs]
  );
  return Object.fromEntries(dimensions.map(([name]) => [
    name, (rows.find(row => row.facet === name)?.values || []).map(v => ({ v }))
  ])) as Record<Dimension, Array<{ v: string }>>;
}
