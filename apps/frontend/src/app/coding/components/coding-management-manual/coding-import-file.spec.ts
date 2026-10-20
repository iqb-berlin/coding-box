import * as ExcelJS from 'exceljs';
import {
  buildFormatDialogData, detectCodingImportFormat, detectCsvDelimiter, detectFormatFromHeaders,
  normalizeImportHeader, readImportHeaders, splitCsvHeaderLine
} from './coding-import-file';

const csvFile = (text: string): File => ({
  name: 'coding.csv',
  slice: () => ({ text: async () => text })
} as unknown as File);

describe('coding import interpretation', () => {
  it.each([';', ',', '\t'] as const)('reads %p-separated headers with BOM, quoting and blank lines', async delimiter => {
    const file = csvFile(`\n\uFEFF"Unit Key"${delimiter}"variable-id"${delimiter}"score"`);
    expect(await readImportHeaders(file)).toEqual(['unit_key', 'variable_id', 'score']);
    const result = await detectCodingImportFormat(file);
    expect(result.detectedFormat).toBe('external-coding');
    expect(result.canImport).toBe(true);
  });

  it('does not count quoted delimiter characters as separators', () => {
    const line = '"unit,key";"variable_id";"code"';
    expect(detectCsvDelimiter(line)).toBe(';');
    expect(splitCsvHeaderLine(line, ';')).toEqual(['unit,key', 'variable_id', 'code']);
    expect(normalizeImportHeader('\uFEFF Variable-Id ')).toBe('variable_id');
  });

  it.each([
    [['groupname', 'loginname', 'code', 'bookletname', 'unitname', 'timestamp', 'logentry'], 'test-logs', false],
    [['groupname', 'loginname', 'code', 'bookletname', 'unitname', 'responses'], 'test-results', false],
    [['unit_alias', 'variable_id', 'code'], 'external-coding', true],
    [['unit_key', 'variable_id', 'variable_page'], 'coding-list', false],
    [['unit_key', 'variable_id', 'variable_anchor', 'score'], 'coding-list', true],
    [['unknown'], 'unknown', false]
  ] as const)('classifies %p as %p', (headers, format, canImport) => {
    const detected = detectFormatFromHeaders([...headers]);
    expect(detected).toBe(format);
    expect(buildFormatDialogData('file.csv', detected, [...headers]).canImport).toBe(canImport);
  });

  it('offers only present coding versions and prefers v2', () => {
    const headers = ['variable_id', 'score_v1', 'code_v2', 'status_v3'];
    const result = buildFormatDialogData('coding.csv', detectFormatFromHeaders(headers), headers);
    expect(result.availableVersions).toEqual(['v1', 'v2', 'v3']);
    expect(result.selectedVersion).toBe('v2');
  });

  it('reads the first Excel worksheet with the same normalization', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('codes').addRow(['Unit Alias', 'Variable-ID', 'Score']);
    const buffer = await book.xlsx.writeBuffer();
    const file = { name: 'coding.xlsx', arrayBuffer: async () => buffer } as File;
    expect(await readImportHeaders(file)).toEqual(['unit_alias', 'variable_id', 'score']);
  });

  it('keeps an unreadable file in the format dialog with import disabled', async () => {
    const file = { name: 'broken.xlsx', arrayBuffer: async () => { throw new Error('broken'); } } as unknown as File;
    const result = await detectCodingImportFormat(file);
    expect(result.canImport).toBe(false);
    expect(result.detectedFormat).toBe('unknown');
    expect(result.helpItems.length).toBeGreaterThan(0);
  });
});
