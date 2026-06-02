const CSV_FORMULA_PREFIX_PATTERN = /^\s*[=+\-@]/;

export function sanitizeCsvText(value: string | null | undefined): string {
  const text = value ?? '';
  const normalized = text.replace(/[\r\n\t]+/g, ' ');
  return CSV_FORMULA_PREFIX_PATTERN.test(normalized) ? `'${normalized}` : normalized;
}
