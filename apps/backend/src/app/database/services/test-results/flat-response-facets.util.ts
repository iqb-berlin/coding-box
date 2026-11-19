import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';

const tagFacets = [['tagRows', 'facet_tag.tag', 'tag']] as const;
const sessionFacets = [
  ['sessionBrowserRows', 'facet_session.browser', 'browser'],
  ['sessionOsRows', 'facet_session.os', 'os'],
  ['sessionScreenRows', 'facet_session.screen', 'screen'],
  ['sessionIdRows', 'facet_session.id', 'id']
] as const;

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
    ['responseStatusRows', 'response.status', 'status']
  ],
  sessionFacets,
  tagFacets
] as const;
type FacetGroup = typeof facetGroups[number];
type Facet = FacetGroup[number][0];

/** Do not release a shared computation while its other SQL queries are still running. */
export async function settleFacetQueries<T>(queries: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(queries);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
}

function selectFacetGroup(
  query: SelectQueryBuilder<ResponseEntity>, group: FacetGroup, tags: string
): [string, unknown[]] {
  const projection = group.map(([, expression, column]) => `${expression} AS "${column}"`);
  if (group === sessionFacets) {
    const [booklets, parameters] = query.select('bookletEntity.id', 'id').distinct(true).getQueryAndParameters();
    return [`SELECT ${projection.join(', ')} FROM (${booklets}) matched
      JOIN session facet_session ON facet_session.bookletid = matched.id`, parameters];
  }
  if (group === tagFacets) {
    const [units, parameters] = query.select('unit.id', 'id').distinct(true).getQueryAndParameters();
    const tagFilter = tags ? `WHERE facet_tag.tag ILIKE $${parameters.length + 1}` : '';
    return [`SELECT DISTINCT ${projection.join(', ')} FROM (${units}) matched
      JOIN unit_tag facet_tag ON facet_tag."unitId" = matched.id ${tagFilter}`,
    tags ? [...parameters, `%${tags}%`] : parameters];
  }
  return query.select(projection).distinct(true).getQueryAndParameters();
}

/** Join sessions and tags after deduplicating their booklets and units. */
export async function queryFlatResponseFacets(
  baseQuery: SelectQueryBuilder<ResponseEntity>, connection: DataSource, maxOptions: number, tags = ''
): Promise<Record<Facet, Array<{ v: string }>>> {
  if (!Number.isSafeInteger(maxOptions) || maxOptions < 1) throw new Error('Invalid facet limit');
  const groups = await settleFacetQueries(facetGroups.map(async group => {
    const [sql, parameters] = selectFacetGroup(baseQuery.clone(), group, tags);
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
