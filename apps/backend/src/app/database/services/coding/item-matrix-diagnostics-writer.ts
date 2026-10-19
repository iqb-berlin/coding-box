import * as fs from 'fs';
import type { FileHandle } from 'fs/promises';
import type { ItemMatrixExportDiagnosticCellDto } from '../../../../../../../api-dto/coding/export-request.dto';
import { getItemMatrixDiagnosticText } from './item-matrix-export-diagnostics.util';

const csvRow = (values: Array<string | number>): string => `${values.map(value => {
  const text = String(value);
  const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}).join(';')}\r\n`;

/** Bounded buffering; each failed cell is written once in matrix order. */
export class ItemMatrixDiagnosticsWriter {
  private buffer = `\uFEFF${csvRow([
    'zeile', 'spaltennummer', 'person_login', 'person_code', 'person_group',
    'booklet_id', 'booklet', 'spalte', 'unit', 'variable', 'reason_code', 'ursache'
  ])}`;

  private constructor(private readonly file: FileHandle) {}

  static async create(filePath: string): Promise<ItemMatrixDiagnosticsWriter> {
    return new ItemMatrixDiagnosticsWriter(await fs.promises.open(filePath, 'wx', 0o600));
  }

  async write(cell: ItemMatrixExportDiagnosticCellDto): Promise<void> {
    this.buffer += csvRow([
      cell.rowNumber, cell.columnNumber, cell.personLogin, cell.personCode,
      cell.personGroup, cell.bookletId, cell.bookletName, cell.columnName,
      cell.unitId, cell.variableId, cell.reasonCode,
      getItemMatrixDiagnosticText(cell.reasonCode).label
    ]);
    if (this.buffer.length >= 65536) await this.flush();
  }

  private async flush(): Promise<void> {
    await this.file.writeFile(this.buffer);
    this.buffer = '';
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.file.close();
    }
  }
}
