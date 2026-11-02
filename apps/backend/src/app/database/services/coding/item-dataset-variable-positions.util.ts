import type { VariableCodingData } from '@iqbspecs/coding-scheme/coding-scheme.interface';
import { ItemDatasetResponseKey } from '../../../../../../../api-dto/coding/item-dataset-key';
import { extractVariableLocation } from '../../../utils/voud/extractVariableLocation';
import { resolveVariablePageMap } from '../../../utils/voud/resolveVariablePageMap';
import {
  codingSchemePageIndex, parseCodingSchemeVariables, parseVariablePage
} from '../../../utils/voud/coding-scheme-metadata.util';

interface MappedVariable {
  id: string;
  alias?: string;
  page?: string;
}

interface VariablePosition {
  id: string;
  alias?: string;
  aliases: Set<string>;
  page?: number;
  section?: number;
  sources: string[];
}

export interface ItemDatasetVariableOrderDiagnostic {
  variableId: string;
  reason: 'missing-page' | 'unresolved-source' | 'cyclic-source';
}

export interface ItemDatasetVariableOrder {
  positions: Map<string, number>;
  diagnostics: ItemDatasetVariableOrderDiagnostic[];
}

export const compareItemDatasetVariableNames = (left: string, right: string): number => (
  left.localeCompare(right, 'en', { numeric: true }) || left.localeCompare(right, 'en')
);

function collectVariables(mapped: MappedVariable[], codings: VariableCodingData[]): Map<string, VariablePosition> {
  const variables = new Map<string, VariablePosition>();
  for (const coding of codings) {
    if (!coding.id) continue;
    variables.set(coding.id, {
      id: coding.id,
      alias: coding.alias || coding.id,
      aliases: new Set(coding.alias ? [coding.alias] : []),
      sources: coding.sourceType === 'BASE' || coding.sourceType === 'BASE_NO_VALUE' ? [] : coding.deriveSources || []
    });
  }
  for (const variable of mapped) {
    const existing = variables.get(variable.id) || { id: variable.id, aliases: new Set<string>(), sources: [] };
    existing.alias = variable.alias || existing.alias;
    if (variable.alias) existing.aliases.add(variable.alias);
    variables.set(variable.id, existing);
  }
  return variables;
}

function collectAliases(variables: Map<string, VariablePosition>): Map<string, string | null> {
  const aliases = new Map<string, string | null>();
  for (const variable of variables.values()) {
    for (const alias of variable.aliases.size ? variable.aliases : [variable.id]) {
      const existing = aliases.get(alias);
      aliases.set(alias, existing === undefined || existing === variable.id ? variable.id : null);
    }
  }
  return aliases;
}

