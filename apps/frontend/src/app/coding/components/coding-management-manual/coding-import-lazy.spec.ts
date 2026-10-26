import { readImportHeaders } from './coding-import-file';

const mockExcelLoad = jest.fn();
jest.mock('exceljs', () => {
  mockExcelLoad();
  return {
    Workbook: jest.fn(() => ({
      xlsx: { load: async () => undefined },
      getWorksheet: () => ({ getRow: () => ({ eachCell: (visit: (cell: { text: string }) => void) => visit({ text: 'Variable-ID' }) }) })
    }))
  };
});

it('loads ExcelJS only when an Excel workbook is actually read', async () => {
  const csv = { name: 'coding.csv', slice: () => ({ text: async () => 'unit;variable_id;code' }) } as unknown as File;
  expect(await readImportHeaders(csv)).toEqual(['unit', 'variable_id', 'code']);
  expect(mockExcelLoad).not.toHaveBeenCalled();
  const excel = { name: 'coding.xlsx', arrayBuffer: async () => new ArrayBuffer(0) } as File;
  expect(await readImportHeaders(excel)).toEqual(['variable_id']);
  expect(mockExcelLoad).toHaveBeenCalledTimes(1);
});
