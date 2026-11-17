import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { ResetCodingScope } from '../../../../../../../api-dto/coding/reset-coding-preview.dto';

export function codingResetVersions(version: ResetCodingScope['version']): ResetCodingScope['version'][] {
  if (version === 'v1') return ['v1', 'v2', 'v3'];
  return version === 'v2' ? ['v2', 'v3'] : ['v3'];
}

export function codingFieldsEmpty(versions: ResetCodingScope['version'][]): string {
  return versions.flatMap(version => ['status', 'code', 'score'].map(field => `response.${field}_${version} IS NULL`)).join(' AND ') || 'TRUE';
}

export function codingResetConditions(version: ResetCodingScope['version']): string[] {
  const conditions = [`(${codingResetVersions(version).flatMap(v => ['status', 'code', 'score'].map(
    field => `response.${field}_${v} IS NOT NULL`
  )).join(' OR ')})`];
  if (version === 'v2') conditions.push('(response.code_v2 IS NULL OR response.code_v2 != -111)');
  return conditions;
}

export function codingResetScopeQuery(repository: Repository<ResponseEntity>, workspaceId: number,
  unitFilters?: string[], variableFilters?: string[]) {
  const query = repository.createQueryBuilder('response')
    .leftJoin('response.unit', 'unit')
    .leftJoin('unit.booklet', 'booklet')
    .leftJoin('booklet.person', 'person')
    .where('person.workspace_id = :workspaceId', { workspaceId })
    .andWhere('person.consider = :consider', { consider: true })
    // Match reset/statistics eligibility: NOT_REACHED, DISPLAYED, VALUE_CHANGED.
    .andWhere('response.status IN (:...codedStatuses)', { codedStatuses: [1, 2, 3] });
  if (unitFilters?.length) query.andWhere('unit.name IN (:...unitNames)', { unitNames: unitFilters });
  if (variableFilters?.length) query.andWhere('response.variableid IN (:...variableIds)', { variableIds: variableFilters });
  return query;
}

/** Predict cleanup after the selected fields have been cleared, without changing any data. */
export function codingResetCleanupCondition(version: ResetCodingScope['version']): string {
  const survivingVersions = (['v1', 'v2', 'v3'] as const).filter(v => !codingResetVersions(version).includes(v));
  const target = codingResetConditions(version).join(' AND ');
  return `(response.is_autocoder_generated = TRUE AND ${codingFieldsEmpty(survivingVersions)} AND ` +
    `((${target}) OR (${codingFieldsEmpty(['v1', 'v2', 'v3'])})))`;
}
