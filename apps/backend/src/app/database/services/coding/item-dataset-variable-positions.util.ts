import type { VariableCodingData } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import { ItemDatasetResponseKey } from '../../../../../../../api-dto/coding/item-dataset-key';
import { extractVariableLocation } from '../../../utils/voud/extractVariableLocation';
import { resolveVariablePageMap } from '../../../utils/voud/resolveVariablePageMap';

interface VariablePosition {
  id: string;
  alias?: string;
  page?: number;
  section?: number;
  sources: string[];
}

export const compareItemDatasetVariableNames = (left: string, right: string): number => (
  left.localeCompare(right, 'en', { numeric: true }) ||
  left.localeCompare(right, 'en')
);

const numericPosition = (value: unknown): number | undefined => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** Static positions for MNR classification, independent of item and response order. */
export function buildItemDatasetVariablePositions(
  unitName: string,
  mappedVariables: Array<{ id: string; alias: string }>,
  definition?: string,
  codingScheme?: string
): Map<string, number> {
  const variables = new Map<string, VariablePosition>();
  const scheme = codingScheme ? JSON.parse(codingScheme) as {
    variableCodings?: VariableCodingData[];
  } : undefined;
  const codings = Array.isArray(scheme?.variableCodings) ? scheme.variableCodings : [];
  for (const coding of codings) {
    if (!coding.id) continue;
    variables.set(coding.id, {
      id: coding.id,
      alias: coding.alias || coding.id,
      sources: coding.sourceType === 'BASE' || coding.sourceType === 'BASE_NO_VALUE' ?
        [] : coding.deriveSources || []
    });
  }
  for (const variable of mappedVariables) {
    if (!variables.has(variable.id)) {
      variables.set(variable.id, { ...variable, sources: [] });
    }
  }
  const aliases = new Map<string, string | null>();
  for (const variable of variables.values()) {
    const alias = variable.alias || variable.id;
    aliases.set(alias, aliases.has(alias) ? null : variable.id);
  }
  const resolve = (reference: string): string | undefined => (
    variables.has(reference) ? reference : aliases.get(reference) || undefined
  );
  if (definition) {
    const pages = resolveVariablePageMap(definition);
    const [locations] = extractVariableLocation([{ definition }]);
    for (const location of locations.variable_pages || []) {
      if (location.variable_page_always_visible === true) continue;
      const id = aliases.get(location.variable_ref) || resolve(location.variable_ref) || location.variable_ref;
      const variable = variables.get(id) || { id, sources: [] };
      // Use the same scroll-page numbering as the versioned result export.
      const page = numericPosition(pages.get(location.variable_ref));
      if (variable.page === undefined && page !== undefined) {
        variable.page = page;
        variable.section = numericPosition(location.variable_path.sections);
      }
      variables.set(id, variable);
    }
  }
  for (const coding of codings) {
    const page = numericPosition(coding.page);
    const variable = variables.get(coding.id);
    if (variable && page !== undefined && page >= 0 && Number.isInteger(page)) {
      const override = Math.max(0, page - 1);
      if (variable.page !== override) variable.section = undefined;
      variable.page = override;
    }
  }

  const ordered = [...variables.values()].sort((left, right) => (
    (left.page ?? Infinity) - (right.page ?? Infinity) ||
    (left.page === undefined ? 0 : (left.section ?? Infinity) - (right.section ?? Infinity)) ||
    compareItemDatasetVariableNames(left.alias || left.id, right.alias || right.id)
  ));
  const sources = new Map<string, string[]>();
  const dependants = new Map<string, string[]>();
  for (const variable of ordered) {
    const resolved = variable.sources.map(resolve);
    const links = resolved.every((source): source is string => source !== undefined) ?
      [...new Set(resolved)] : [];
    sources.set(variable.id, links);
    for (const source of links) {
      dependants.set(source, [...dependants.get(source) || [], variable.id]);
    }
  }
  // Detect cycles and blocked descendants before ordering. Those variables use
  // their own layout/name position, just like unresolved source references.
  const pending = new Map([...sources].map(([id, links]) => [id, links.length]));
  const queue = ordered.filter(variable => !pending.get(variable.id)).map(variable => variable.id);
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of dependants.get(queue[index]) || []) {
      const remaining = pending.get(child)! - 1;
      pending.set(child, remaining);
      if (!remaining) queue.push(child);
    }
  }
  for (const [id, remaining] of pending) {
    if (remaining) sources.set(id, []);
  }
  dependants.clear();
  for (const [id, links] of sources) {
    pending.set(id, links.length);
    for (const source of links) {
      dependants.set(source, [...dependants.get(source) || [], id]);
    }
  }
  const stack = ordered.filter(variable => !pending.get(variable.id)).map(variable => variable.id).reverse();
  const positions = new Map<string, number>();
  while (stack.length) {
    const id = stack.pop()!;
    positions.set(id, positions.size + 1);
    const ready: string[] = [];
    for (const child of dependants.get(id) || []) {
      const remaining = pending.get(child)! - 1;
      pending.set(child, remaining);
      if (!remaining) ready.push(child);
    }
    ready.sort((left, right) => compareItemDatasetVariableNames(
      variables.get(right)!.alias || right,
      variables.get(left)!.alias || left
    ));
    stack.push(...ready);
  }
  const result = new Map<string, number>();
  for (const [id, position] of positions) {
    result.set(ItemDatasetResponseKey.from(unitName, id).toString(), position);
  }
  for (const variable of variables.values()) {
    if (variable.alias && aliases.get(variable.alias) === variable.id) {
      result.set(ItemDatasetResponseKey.from(unitName, variable.alias).toString(), positions.get(variable.id)!);
    }
  }
  return result;
}
