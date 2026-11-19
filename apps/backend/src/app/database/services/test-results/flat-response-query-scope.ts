import { DataSource, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { FlatResponseFilters } from './flat-response-filters';
import { applyExclusionsToQuery } from './test-results.util';

export function isUnfilteredFlatResponseQuery(filters: FlatResponseFilters): boolean {
  return ![
    filters.code, filters.group, filters.login, filters.booklet, filters.unit,
    filters.response, filters.responseStatus, filters.responseValue, filters.tags,
    filters.geogebraOnly, filters.audioLowOnly, filters.hasValueOnly,
    filters.shortProcessingOnly, filters.longLoadingOnly,
    filters.processingDurationMinMs !== null, filters.processingDurationMaxMs !== null,
    filters.processingDurations.length, filters.unitProgress.length,
    filters.sessionBrowsers.length, filters.sessionOs.length, filters.sessionScreens.length,
    filters.sessionIds.length, filters.logAnomalies.length
  ].some(Boolean);
}

export function createFlatResponseUnitScope(
  connection: DataSource, workspaceId: number,
  exclusions: Parameters<typeof applyExclusionsToQuery>[1], queryRunner?: QueryRunner
): SelectQueryBuilder<Unit> {
  const query = connection.getRepository(Unit).createQueryBuilder('unit', queryRunner)
    .innerJoin('unit.booklet', 'bookletEntity')
    .innerJoin('bookletEntity.person', 'person')
    .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
    .where('person.workspace_id = :workspaceId', { workspaceId })
    .andWhere('person.consider = :consider', { consider: true });
  applyExclusionsToQuery(query, exclusions, { bookletInfoAlias: 'bookletinfo' });
  return query;
}

export async function countUnfilteredFlatResponses(
  connection: DataSource, units: SelectQueryBuilder<Unit>,
  queryRunner?: QueryRunner
): Promise<number> {
  const scope = units.clone().select('unit.id', 'id');
  if (queryRunner) {
    // Catalog name resolution alone can see a table installed after the reader's snapshot.
    const [schema] = await connection.query<{ installed: boolean }[]>(
      "SELECT EXISTS (SELECT FROM pg_catalog.pg_class WHERE oid = to_regclass('flat_response_unit_count')) AS installed",
      [],
      queryRunner
    );
    if (schema?.installed) {
      const result = await connection.createQueryBuilder(queryRunner)
        .select('COALESCE(SUM(unit_count.total), 0)', 'cnt')
        .from('flat_response_unit_count', 'unit_count')
        .innerJoin(`(${scope.getQuery()})`, 'scoped_unit', 'scoped_unit.id = unit_count.unitid')
        .setParameters(scope.getParameters())
        .getRawOne<{ cnt: string }>();
      return Number(result?.cnt || 0);
    }
  }
  const result = await connection.createQueryBuilder(queryRunner)
    .addCommonTableExpression(scope, 'flat_response_count_units', { materialized: true })
    .select('COUNT(*)', 'cnt')
    .from(ResponseEntity, 'counted_response')
    .where('counted_response.unitid = ANY(ARRAY(SELECT id FROM flat_response_count_units))')
    .andWhere('counted_response.is_autocoder_generated IS NOT TRUE')
    .getRawOne<{ cnt: string }>();
  return Number(result?.cnt || 0);
}

export type FlatResponsePageUnit = { id: number; sort_rank: number };

export async function findUnfilteredFlatResponsePageUnits(
  connection: DataSource, units: SelectQueryBuilder<Unit>,
  candidateUnits: number, direction: 'ASC' | 'DESC', queryRunner?: QueryRunner
): Promise<FlatResponsePageUnit[]> {
  const [sql, parameters] = units.clone().select('unit.id', 'id')
    .addSelect('person.code', 'sort_code')
    .addSelect('bookletinfo.name', 'sort_booklet')
    .addSelect('unit.alias', 'sort_alias')
    .orderBy('person.code', direction)
    .addOrderBy('bookletinfo.name', direction)
    .addOrderBy('unit.alias', direction)
    .getQueryAndParameters();
  return connection.query<FlatResponsePageUnit[]>(
    `SELECT id, dense_rank() OVER (
      ORDER BY sort_code ${direction}, sort_booklet ${direction}, sort_alias ${direction}
    )::int AS sort_rank
    FROM (${sql} FETCH FIRST $${parameters.length + 1} ROWS WITH TIES) AS page_units`,
    [...parameters, candidateUnits],
    queryRunner
  );
}

export function findUnfilteredFlatResponsePageRows(
  connection: DataSource, projected: SelectQueryBuilder<ResponseEntity>, units: FlatResponsePageUnit[],
  page: { offset: number; limit: number; direction: 'ASC' | 'DESC' }, queryRunner?: QueryRunner
) {
  const { offset, limit, direction } = page;
  const [payloadSql, payloadParameters] = projected.where('response.id = page_id.id').limit(1).getQueryAndParameters();
  const start = payloadParameters.length;
  // Tied unit prefixes share a rank so variable and response IDs order the whole group.
  // A response past the local top N cannot be in the global top N.
  return connection.query(`
    WITH unfiltered_page_ids AS MATERIALIZED (
      SELECT unit_key.sort_rank, candidate.variableid, candidate.id
      FROM unnest($${start + 1}::int[], $${start + 2}::int[]) AS unit_key(id, sort_rank)
      CROSS JOIN LATERAL (
        SELECT response.id, response.variableid
        FROM response
        WHERE response.unitid = unit_key.id AND response.is_autocoder_generated IS NOT TRUE
        ORDER BY response.variableid ${direction}, response.id ${direction}
        LIMIT $${start + 3}
      ) AS candidate
      ORDER BY unit_key.sort_rank, candidate.variableid ${direction}, candidate.id ${direction}
      LIMIT $${start + 4} OFFSET $${start + 5}
    )
    SELECT page_rows.*
    FROM unfiltered_page_ids AS page_id
    CROSS JOIN LATERAL (${payloadSql}) AS page_rows
    ORDER BY page_id.sort_rank, page_id.variableid ${direction}, page_id.id ${direction}
  `, [...payloadParameters, units.map(unit => unit.id), units.map(unit => unit.sort_rank), offset + limit, limit, offset], queryRunner);
}

export async function createIndexedFlatResponseMatches(
  connection: DataSource,
  workspaceId: number,
  filters: FlatResponseFilters,
  queryRunner?: QueryRunner
): Promise<SelectQueryBuilder<ResponseEntity> | undefined> {
  // These predicates need the full response value or status.
  if (!filters.responseValue || filters.responseStatus || filters.audioLowOnly || filters.hasValueOnly) {
    return undefined;
  }

  const [schema] = await connection.query<{ installed: boolean }[]>(
    "SELECT to_regclass('flat_response_value_search_workspace') IS NOT NULL AS installed",
    [],
    queryRunner
  );
  if (!schema?.installed) return undefined;

  const [ready] = await connection.query<{ workspace_id: number }[]>(
    'SELECT workspace_id FROM flat_response_value_search_workspace WHERE workspace_id = $1',
    [workspaceId],
    queryRunner
  );
  if (!ready) return undefined;

  return connection.createQueryBuilder(queryRunner)
    .from<ResponseEntity>('flat_response_value_search_link', 'response')
    .innerJoin(Unit, 'unit', 'unit.id = response.unitid')
    .innerJoin('unit.booklet', 'bookletEntity')
    .innerJoin('bookletEntity.person', 'person')
    .innerJoin('bookletEntity.bookletinfo', 'bookletinfo')
    .where('response.workspace_id = :workspaceId', { workspaceId })
    .andWhere(`response.value_id = ANY(ARRAY(
      SELECT id FROM flat_response_value_search_value
      WHERE workspace_id = :workspaceId AND value_prefix ILIKE :responseValue
    ))`, { responseValue: `%${filters.responseValue}%` });
}

export async function findValueFilteredFlatResponsePage(
  connection: DataSource, filtered: SelectQueryBuilder<ResponseEntity>,
  projected: SelectQueryBuilder<ResponseEntity>, page: { number: number; size: number },
  queryRunner?: QueryRunner
) {
  const matches = filtered.select('response.id', 'id')
    .addSelect('person.code', 'sort_code')
    .addSelect('bookletinfo.name', 'sort_booklet')
    .addSelect('unit.alias', 'sort_alias')
    .addSelect('response.variableid', 'sort_variable');
  const pageRows = projected
    .innerJoin('flat_response_value_page', 'value_page', 'value_page.id = response.id')
    .addSelect('unit.alias', 'sortAlias');

  // Count and page use the same snapshot and search. Fetch payload only for the page IDs.
  const result = await connection.createQueryBuilder(queryRunner)
    .addCommonTableExpression(matches, 'flat_response_value_matches', { materialized: true })
    .addCommonTableExpression(`SELECT id FROM flat_response_value_matches
      ORDER BY sort_code ASC, sort_booklet ASC, sort_alias ASC, sort_variable ASC, id ASC
      LIMIT :flatValuePageSize OFFSET :flatValuePageOffset`, 'flat_response_value_page')
    .select('page_rows.*')
    .addSelect('totals.cnt', 'cnt')
    .from('(SELECT COUNT(*) AS cnt FROM flat_response_value_matches)', 'totals')
    .leftJoin(`(${pageRows.getQuery()})`, 'page_rows', 'TRUE')
    .setParameters({
      ...pageRows.getParameters(),
      flatValuePageSize: page.size,
      flatValuePageOffset: (page.number - 1) * page.size
    })
    .orderBy('page_rows.code', 'ASC')
    .addOrderBy('page_rows.booklet', 'ASC')
    .addOrderBy('page_rows."sortAlias"', 'ASC')
    .addOrderBy('page_rows.response', 'ASC')
    .addOrderBy('page_rows."responseId"', 'ASC')
    .getRawMany();
  return { total: Number(result[0]?.cnt || 0), raw: result.filter(row => row.responseId !== null) };
}
