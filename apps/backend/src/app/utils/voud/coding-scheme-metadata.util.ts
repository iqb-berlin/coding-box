import type { VariableCodingData } from '@iqbspecs/coding-scheme/coding-scheme.interface';

export function parseCodingSchemeVariables(data: unknown): VariableCodingData[] {
  if (data === '') return [];
  const scheme = (typeof data === 'string' ? JSON.parse(data) : data) as {
    variableCodings?: VariableCodingData[];
  } | null | undefined;
  return Array.isArray(scheme?.variableCodings) ? scheme.variableCodings : [];
}

/** Unit/layout pages are zero-based; empty and invalid values carry no position. */
export function parseVariablePage(value: unknown): number | undefined {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const page = Number(value);
  return Number.isInteger(page) && page >= 0 ? page : undefined;
}

/** Studio coding-scheme pages are one-based; legacy page zero also means the first page. */
export function codingSchemePageIndex(value: unknown): number | undefined {
  const page = parseVariablePage(value);
  return page === undefined ? undefined : Math.max(0, page - 1);
}

export function codingSchemePageOverrides(codings: VariableCodingData[]): Map<string, string> {
  const ids = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const coding of codings) {
    const page = codingSchemePageIndex(coding?.page);
    if (page === undefined) continue;
    const id = String(coding?.id || '').trim();
    const alias = String(coding?.alias || '').trim();
    if (id) ids.set(id, String(page));
    if (alias) aliases.set(alias, String(page));
  }
  // Responses and replay use public aliases, which can shadow another internal ID.
  return new Map([...ids, ...aliases]);
}
