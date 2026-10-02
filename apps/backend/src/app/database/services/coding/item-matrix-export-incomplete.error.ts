import type {
  ItemMatrixExportDiagnosticsDto
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE
} from '../../../../../../../api-dto/coding/export-request.dto';

const persistedErrorSeparator = ':';

export function parseItemMatrixExportIncompleteError(
  message?: string
): { total: number } | null {
  if (!message) {
    return null;
  }

  const prefix = `${ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE}${persistedErrorSeparator}`;
  if (!message.startsWith(prefix)) {
    return null;
  }

  const totalText = message.slice(prefix.length).split(/\s/, 1)[0];
  const total = Number(totalText);
  return Number.isSafeInteger(total) && total >= 0 ? { total } : null;
}

export class ItemMatrixExportIncompleteError extends Error {
  readonly diagnostics: ItemMatrixExportDiagnosticsDto;

  constructor(diagnostics: ItemMatrixExportDiagnosticsDto) {
    super(
      `${ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE}` +
      `${persistedErrorSeparator}${diagnostics.total} ` +
      `Itemdatensatz enthält ${diagnostics.total} nicht exportierbare ` +
      `Zelle${diagnostics.total === 1 ? '' : 'n'}.`
    );
    this.name = 'ItemMatrixExportIncompleteError';
    this.diagnostics = diagnostics;
  }
}
