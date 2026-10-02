import type {
  ItemMatrixCellFailureReason
} from '../../../../../../../api-dto/coding/export-request.dto';

export type ItemDatasetCellExportFailureReason =
  ItemMatrixCellFailureReason;

export class ItemDatasetCellExportError extends Error {
  readonly reason: ItemDatasetCellExportFailureReason;

  constructor(reason: ItemDatasetCellExportFailureReason) {
    super(reason);
    this.name = 'ItemDatasetCellExportError';
    this.reason = reason;
  }
}
