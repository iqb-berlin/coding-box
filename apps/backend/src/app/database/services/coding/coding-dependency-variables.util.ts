import { splitManualCodingScopeKey } from '../../utils/manual-coding-scope.util';

/** Sources and targets needed to evaluate the existing coding dependencies. */
export function getCodingDependencyVariables(
  derivedVariablesBySource: Map<string, Set<string>>
): Map<string, Set<string>> {
  const dependencies = new Map<string, Set<string>>();
  derivedVariablesBySource.forEach((targets, key) => {
    const { unitName, variableId } = splitManualCodingScopeKey(key);
    if (!unitName || !variableId || targets.size === 0) return;
    const variables = dependencies.get(unitName.toUpperCase()) || new Set<string>();
    variables.add(variableId);
    targets.forEach(target => variables.add(target));
    dependencies.set(unitName.toUpperCase(), variables);
  });
  return dependencies;
}

export function mergeCodingVariableMaps(
  ...maps: Map<string, Set<string>>[]
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  maps.forEach(map => map.forEach((variables, unitName) => {
    const key = unitName.toUpperCase();
    const result = merged.get(key) || new Set<string>();
    variables.forEach(variable => result.add(variable));
    merged.set(key, result);
  }));
  return merged;
}

/** A base source is referenced by a derivation but is not itself a derived target. */
export function getBaseCodingSourceKeys(
  derivedVariablesBySource: Map<string, Set<string>>
): string[] {
  const targets = new Set<string>();
  derivedVariablesBySource.forEach((aliases, key) => {
    const { unitName } = splitManualCodingScopeKey(key);
    aliases.forEach(alias => targets.add(`${unitName}\u001f${alias}`.toUpperCase()));
  });
  return Array.from(derivedVariablesBySource.entries())
    .filter(([key, aliases]) => aliases.size > 0 && !targets.has(key.toUpperCase()))
    .map(([key]) => key.toUpperCase());
}
