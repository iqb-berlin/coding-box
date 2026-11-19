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

interface FlatResponsePage {
  number: number;
  size: number;
}

function selectFlatResponsePageIds(query: SelectQueryBuilder<ResponseEntity>, page: FlatResponsePage) {
  return query.select('response.id', 'id')
    .orderBy('person.code', 'ASC')
    .addOrderBy('bookletinfo.name', 'ASC')
    .addOrderBy('unit.alias', 'ASC')
    .addOrderBy('response.variableid', 'ASC')
    .addOrderBy('response.id', 'ASC')
    .offset((page.number - 1) * page.size)
    .limit(page.size);
}

export async function findUnfilteredFlatResponsePage(
  connection: DataSource, units: SelectQueryBuilder<Unit>, filtered: SelectQueryBuilder<ResponseEntity>,
  projected: SelectQueryBuilder<ResponseEntity>, page: FlatResponsePage, queryRunner?: QueryRunner
) {
  const candidates = units.clone().select('unit.id', 'id')
    .addSelect('person.code', 'sort_code')
    .addSelect('bookletinfo.name', 'sort_booklet')
    .addSelect('unit.alias', 'sort_alias');
  // Keep tied units: variable/response ordering spans equal prefixes.
  const candidatePage = selectFlatResponsePageIds(filtered.clone(), page)
    .andWhere(`unit.id IN (SELECT id FROM flat_response_candidate_units
      ORDER BY sort_code ASC, sort_booklet ASC, sort_alias ASC
      FETCH FIRST :flatResponseCandidateUnits ROWS WITH TIES)`);
  const fallbackPage = selectFlatResponsePageIds(filtered, page)
    .andWhere('(SELECT needed FROM flat_response_needs_fallback)');
  const totals = connection.createQueryBuilder(queryRunner)
    .select('COUNT(*)', 'cnt')
    .from(ResponseEntity, 'counted_response')
    .where('counted_response.unitid = ANY(ARRAY(SELECT id FROM flat_response_count_units))')
    .andWhere('counted_response.is_autocoder_generated IS NOT TRUE');

  // Evaluate the prefix and the fallback condition in the count's snapshot.
  // The uncorrelated condition skips the full scan when the prefix supplies the page.
  const result = await selectFlatResponsePageResult(connection, projected, queryRunner)
    .addCommonTableExpression(units.select('unit.id', 'id'), 'flat_response_count_units', { materialized: true })
    .addCommonTableExpression(totals, 'flat_response_totals', { materialized: true })
    .addCommonTableExpression(candidates, 'flat_response_candidate_units')
    .addCommonTableExpression(candidatePage, 'flat_response_candidate_page', { materialized: true })
    .addCommonTableExpression(`SELECT (SELECT COUNT(*) FROM flat_response_candidate_page)
        < LEAST(:flatResponsePageSize, GREATEST(0, cnt - :flatResponsePageOffset)) AS needed
      FROM flat_response_totals`, 'flat_response_needs_fallback', { materialized: true })
    .addCommonTableExpression(fallbackPage, 'flat_response_fallback_page')
    .addCommonTableExpression(`SELECT id FROM flat_response_candidate_page
      WHERE NOT (SELECT needed FROM flat_response_needs_fallback)
      UNION ALL SELECT id FROM flat_response_fallback_page`, 'flat_response_page')
    .setParameters({
      flatResponseCandidateUnits: page.number * page.size,
      flatResponsePageSize: page.size,
      flatResponsePageOffset: (page.number - 1) * page.size
    })
    .getRawMany();
  return unpackFlatResponsePage(result);
}

export async function findValueFilteredFlatResponsePage(
  connection: DataSource, filtered: SelectQueryBuilder<ResponseEntity>,
  projected: SelectQueryBuilder<ResponseEntity>, page: FlatResponsePage, queryRunner?: QueryRunner
) {
  const matches = filtered.select('response.id', 'id')
    .addSelect('person.code', 'sort_code')
    .addSelect('bookletinfo.name', 'sort_booklet')
    .addSelect('unit.alias', 'sort_alias')
    .addSelect('response.variableid', 'sort_variable');

  // Count and page use the same snapshot and search. Fetch payload only for the page IDs.
  const result = await selectFlatResponsePageResult(connection, projected, queryRunner)
    .addCommonTableExpression(matches, 'flat_response_value_matches', { materialized: true })
    .addCommonTableExpression('SELECT COUNT(*) AS cnt FROM flat_response_value_matches', 'flat_response_totals')
    .addCommonTableExpression(`SELECT id FROM flat_response_value_matches
      ORDER BY sort_code ASC, sort_booklet ASC, sort_alias ASC, sort_variable ASC, id ASC
      LIMIT :flatValuePageSize OFFSET :flatValuePageOffset`, 'flat_response_page')
    .setParameters({
      flatValuePageSize: page.size,
      flatValuePageOffset: (page.number - 1) * page.size
    })
    .getRawMany();
  return unpackFlatResponsePage(result);
}

function selectFlatResponsePageResult(
  connection: DataSource, projected: SelectQueryBuilder<ResponseEntity>, queryRunner?: QueryRunner
) {
  const pageRows = projected
    .innerJoin('flat_response_page', 'page', 'page.id = response.id')
    .addSelect('unit.alias', 'sortAlias');
  return connection.createQueryBuilder(queryRunner)
    .select('page_rows.*')
    .addSelect('totals.cnt', 'cnt')
    .from('flat_response_totals', 'totals')
    .leftJoin(`(${pageRows.getQuery()})`, 'page_rows', 'TRUE')
    .setParameters(pageRows.getParameters())
    .orderBy('page_rows.code', 'ASC')
    .addOrderBy('page_rows.booklet', 'ASC')
    .addOrderBy('page_rows."sortAlias"', 'ASC')
    .addOrderBy('page_rows.response', 'ASC')
    .addOrderBy('page_rows."responseId"', 'ASC');
}

function unpackFlatResponsePage<T extends { responseId: number | null; cnt: string }>(result: T[]) {
  return { total: Number(result[0]?.cnt || 0), raw: result.filter(row => row.responseId !== null) };
}
