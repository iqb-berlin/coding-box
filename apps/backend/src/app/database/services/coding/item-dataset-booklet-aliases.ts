import { normalizeItemDatasetUnitId } from '../../../../../../../api-dto/coding/item-dataset-key';
import { normalizeExclusionBookletId } from '../workspace/workspace-exclusion-query.util';
import type { ItemDatasetBookletDesign, ItemDatasetBookletUnitPosition } from './item-dataset-cell-resolver';
import type { RawResponseValueRow } from './item-dataset-response-row';

export interface ImportedBookletUnitAlias {
  bookletName: string;
  unitName: string;
  unitAlias: string;
}

function addCandidate<T>(candidates: Map<string, Set<T>>, key: string, value: T): void {
  const values = candidates.get(key) ?? new Set<T>();
  values.add(value);
  candidates.set(key, values);
}

export function resolveItemDatasetBookletAliases(
  importedUnits: readonly ImportedBookletUnitAlias[],
  canonicalIds: ReadonlySet<string>,
  units: Map<string, ItemDatasetBookletUnitPosition>,
  canIncludeUnit: (unitId: string) => boolean,
  warn: (message: string) => void
): ReadonlySet<string> {
  const namesByAlias = new Map<string, Set<string>>();
  const aliasesByCanonicalId = new Map<string, Set<string>>();

  for (const row of importedUnits) {
    const name = normalizeItemDatasetUnitId(row.unitName);
    const alias = normalizeItemDatasetUnitId(row.unitAlias);
    if (name && alias && name !== alias) addCandidate(namesByAlias, alias, name);
  }

  const ambiguousUnitPositions = new Set<string>();
  for (const [alias, names] of namesByAlias) {
    if (!units.has(alias)) continue;
    if (canonicalIds.has(alias)) {
      if ([...names].some(name => canonicalIds.has(name))) {
        warn(`Alias '${alias}' collides with a canonical unit ID`);
      }
      continue;
    }
    if (names.size > 1) warn(`Alias '${alias}' refers to multiple imported units`);
    for (const unitId of names) {
      if (!canonicalIds.has(unitId) || units.has(unitId) || !canIncludeUnit(unitId)) continue;
      addCandidate(aliasesByCanonicalId, unitId, alias);
      if (names.size > 1) ambiguousUnitPositions.add(unitId);
    }
  }

  for (const [unitId, aliases] of aliasesByCanonicalId) {
    if (aliases.size > 1) {
      warn(`Unit '${unitId}' has multiple positions in the booklet via aliases: ${[...aliases].sort().join(', ')}`);
      ambiguousUnitPositions.add(unitId);
    }
    if (ambiguousUnitPositions.has(unitId)) continue;
    const [alias] = aliases;
    units.set(unitId, { ...units.get(alias)!, unitId });
  }
  return ambiguousUnitPositions;
}

interface LegacyResponseUnit {
  canonicalId: string;
  ambiguous: boolean;
}

export function resolveItemDatasetLegacyResponseUnits(
  responses: readonly RawResponseValueRow[],
  designs: ReadonlyMap<string, ItemDatasetBookletDesign>,
  canonicalIds: ReadonlySet<string>,
  canIncludeUnit: (response: RawResponseValueRow) => boolean,
  warn: (bookletId: number, canonicalId: string) => void
): ReadonlyMap<number, LegacyResponseUnit> {
  const candidatesByBooklet = new Map<number, Map<string, Set<number>>>();
  const visitedUnits = new Set<number>();
  for (const response of responses) {
    const unitId = Number(response.unitId);
    if (visitedUnits.has(unitId)) continue;
    visitedUnits.add(unitId);

    const name = normalizeItemDatasetUnitId(response.unitName);
    const alias = normalizeItemDatasetUnitId(response.unitAlias);
    if (!name || name === alias || !canonicalIds.has(alias)) continue;
    const design = designs.get(normalizeExclusionBookletId(response.bookletName));
    if (!design?.units.has(alias) || !canIncludeUnit(response)) continue;
    if (canonicalIds.has(name) && (design.units.has(name) || design.ambiguousUnitPositions?.has(name))) continue;

    const bookletId = Number(response.bookletId);
    const candidates = candidatesByBooklet.get(bookletId) ?? new Map<string, Set<number>>();
    addCandidate(candidates, alias, unitId);
    candidatesByBooklet.set(bookletId, candidates);
  }

  const result = new Map<number, LegacyResponseUnit>();
  for (const [bookletId, candidates] of candidatesByBooklet) {
    for (const [canonicalId, unitIds] of candidates) {
      const ambiguous = unitIds.size > 1;
      if (ambiguous) warn(bookletId, canonicalId);
      for (const unitId of unitIds) result.set(unitId, { canonicalId, ambiguous });
    }
  }
  return result;
}
