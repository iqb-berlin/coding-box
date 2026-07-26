export type ItemDatasetCellExportFailureReason =
  | 'unresolved-cell'
  | 'invalid-code'
  | 'missing-code'
  | 'missing-score';

export class ItemDatasetCellExportError extends Error {
  readonly reason: ItemDatasetCellExportFailureReason;

  constructor(reason: ItemDatasetCellExportFailureReason) {
    super(reason);
    this.name = 'ItemDatasetCellExportError';
    this.reason = reason;
  }
}
