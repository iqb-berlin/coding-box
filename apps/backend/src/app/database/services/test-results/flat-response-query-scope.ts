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

export async function findUnfilteredFlatResponseScope(
  connection: DataSource, units: SelectQueryBuilder<Unit>,
  candidateUnits: number | undefined, queryRunner?: QueryRunner
): Promise<{ total: number; pageUnitIds?: number[] }> {
  const scope = units.clone().select('unit.id', 'id');
  if (candidateUnits !== undefined) {
    scope.addSelect('person.code', 'sort_code')
      .addSelect('bookletinfo.name', 'sort_booklet')
      .addSelect('unit.alias', 'sort_alias');
  }
  const countQuery = connection.createQueryBuilder(queryRunner)
    .addCommonTableExpression(scope, 'flat_response_count_units', { materialized: true })
    .select('COUNT(*)', 'cnt')
    .from(ResponseEntity, 'counted_response')
    .where('counted_response.unitid = ANY(ARRAY(SELECT id FROM flat_response_count_units))')
    .andWhere('counted_response.is_autocoder_generated IS NOT TRUE');
  if (candidateUnits !== undefined) {
    countQuery.addSelect(`ARRAY(SELECT id FROM flat_response_count_units
      ORDER BY sort_code ASC, sort_booklet ASC, sort_alias ASC
      FETCH FIRST :flatResponseCandidateUnits ROWS WITH TIES)`, 'pageUnitIds')
      .setParameter('flatResponseCandidateUnits', candidateUnits);
  }
  const result = await countQuery.getRawOne<{ cnt: string; pageUnitIds?: number[] }>();
  return { total: Number(result?.cnt || 0), pageUnitIds: result?.pageUnitIds };
}

/** Every tied unit must survive: variable/response ordering spans equal prefixes. */
export function withFlatResponsePageUnits(
  query: SelectQueryBuilder<ResponseEntity>, unitIds: number[]
): SelectQueryBuilder<ResponseEntity> {
  return query.clone()
    .andWhere('unit.id = ANY(:flatResponsePageUnitIds::int[])', { flatResponsePageUnitIds: unitIds });
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
