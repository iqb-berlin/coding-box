import { DataSource, SelectQueryBuilder } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { FlatResponseOptions } from './workspace-test-results.types';
import { normalizeFlatResponseFilters } from './flat-response-filters';
import { createFlatResponseUnitScope, isUnfilteredFlatResponseQuery } from './flat-response-query-scope';
import { queryUnfilteredFlatResponseFacets } from './unfiltered-flat-response-facets';
import { queryFlatResponseFacets } from './flat-response-facets.util';
import { queryFilteredFlatResponseBookletFacets } from './flat-response-booklet-facets';
import { applyExclusionsToQuery } from './test-results.util';

export async function queryFlatResponseOptionRows(
  base: SelectQueryBuilder<ResponseEntity>, connection: DataSource, workspaceId: number,
  exclusions: Parameters<typeof applyExclusionsToQuery>[1], options: Partial<FlatResponseOptions>,
  maxOptions: number, threshold: number
) {
  if (isUnfilteredFlatResponseQuery(normalizeFlatResponseFilters({ page: 1, limit: 1, ...options }))) {
    return queryUnfilteredFlatResponseFacets(
      createFlatResponseUnitScope(connection, workspaceId, exclusions), connection, maxOptions, threshold
    );
  }
  const facets = await queryFlatResponseFacets(base, connection, maxOptions);
  const [processingDurationRows, unitProgressRows] = await queryFilteredFlatResponseBookletFacets(
    connection, base, maxOptions, threshold
  );
  return { ...facets, processingDurationRows, unitProgressRows };
}
