interface CollectedVariable {
  id: string;
  markingPanels?: string[];
  connectedTo?: string[];
  alwaysVisible: boolean | null;
  path: Record<string, number>;
}

function stringReferences(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

function collectIdsWithKeyedPaths(
  node: unknown,
  path: Record<string, number> = {},
  collected: CollectedVariable[] = [],
  visibility: boolean | null = null,
  skipCollect = false
) {
  if (Array.isArray(node)) {
    node.forEach(child => {
      collectIdsWithKeyedPaths(child, path, collected, visibility, skipCollect);
    });
    return collected;
  }

  if (typeof node === 'object' && node !== null) {
    // If at a 'page' level object, update visibility
    let currentVisibility = visibility;
    if ('alwaysVisible' in node && 'sections' in node && typeof node.alwaysVisible === 'boolean') {
      currentVisibility = node.alwaysVisible;
    }

    // Only collect if not under a skipped key
    if ('id' in node && !skipCollect) {
      const id = ('alias' in node && node.alias) || node.id;
      if (typeof id === 'string') {
        collected.push({
          id,
          markingPanels: stringReferences('markingPanels' in node ? node.markingPanels : undefined),
          connectedTo: stringReferences('connectedTo' in node ? node.connectedTo : undefined),
          alwaysVisible: currentVisibility,
          path: { ...path }
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      const shouldSkip =
        skipCollect || ['value', 'visibilityRules'].includes(key);

      if (Array.isArray(value)) {
        value.forEach((child, index) => {
          const newPath = { ...path, [key]: index };
          collectIdsWithKeyedPaths(
            child,
            newPath,
            collected,
            currentVisibility,
            shouldSkip
          );
        });
      } else if (typeof value === 'object' && value !== null) {
        const newPath = { ...path, [key]: 0 }; // object branch, no index
        collectIdsWithKeyedPaths(
          value,
          newPath,
          collected,
          currentVisibility,
          shouldSkip
        );
      }
    }
  }

  return collected;
}

function findDependencies(data: CollectedVariable[]): VariablePage[] {
  return data.map((currentObj, _, arr) => {
    const connectedIds =
      currentObj.connectedTo || currentObj.markingPanels || [];

    const dependencies = connectedIds.flatMap(depId => arr
      .filter(({ id }) => id === depId)
      .map(match => ({
        variable_dependency_ref: match.id,
        variable_dependency_path: match.path,
        variable_dependency_page_always_visible: match.alwaysVisible
      })));

    return {
      variable_ref: currentObj.id,
      variable_path: currentObj.path,
      variable_page_always_visible: currentObj.alwaysVisible,
      variable_dependencies: dependencies
    };
  });
}

interface UnitWithDefinition {
  definition?: string;
  variable_pages?: VariablePage[];
  [key: string]: unknown;
}

interface VariablePage {
  variable_ref: string;
  variable_path: Record<string, number>;
  variable_page_always_visible: boolean | null;
  variable_dependencies: VariableDependency[];
}

interface VariableDependency {
  variable_dependency_ref: string;
  variable_dependency_path: Record<string, number>;
  variable_dependency_page_always_visible: boolean | null;
}

export const extractVariableLocation = function extractVariableLocations(definitions: UnitWithDefinition[]): UnitWithDefinition[] {
  return definitions.map((unit: UnitWithDefinition) => {
    if (typeof unit.definition !== 'string') throw new TypeError('Unit definition must be a JSON string');
    const definitionParsed: unknown = JSON.parse(unit.definition);

    const data = collectIdsWithKeyedPaths(definitionParsed);
    unit.variable_pages = findDependencies(data);

    delete unit.definition;

    return unit;
  });
};
