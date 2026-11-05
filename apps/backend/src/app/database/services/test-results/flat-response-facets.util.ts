import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';

const facetGroups = [
  [
    ['codeRows', 'person.code', 'code'],
    ['groupRows', 'person.group', 'person_group'],
    ['loginRows', 'person.login', 'login'],
    ['bookletRows', 'bookletinfo.name', 'booklet']
  ],
  [
    ['unitRows', 'COALESCE(unit.alias, unit.name)', 'unit'],
    ['responseRows', 'response.variableid', 'variable'],
    ['responseStatusRows', 'response.status', 'status'],
    ['tagRows', 'unitTag.tag', 'tag']
  ],
  [
    ['sessionBrowserRows', 'session.browser', 'browser'],
    ['sessionOsRows', 'session.os', 'os'],
    ['sessionScreenRows', 'session.screen', 'screen'],
    ['sessionIdRows', 'session.id', 'id']
  ]
] as const;
type Facet = typeof facetGroups[number][number][0];

/** Three narrow projections avoid twelve joins and a wide, repeatedly scanned CTE. */
export async function queryFlatResponseFacets(
  baseQuery: SelectQueryBuilder<ResponseEntity>, connection: DataSource, maxOptions: number
): Promise<Record<Facet, Array<{ v: string }>>> {
  if (!Number.isSafeInteger(maxOptions) || maxOptions < 1) throw new Error('Invalid facet limit');
  const groups = await Promise.all(facetGroups.map(async group => {
    const query = baseQuery.clone();
    if (group === facetGroups[2]) query.leftJoin('bookletEntity.sessions', 'session');
    const [sql, parameters] = query.select(group.map(([, expression, column]) => `${expression} AS "${column}"`))
      .distinct(true).getQueryAndParameters();
    // All expressions/identifiers are the fixed tuples above; limits are integers.
    const facets = group.map(([name, , column]) => `
      SELECT '${name}' AS facet, ARRAY(SELECT DISTINCT "${column}" FROM filtered
        WHERE "${column}" IS NOT NULL ORDER BY "${column}" LIMIT ${maxOptions})::text[] AS values
    `).join(' UNION ALL ');
    return connection.query<Array<{ facet: Facet; values: string[] }>>(
      `WITH filtered AS MATERIALIZED (${sql}) ${facets}`, parameters
    );
  }));
  const rows = groups.flat();
  return Object.fromEntries(facetGroups.flat().map(([name]) => [
    name, (rows.find(row => row.facet === name)?.values || []).map(v => ({ v }))
  ])) as Record<Facet, Array<{ v: string }>>;
}
