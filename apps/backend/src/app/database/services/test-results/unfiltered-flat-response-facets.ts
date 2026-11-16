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

/** Collect response dimensions and eligible units in one pass over the covering index. */
export async function queryUnfilteredFlatResponseFacets(
  units: SelectQueryBuilder<Unit>, connection: DataSource,
  maxOptions: number, processingDurationThresholdMs: number
): Promise<Record<Dimension, Array<{ v: string }>>> {
  if (!Number.isSafeInteger(maxOptions) || maxOptions < 1) throw new Error('Invalid facet limit');
  const [scope, parameters] = units.clone()
    .select(['unit.id AS id', 'unit.bookletid AS bookletid', 'COALESCE(unit.alias, unit.name) AS unit'])
    .getQueryAndParameters();
  const threshold = `$${parameters.length + 1}`;
  // Identifiers come exclusively from the fixed tuples above. Values stay bound.
  const sql = `WITH scoped_units AS MATERIALIZED (${scope}),
    response_facets AS MATERIALIZED (
      SELECT r.unitid, r.variableid, r.status, GROUPING(r.unitid) = 0 AS is_unit
      FROM response r
      WHERE r.unitid = ANY(ARRAY(SELECT id FROM scoped_units))
        AND r.is_autocoder_generated IS NOT TRUE
      GROUP BY GROUPING SETS ((r.unitid), (r.variableid), (r.status))
    ), eligible_units AS MATERIALIZED (
      SELECT u.* FROM scoped_units u JOIN response_facets f ON f.is_unit AND f.unitid = u.id
    ),
    booklet_ids AS MATERIALIZED (SELECT DISTINCT bookletid FROM eligible_units),
    booklets AS MATERIALIZED (
      SELECT b.id, p.code, p."group" AS person_group, p.login, bi.name AS booklet
      FROM booklet_ids ids JOIN booklet b ON b.id = ids.bookletid
      JOIN persons p ON p.id = b.personid JOIN bookletinfo bi ON bi.id = b.infoid
    ), responses AS MATERIALIZED (
      SELECT variableid, status FROM response_facets WHERE NOT is_unit
    ), tags AS MATERIALIZED (
      SELECT DISTINCT t.tag FROM eligible_units u JOIN unit_tag t ON t."unitId" = u.id
    ), sessions AS MATERIALIZED (
      SELECT s.id, s.browser, s.os, s.screen FROM booklet_ids b
      JOIN session s ON s.bookletid = b.bookletid
    ), derived AS MATERIALIZED (
      SELECT CASE WHEN first_end.ts IS NULL OR first_start.ts IS NULL THEN 'Unbekannt'
        WHEN first_end.ts - first_start.ts < ${threshold} THEN 'Kurz' ELSE 'Lang' END AS duration,
        CASE WHEN progress.complete THEN 'complete' ELSE 'incomplete' END AS progress
      FROM booklet_ids b LEFT JOIN LATERAL (
        SELECT ts FROM bookletlog
        WHERE bookletid = b.bookletid AND key = 'CONTROLLER' AND parameter = 'RUNNING'
        ORDER BY id LIMIT 1
      ) first_start ON TRUE
      LEFT JOIN LATERAL (
        SELECT ts FROM bookletlog
        WHERE bookletid = b.bookletid AND key = 'CONTROLLER' AND parameter = 'TERMINATED'
        ORDER BY id LIMIT 1
      ) first_end ON TRUE
      -- Compare the complete set of aliases once per booklet. NULL yields incomplete.
      CROSS JOIN LATERAL (
        SELECT (SELECT array_agg(pu.alias::text) FROM unit pu
                WHERE pu.bookletid = b.bookletid AND pu.alias IS NOT NULL) <@
               (SELECT array_agg(pl.parameter) FROM bookletlog pl
                WHERE pl.bookletid = b.bookletid AND pl.key = 'CURRENT_UNIT_ID' AND pl.parameter IS NOT NULL)
          AS complete
      ) progress
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
