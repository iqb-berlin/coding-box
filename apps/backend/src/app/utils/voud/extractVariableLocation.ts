function collectIdsWithKeyedPaths(
  node,
  path = {},
  collected = [],
  visibility = null,
  skipCollect = false
) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      collectIdsWithKeyedPaths(child, path, collected, visibility, skipCollect);
    });
    return collected;
  }

  if (typeof node === 'object' && node !== null) {
    // If at a 'page' level object, update visibility
    if ('alwaysVisible' in node && 'sections' in node) {
      visibility = node.alwaysVisible;
    }

    // Only collect if not under a skipped key
    if ('id' in node && !skipCollect) {
      collected.push({
        id: node.id,
        markingPanels: node.markingPanels,
        connectedTo: node.connectedTo,
        alwaysVisible: visibility,
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
            visibility,
            shouldSkip
          );
        });
      } else if (typeof value === 'object' && value !== null) {
        const newPath = { ...path, [key]: 0 }; // object branch, no index
        collectIdsWithKeyedPaths(
          value,
          newPath,
          collected,
          visibility,
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

export const extractVariableLocation = function (definitions:{ definition: string }[]): any {
  return definitions.map((unit:any) => {
    const definitionParsed = JSON.parse(unit.definition);

    const data = collectIdsWithKeyedPaths(definitionParsed);
    unit.variable_pages = findDependencies(data);

    delete unit.definition;

    return unit;
  });
};
