import type { CodingImportDetectedFormat, CodingImportFormatDialogData } from './coding-import-format-dialog.component';

export async function detectCodingImportFormat(file: File): Promise<CodingImportFormatDialogData> {
  let headers: string[] = [];
  const fileName = file.name;

  try {
    headers = await readImportHeaders(file);
  } catch {
    return buildFormatDialogData(
      fileName,
      'unknown',
      [],
      [
        'Die Datei konnte nicht gelesen werden. Bitte prüfen Sie, ob die Datei beschädigt ist oder von einem anderen Programm gesperrt wird.',
        'Unterstützt werden CSV-Dateien sowie Excel-Dateien im Format .xlsx oder .xls.'
      ]
    );
  }

  const detectedFormat = detectFormatFromHeaders(headers);
  return buildFormatDialogData(fileName, detectedFormat, headers);
}

export async function readImportHeaders(file: File): Promise<string[]> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const ExcelJS = await import('exceljs');
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

export function buildFormatDialogData(
  fileName: string,
  detectedFormat: CodingImportDetectedFormat,
  headers: string[],
  fallbackHelpItems?: string[]
): CodingImportFormatDialogData {
  const availableVersions = getAvailableCodingVersions(headers);
  const sharedDescription =
        'Für Testfälle, die außerhalb der Kodierbox bereits mit Code und Score kodiert wurden.';

  if (detectedFormat === 'external-coding') {
    return {
      fileName,
      detectedFormat,
      title: 'Kodierungen aus Datei importieren',
      description: sharedDescription,
      canImport: true,
      headers,
      helpItems: [
        'Erwartet werden unit_key oder unit_alias, variable_id und mindestens eine Spalte code, score oder status.',
        'Optionale Zuordnungsspalten wie person_code, person_login, person_group und booklet_name machen den Import eindeutiger.'
      ]
    };
  }

  if (detectedFormat === 'coding-list') {
    const hasCodingValues = ['status', 'code', 'score'].some(header => headers.includes(header));
    return {
      fileName,
      detectedFormat,
      title: 'Kodierungen aus Datei importieren',
      description: sharedDescription,
      canImport: hasCodingValues,
      headers,
      helpItems: hasCodingValues ?
        [
          'Die Datei sieht nach einer Kodierliste aus dem Coding Management aus.',
          'Die ergänzten Spalten code, score und status werden als manuelle Kodierung importiert.'
        ] :
        [
          'Die Datei sieht nach einer Kodierliste aus, enthält aber noch keine Kodierungsspalten.',
          'Bitte ergänzen Sie mindestens code und score, optional auch status, und wählen Sie die Datei erneut aus.'
        ]
    };
  }

  if (detectedFormat === 'coding-results') {
    return {
      fileName,
      detectedFormat,
      title: 'Kodierungen aus Datei importieren',
      description: 'Die Datei sieht nach einem Kodierergebnis-Export aus dem Coding Management aus.',
      canImport: availableVersions.length > 0,
      headers,
      availableVersions,
      selectedVersion: availableVersions.includes('v2') ? 'v2' : availableVersions[0],
      helpItems: [
        'Wählen Sie aus, welche Version aus der Datei übernommen werden soll.',
        'Die ausgewählten Werte werden als manuelle Kodierung (v2) importiert.'
      ]
    };
  }

  if (detectedFormat === 'test-results') {
    return {
      fileName,
      detectedFormat,
      title: 'Testergebnisse-Export erkannt',
      description: 'Diese Datei enthält vollständige Testergebnisse mit Antworten und Zuständen, nicht nur Code-/Score-Kodierungen.',
      canImport: false,
      headers,
      helpItems: [
        'Bitte wechseln Sie zu Testergebnisse > Import > Antworten hochladen.',
        'Für den Kodierungsimport wird eine flache Datei mit unit_key oder unit_alias, variable_id, code und score benötigt.'
      ]
    };
  }

  if (detectedFormat === 'test-logs') {
    return {
      fileName,
      detectedFormat,
      title: 'Testlogs-Export erkannt',
      description: 'Diese Datei enthält Testlogs und kann nicht als Code-/Score-Kodierung übernommen werden.',
      canImport: false,
      headers,
      helpItems: [
        'Bitte wechseln Sie zu Testergebnisse > Import > Logs hochladen.',
        'Für den Kodierungsimport wird eine flache Datei mit unit_key oder unit_alias, variable_id, code und score benötigt.'
      ]
    };
  }

  return {
    fileName,
    detectedFormat,
    title: 'Datei konnte nicht erkannt werden',
    description: 'Die Datei passt zu keinem unterstützten Kodierungsimport.',
    canImport: false,
    headers,
    helpItems: fallbackHelpItems || [
      'Prüfen Sie, ob die erste Zeile Spaltenüberschriften enthält.',
      'Für Kodierungen aus anderer Quelle werden unit_key oder unit_alias, variable_id, code und score erwartet.',
      'Kodierergebnis-Exporte müssen Spalten wie status_v2, code_v2 und score_v2 enthalten.',
      'Testergebnisse- und Log-Exporte bitte über den Bereich Testergebnisse importieren.'
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
