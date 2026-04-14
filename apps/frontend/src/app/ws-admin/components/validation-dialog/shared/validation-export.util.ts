export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const headerRow = columns.map(column => escapeCsvValue(column.header)).join(';');
  const dataRows = rows.map(row => columns.map(column => escapeCsvValue(column.value(row))).join(';')
  );

  return [headerRow, ...dataRows].join('\n');
}

export function downloadCsvFile(fileName: string, csvContent: string): void {
  const csvWithBom = `\uFEFF${csvContent}`;
  const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
