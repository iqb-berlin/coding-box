function collectIdsWithKeyedPaths(
  node,
  path = {},
  collected = [],
  visibility = null,
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
    if ('alwaysVisible' in node && 'sections' in node) {
      currentVisibility = node.alwaysVisible;
    }

    // Only collect if not under a skipped key
    if ('id' in node && !skipCollect) {
      collected.push({
        id: node.alias || node.id,
        markingPanels: node.markingPanels,
        connectedTo: node.connectedTo,
        alwaysVisible: currentVisibility,
        path: { ...path }
      });
    }

    // eslint-disable-next-line guard-for-in
    for (const key in node) {
      const value = node[key];
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

function findDependencies(data) {
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
  definition: string;
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
    const definitionParsed = JSON.parse(unit.definition);

    const data = collectIdsWithKeyedPaths(definitionParsed);
    unit.variable_pages = findDependencies(data);

    delete unit.definition;

    return unit;
  });
};
