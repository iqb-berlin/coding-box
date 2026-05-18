type JsonObject = Record<string, unknown>;

function removeControlChars(value: string): string {
  let cleanedValue = '';

  for (const character of value) {
    const charCode = character.charCodeAt(0);
    if ((charCode > 0x1F && charCode < 0x7F) || charCode > 0x9F) {
      cleanedValue += character;
    }
  }

  return cleanedValue;
}

function parseDefinition(definition: string): unknown {
  try {
    return JSON.parse(definition);
  } catch (_error) {
    return JSON.parse(removeControlChars(definition));
  }
}

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ?
    value as JsonObject :
    null;
}

function isPageAlwaysVisible(page: unknown): boolean {
  const value = asJsonObject(page)?.alwaysVisible;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function getDeepestElements(
  node: unknown,
  label: string,
  excludedParents: string[] = []
): unknown[] {
  if (typeof node !== 'object' || node === null) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(item => getDeepestElements(item, label, excludedParents));
  }

  const objectNode = node as JsonObject;
  const collectedElements = Object.prototype.hasOwnProperty.call(objectNode, label) ?
    [objectNode[label]] :
    [];

  return Object.entries(objectNode).reduce<unknown[]>(
    (accumulator, [nodeName, value]) => {
      if (excludedParents.includes(nodeName)) {
        return accumulator;
      }
      accumulator.push(...getDeepestElements(value, label, excludedParents));
      return accumulator;
    },
    collectedElements
  );
}

function listSimplify(values: unknown[]): string[] {
  return values
    .flat(Infinity)
    .filter((item): item is string | number => (
      typeof item === 'string' || typeof item === 'number'
    ))
    .map(String);
}

function getPageVariableRefs(page: unknown): string[] {
  const aliases = listSimplify(getDeepestElements(page, 'alias', ['visibilityRules']));
  const ids = listSimplify(getDeepestElements(page, 'id', ['visibilityRules']));

  return Array.from(
    new Set(
      [...aliases, ...ids]
        .map(value => String(value || '').trim())
        .filter(value => value.length > 0)
    )
  );
}

export function resolveVariablePageMap(definition: string): Map<string, string> {
  const unitDefinition = asJsonObject(parseDefinition(definition));
  const pages = unitDefinition && Array.isArray(unitDefinition.pages) ?
    unitDefinition.pages :
    [];
  const variablePageMap = new Map<string, string>();
  let scrollPageIndex = 0;

  for (const page of pages) {
    const isAlwaysVisible = isPageAlwaysVisible(page);

    if (!isAlwaysVisible) {
      const pageIndex = String(scrollPageIndex);
      getPageVariableRefs(page).forEach(variableRef => {
        if (!variablePageMap.has(variableRef)) {
          variablePageMap.set(variableRef, pageIndex);
        }
      });
      scrollPageIndex += 1;
    }
  }

  return variablePageMap;
}