function assignPages(
  variables: Map<string, VariablePosition>,
  aliases: Map<string, string | null>,
  mapped: MappedVariable[],
  codings: VariableCodingData[],
  definition?: string
): void {
  if (definition) {
    try {
      const pages = resolveVariablePageMap(definition);
      const [locations] = extractVariableLocation([{ definition }]);
      for (const location of locations.variable_pages || []) {
        if (location.variable_page_always_visible === true) continue;
        // Layouts use public aliases; derivation sources below use internal IDs first.
        const id = aliases.get(location.variable_ref) || location.variable_ref;
        const variable = variables.get(id) || { id, aliases: new Set<string>(), sources: [] };
        const page = parseVariablePage(pages.get(location.variable_ref));
        if (variable.page === undefined && page !== undefined) {
          variable.page = page;
          variable.section = parseVariablePage(location.variable_path.sections);
        }
        variables.set(id, variable);
      }
    } catch (error) {
      // Non-JSON players rely on Unit/VOCS pages; missing pages are diagnosed below.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  // Priority: explicit VOCS override > Aspect layout > Unit page > natural name.
  for (const entry of mapped) {
    const variable = variables.get(entry.id)!;
    variable.page ??= parseVariablePage(entry.page);
  }
  for (const coding of codings) {
    const variable = variables.get(coding.id);
    const page = codingSchemePageIndex(coding.page);
    if (variable && page !== undefined) {
      if (variable.page !== page) variable.section = undefined;
      variable.page = page;
    }
  }
}

function resolveSources(
  variables: VariablePosition[],
  aliases: Map<string, string | null>,
  diagnostics: ItemDatasetVariableOrderDiagnostic[]
): Map<string, string[]> {
  const sources = new Map<string, string[]>();
  const ids = new Set(variables.map(variable => variable.id));
  for (const variable of variables) {
    const resolved = variable.sources.map(ref => (ids.has(ref) ? ref : aliases.get(ref) || undefined));
    if (resolved.every((ref): ref is string => ref !== undefined)) {
      sources.set(variable.id, [...new Set(resolved)]);
    } else {
      diagnostics.push({ variableId: variable.id, reason: 'unresolved-source' });
      sources.set(variable.id, []);
    }
    if (!variable.sources.length && variable.page === undefined) {
      diagnostics.push({ variableId: variable.id, reason: 'missing-page' });
    }
  }
  return sources;
}

function dependencyGraph(sources: Map<string, string[]>) {
  const pending = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  for (const [id, links] of sources) {
    pending.set(id, links.length);
    for (const source of links) dependants.set(source, [...dependants.get(source) || [], id]);
  }
  return { pending, dependants };
}

function releaseDependants(id: string, graph: ReturnType<typeof dependencyGraph>): string[] {
  const ready: string[] = [];
  for (const child of graph.dependants.get(id) || []) {
    const remaining = graph.pending.get(child)! - 1;
    graph.pending.set(child, remaining);
    if (!remaining) ready.push(child);
  }
  return ready;
}

function removeCyclicSources(sources: Map<string, string[]>, diagnostics: ItemDatasetVariableOrderDiagnostic[]): void {
  const graph = dependencyGraph(sources);
  const queue = [...sources.keys()].filter(id => graph.pending.get(id) === 0);
  for (let index = 0; index < queue.length; index += 1) queue.push(...releaseDependants(queue[index], graph));
  for (const [id, remaining] of graph.pending) {
    if (!remaining) continue;
    // Cycles and their blocked descendants retain their own layout/name position.
    sources.set(id, []);
    diagnostics.push({ variableId: id, reason: 'cyclic-source' });
  }
}

function orderAfterSources(ordered: VariablePosition[], sources: Map<string, string[]>): Map<string, number> {
  const graph = dependencyGraph(sources);
  const names = new Map(ordered.map(variable => [variable.id, variable.alias || variable.id]));
  const stack = ordered.filter(variable => graph.pending.get(variable.id) === 0).map(variable => variable.id).reverse();
  const positions = new Map<string, number>();
  while (stack.length) {
    const id = stack.pop()!;
    positions.set(id, positions.size + 1);
    const ready = releaseDependants(id, graph);
    ready.sort((left, right) => compareItemDatasetVariableNames(names.get(right)!, names.get(left)!));
    // Visit each newly ready derivation and its chain before the next sibling/root.
    stack.push(...ready);
  }
  return positions;
}

/** Static MNR positions. Export column order is independent of this analysis order. */
export function buildItemDatasetVariablePositions(
  unitName: string,
  mapped: MappedVariable[],
  definition?: string,
  codingScheme?: string,
  analyzedVariableIds?: readonly string[]
): ItemDatasetVariableOrder {
  const codings = parseCodingSchemeVariables(codingScheme);
  const variables = collectVariables(mapped, codings);
  const aliases = collectAliases(variables);
  assignPages(variables, aliases, mapped, codings, definition);

  const ordered = [...variables.values()].sort((left, right) => (
    (left.page ?? Infinity) - (right.page ?? Infinity) ||
    (left.page === undefined ? 0 : (left.section ?? Infinity) - (right.section ?? Infinity)) ||
    compareItemDatasetVariableNames(left.alias || left.id, right.alias || right.id)
  ));
  const diagnostics: ItemDatasetVariableOrderDiagnostic[] = [];
  const sources = resolveSources(ordered, aliases, diagnostics);
  // Only exported variables and their transitive hidden sources affect MNR classification.
  const analyzed = new Set(analyzedVariableIds || variables.keys());
  for (const id of analyzed) {
    for (const source of sources.get(id) || []) analyzed.add(source);
  }
  removeCyclicSources(sources, diagnostics);
  const positions = orderAfterSources(ordered, sources);
  const result = new Map<string, number>();
  for (const [id, position] of positions) result.set(ItemDatasetResponseKey.from(unitName, id).toString(), position);
  for (const [alias, id] of aliases) {
    if (id) result.set(ItemDatasetResponseKey.from(unitName, alias).toString(), positions.get(id)!);
  }
  return { positions: result, diagnostics: diagnostics.filter(entry => analyzed.has(entry.variableId)) };
}
