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
  connection: DataSource, units: SelectQueryBuilder<Unit>, queryRunner?: QueryRunner
): Promise<number> {
  const result = await connection.createQueryBuilder(queryRunner)
    .addCommonTableExpression(units.clone().select('unit.id', 'id'), 'flat_response_count_units', { materialized: true })
    .select('COUNT(*)', 'cnt')
    .from(ResponseEntity, 'counted_response')
    .where('counted_response.unitid = ANY(ARRAY(SELECT id FROM flat_response_count_units))')
    .andWhere('counted_response.is_autocoder_generated IS NOT TRUE')
    .getRawOne<{ cnt: string }>();
  return Number(result?.cnt || 0);
}

/** Every tied unit must survive: variable/response ordering spans equal prefixes. */
export function withFlatResponsePageUnits(
  query: SelectQueryBuilder<ResponseEntity>, units: SelectQueryBuilder<Unit>, count: number
): SelectQueryBuilder<ResponseEntity> {
  const prefix = units.clone().select('unit.id', 'id')
    .orderBy('person.code', 'ASC').addOrderBy('bookletinfo.name', 'ASC')
    .addOrderBy('unit.alias', 'ASC');
  return query.clone()
    .addCommonTableExpression(
      `${prefix.getQuery()} FETCH FIRST :flatResponseCandidateUnits ROWS WITH TIES`,
      'flat_response_page_units',
      { materialized: true }
    )
    .setParameters({ ...prefix.getParameters(), flatResponseCandidateUnits: count })
    .andWhere('unit.id IN (SELECT id FROM flat_response_page_units)');
}
