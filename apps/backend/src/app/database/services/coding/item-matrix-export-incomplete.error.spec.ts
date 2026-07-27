import {
  ItemMatrixExportIncompleteError,
  parseItemMatrixExportIncompleteError
} from './item-matrix-export-incomplete.error';

describe('ItemMatrixExportIncompleteError', () => {
  it('persists the error type and total independently from the localized text', () => {
    const error = new ItemMatrixExportIncompleteError({
      total: 3,
      sampleLimit: 20,
      groups: []
    });

    expect(error.message).toMatch(/^ITEM_MATRIX_UNRESOLVED_CELLS:3\s/);
    expect(parseItemMatrixExportIncompleteError(error.message)).toEqual({
      total: 3
    });
  });

  it('does not infer the error type from translated prose', () => {
    expect(parseItemMatrixExportIncompleteError(
      'Itemdatensatz enthält 3 nicht exportierbare Zellen.'
    )).toBeNull();
    expect(parseItemMatrixExportIncompleteError(
      'ITEM_MATRIX_UNRESOLVED_CELLS:not-a-number localized text'
    )).toBeNull();
  });
});
