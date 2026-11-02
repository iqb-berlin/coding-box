import { UiTranslator } from '../../../shared/utils/ui-translator';
import type { CodingImportDetectedFormat, CodingImportFormatDialogData } from './coding-import-format-dialog.component';

export async function detectCodingImportFormat(translate: UiTranslator, file: File): Promise<CodingImportFormatDialogData> {
  let headers: string[];
  const fileName = file.name;

  try {
    headers = await readImportHeaders(file);
  } catch {
    return buildFormatDialogData(translate,
      fileName,
      'unknown',
      [],
      [
        translate('ui-text.coding-import-file.read-failed'),
        translate('ui-text.coding-import-file.supported-formats')
      ]
    );
  }

  const detectedFormat = detectFormatFromHeaders(headers);
  return buildFormatDialogData(translate, fileName, detectedFormat, headers);
}

export async function readImportHeaders(file: File): Promise<string[]> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const buffer = await file.arrayBuffer();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      return [];
    }

    const headers: string[] = [];
    worksheet.getRow(1).eachCell(cell => {
      headers.push(normalizeImportHeader(cell.text || cell.value?.toString() || ''));
    });
    return headers.filter(Boolean);
  }

  const sample = await file.slice(0, 65536).text();
  const firstLine = sample.split(/\r?\n/).find(line => line.trim().length > 0) || '';
  const delimiter = detectCsvDelimiter(firstLine);
  return splitCsvHeaderLine(firstLine, delimiter)
    .map(header => normalizeImportHeader(header))
    .filter(Boolean);
}

export function detectFormatFromHeaders(headers: string[]): CodingImportDetectedFormat {
  const has = (header: string): boolean => headers.includes(header);
  const hasAny = (candidates: string[]): boolean => candidates.some(candidate => has(candidate));

  if (
    has('groupname') &&
        has('loginname') &&
        has('code') &&
        has('bookletname') &&
        has('unitname') &&
        has('timestamp') &&
        has('logentry')
  ) {
    return 'test-logs';
  }

  if (
    has('groupname') &&
        has('loginname') &&
        has('code') &&
        has('bookletname') &&
        has('unitname') &&
        has('responses')
  ) {
    return 'test-results';
  }

  if (
    has('variable_id') &&
        hasAny([
          'status_v1', 'code_v1', 'score_v1',
          'status_v2', 'code_v2', 'score_v2',
          'status_v3', 'code_v3', 'score_v3'
        ])
  ) {
    return 'coding-results';
  }

  if (has('variable_id') && (has('unit_key') || has('unit_alias'))) {
    if (hasAny(['status', 'code', 'score', 'variable_page', 'variable_anchor'])) {
      return hasAny(['variable_page', 'variable_anchor']) ? 'coding-list' : 'external-coding';
    }
  }

  return 'unknown';
}

export function buildFormatDialogData(translate: UiTranslator,
  fileName: string,
  detectedFormat: CodingImportDetectedFormat,
  headers: string[],
  fallbackHelpItems?: string[]
): CodingImportFormatDialogData {
  const availableVersions = getAvailableCodingVersions(headers);
  const sharedDescription =
    translate('ui-text.coding-import-file.external-coding-hint');

  if (detectedFormat === 'external-coding') {
    return {
      fileName,
      detectedFormat,
      title: translate('coding-management-manual.import.tooltip'),
      description: sharedDescription,
      canImport: true,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.required-columns'),
        translate('ui-text.coding-import-file.optional-matching-columns')
      ]
    };
  }

  if (detectedFormat === 'coding-list') {
    const hasCodingValues = ['status', 'code', 'score'].some(header => headers.includes(header));
    return {
      fileName,
      detectedFormat,
      title: translate('coding-management-manual.import.tooltip'),
      description: sharedDescription,
      canImport: hasCodingValues,
      headers,
      helpItems: hasCodingValues ?
        [
          translate('ui-text.coding-import-file.coding-list-detected'),
          translate('ui-text.coding-import-file.manual-columns-hint')
        ] :
        [
          translate('ui-text.coding-import-file.coding-list-without-codes'),
          translate('ui-text.coding-import-file.add-coding-columns-hint')
        ]
    };
  }

  if (detectedFormat === 'coding-results') {
    return {
      fileName,
      detectedFormat,
      title: translate('coding-management-manual.import.tooltip'),
      description: translate('ui-text.coding-import-file.results-export-detected'),
      canImport: availableVersions.length > 0,
      headers,
      availableVersions,
      selectedVersion: availableVersions.includes('v2') ? 'v2' : availableVersions[0],
      helpItems: [
        translate('ui-text.coding-import-file.select-version-hint'),
        translate('ui-text.coding-import-file.manual-import-target')
      ]
    };
  }

  if (detectedFormat === 'test-results') {
    return {
      fileName,
      detectedFormat,
      title: translate('ui-text.coding-import-file.test-results-detected'),
      description: translate('ui-text.coding-import-file.test-results-description'),
      canImport: false,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.import-responses-hint'),
        translate('ui-text.coding-import-file.flat-format-hint')
      ]
    };
  }

  if (detectedFormat === 'test-logs') {
    return {
      fileName,
      detectedFormat,
      title: translate('ui-text.coding-import-file.logs-detected'),
      description: translate('ui-text.coding-import-file.logs-description'),
      canImport: false,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.import-logs-hint'),
        translate('ui-text.coding-import-file.flat-format-hint')
      ]
    };
  }

  return {
    fileName,
    detectedFormat,
    title: translate('ui-text.coding-import-file.unknown-format-title'),
    description: translate('ui-text.coding-import-file.unknown-format-description'),
    canImport: false,
    headers,
    helpItems: fallbackHelpItems || [
      translate('ui-text.coding-import-file.header-row-hint'),
      translate('ui-text.coding-import-file.external-columns-hint'),
      translate('ui-text.coding-import-file.result-version-columns-hint'),
      translate('ui-text.coding-import-file.test-results-import-hint')
    ]
  };
}

export function getAvailableCodingVersions(headers: string[]): Array<'v1' | 'v2' | 'v3'> {
  return (['v1', 'v2', 'v3'] as Array<'v1' | 'v2' | 'v3'>)
    .filter(version => (
      headers.includes(`status_${version}`) ||
          headers.includes(`code_${version}`) ||
          headers.includes(`score_${version}`)
    ));
}

export function normalizeImportHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function detectCsvDelimiter(line: string): ';' | ',' | '\t' {
  const candidates: Array<';' | ',' | '\t'> = [';', ',', '\t'];
  let selected: ';' | ',' | '\t' = ',';
  let bestCount = -1;

  candidates.forEach(candidate => {
    const count = countDelimiterOutsideQuotes(line, candidate);
    if (count > bestCount) {
      bestCount = count;
      selected = candidate;
    }
  });

  return selected;
}

export function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

export function splitCsvHeaderLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      values.push(current.replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.replace(/^"|"$/g, ''));
  return values;
}
