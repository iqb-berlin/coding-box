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
        translate('ui-text.coding-import-file.die-datei-konnte-nicht-gelesen-werden-bitte-pruefen-sie-ob-die-datei-beschaedigt-ist'),
        translate('ui-text.coding-import-file.unterstuetzt-werden-csv-dateien-sowie-excel-dateien-im-format-xlsx-oder-xls')
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
    translate('ui-text.coding-import-file.fuer-testfaelle-die-ausserhalb-der-kodierbox-bereits-mit-code-und-score-kodiert-wurde');

  if (detectedFormat === 'external-coding') {
    return {
      fileName,
      detectedFormat,
      title: translate('coding-management-manual.import.tooltip'),
      description: sharedDescription,
      canImport: true,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.erwartet-werden-unit-key-oder-unit-alias-variable-id-und-mindestens-eine-spalte-code'),
        translate('ui-text.coding-import-file.optionale-zuordnungsspalten-wie-person-code-person-login-person-group-und-booklet-nam')
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
          translate('ui-text.coding-import-file.die-datei-sieht-nach-einer-kodierliste-aus-dem-coding-management-aus'),
          translate('ui-text.coding-import-file.die-ergaenzten-spalten-code-score-und-status-werden-als-manuelle-kodierung-importiert')
        ] :
        [
          translate('ui-text.coding-import-file.die-datei-sieht-nach-einer-kodierliste-aus-enthaelt-aber-noch-keine-kodierungsspalten'),
          translate('ui-text.coding-import-file.bitte-ergaenzen-sie-mindestens-code-und-score-optional-auch-status-und-waehlen-sie-di')
        ]
    };
  }

  if (detectedFormat === 'coding-results') {
    return {
      fileName,
      detectedFormat,
      title: translate('coding-management-manual.import.tooltip'),
      description: translate('ui-text.coding-import-file.die-datei-sieht-nach-einem-kodierergebnis-export-aus-dem-coding-management-aus'),
      canImport: availableVersions.length > 0,
      headers,
      availableVersions,
      selectedVersion: availableVersions.includes('v2') ? 'v2' : availableVersions[0],
      helpItems: [
        translate('ui-text.coding-import-file.waehlen-sie-aus-welche-version-aus-der-datei-uebernommen-werden-soll'),
        translate('ui-text.coding-import-file.die-ausgewaehlten-werte-werden-als-manuelle-kodierung-v2-importiert')
      ]
    };
  }

  if (detectedFormat === 'test-results') {
    return {
      fileName,
      detectedFormat,
      title: translate('ui-text.coding-import-file.testergebnisse-export-erkannt'),
      description: translate('ui-text.coding-import-file.diese-datei-enthaelt-vollstaendige-testergebnisse-mit-antworten-und-zustaenden-nicht'),
      canImport: false,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.bitte-wechseln-sie-zu-testergebnisse-import-antworten-hochladen'),
        translate('ui-text.coding-import-file.fuer-den-kodierungsimport-wird-eine-flache-datei-mit-unit-key-oder-unit-alias-variabl')
      ]
    };
  }

  if (detectedFormat === 'test-logs') {
    return {
      fileName,
      detectedFormat,
      title: translate('ui-text.coding-import-file.testlogs-export-erkannt'),
      description: translate('ui-text.coding-import-file.diese-datei-enthaelt-testlogs-und-kann-nicht-als-code-score-kodierung-uebernommen-wer'),
      canImport: false,
      headers,
      helpItems: [
        translate('ui-text.coding-import-file.bitte-wechseln-sie-zu-testergebnisse-import-logs-hochladen'),
        translate('ui-text.coding-import-file.fuer-den-kodierungsimport-wird-eine-flache-datei-mit-unit-key-oder-unit-alias-variabl')
      ]
    };
  }

  return {
    fileName,
    detectedFormat,
    title: translate('ui-text.coding-import-file.datei-konnte-nicht-erkannt-werden'),
    description: translate('ui-text.coding-import-file.die-datei-passt-zu-keinem-unterstuetzten-kodierungsimport'),
    canImport: false,
    headers,
    helpItems: fallbackHelpItems || [
      translate('ui-text.coding-import-file.pruefen-sie-ob-die-erste-zeile-spaltenueberschriften-enthaelt'),
      translate('ui-text.coding-import-file.fuer-kodierungen-aus-anderer-quelle-werden-unit-key-oder-unit-alias-variable-id-code'),
      translate('ui-text.coding-import-file.kodierergebnis-exporte-muessen-spalten-wie-status-v2-code-v2-und-score-v2-enthalten'),
      translate('ui-text.coding-import-file.testergebnisse-und-log-exporte-bitte-ueber-den-bereich-testergebnisse-importieren')
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
