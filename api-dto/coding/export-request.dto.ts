import { PsychometricExportOptions } from './psychometric-discrimination.dto';

export const BACKGROUND_EXPORT_TYPES = [
  'aggregated',
  'by-coder',
  'by-variable',
  'by-variable-compact',
  'detailed',
  'coding-times',
  'test-results',
  'test-logs',
  'results-by-version',
  'coding-list',
  'item-matrix',
  'psychometrics'
] as const;

export type BackgroundExportType = (typeof BACKGROUND_EXPORT_TYPES)[number];
export const CODING_EXPORT_TYPES = [
  'aggregated',
  'by-coder',
  'by-variable',
  'by-variable-compact',
  'detailed',
  'coding-times',
  'results-by-version',
  'coding-list',
  'item-matrix',
  'psychometrics'
] as const satisfies readonly BackgroundExportType[];
export type CodingExportType = (typeof CODING_EXPORT_TYPES)[number];
export const isCodingExportType = (
  value: unknown
): value is CodingExportType =>
  typeof value === 'string' &&
  (CODING_EXPORT_TYPES as readonly string[]).includes(value);
export type ExportVersion = 'v1' | 'v2' | 'v3';
export type ExportFormat = 'csv' | 'json' | 'excel';
export type ItemDatasetNotReachedScope = 'unit' | 'testlet' | 'booklet';

export const ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE =
  'ITEM_MATRIX_UNRESOLVED_CELLS' as const;

export type ItemMatrixCellFailureReason =
  | 'unresolved-cell'
  | 'unresolved-status'
  | 'derived-result-missing'
  | 'derived-cycle'
  | 'derived-source-unresolved'
  | 'derived-design-conflict'
  | 'internal-resolution-missing'
  | 'invalid-code'
  | 'missing-code'
  | 'missing-score';

export interface ItemMatrixExportDiagnosticGroupDto {
  reasonCode: ItemMatrixCellFailureReason;
  bookletName: string;
  columnName: string;
  count: number;
  sampleRowNumbers: number[];
}

export interface ItemMatrixExportDiagnosticsDto {
  total: number;
  sampleLimit: number;
  groups: ItemMatrixExportDiagnosticGroupDto[];
}

export interface ItemMatrixExportErrorDetailsDto {
  total: number;
  groupCount: number;
  sampleLimit: number;
  diagnosticsAvailable: boolean;
  incompleteDownloadAvailable: boolean;
  expiresAt?: number;
}

export interface ExportWorksheetLimitErrorDetailsDto {
  actual: number;
  max: number;
}

export interface ItemMatrixExportJobErrorDto {
  errorCode: typeof ITEM_MATRIX_UNRESOLVED_CELLS_ERROR_CODE;
  errorDetails: ItemMatrixExportErrorDetailsDto;
}

export interface ExportWorksheetLimitJobErrorDto {
  errorCode: 'EXPORT_TOO_MANY_WORKSHEETS';
  errorDetails: ExportWorksheetLimitErrorDetailsDto;
}

export interface ExportJobWithoutStructuredErrorDto {
  errorCode?: undefined;
  errorDetails?: undefined;
}

export type ExportJobErrorMetadataDto =
  | ItemMatrixExportJobErrorDto
  | ExportWorksheetLimitJobErrorDto
  | ExportJobWithoutStructuredErrorDto;

export type ExportJobProgressPhaseDto =
  'preparing'
  | 'counting'
  | 'writing'
  | 'finalizing'
  | 'completed';

export type ExportJobStateDto =
  'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface ExportJobResultDto {
  fileId: string;
  fileName: string;
  fileSize: number;
  workspaceId: number;
  userId: number;
  exportType: string;
  createdAt: number;
  expiresAt: number;
}

export interface ExportJobStatusBaseDto {
  status: ExportJobStateDto;
  progress: number;
  progressPhase?: ExportJobProgressPhaseDto;
  processedRows?: number;
  totalRows?: number;
  progressMessage?: string;
  result?: ExportJobResultDto;
  error?: string;
}

export type ExportJobStatusDto =
  ExportJobStatusBaseDto & ExportJobErrorMetadataDto;

export type ExportJobDisplayVariantDto =
  | 'manual-review-most-frequent'
  | 'manual-review-new-column-per-coder'
  | 'manual-review-new-row-per-variable'
  | 'manual-review-by-variable-compact';

export type ExportJobListItemDto = ExportJobStatusDto & {
  jobId: string;
  exportType: CodingExportType;
  createdAt: number;
  displayVariant?: ExportJobDisplayVariantDto;
};

export interface ExportJobStatusErrorDto {
  error: string;
}

export type ExportJobStatusResponseDto =
  ExportJobStatusDto
  | ExportJobStatusErrorDto;

export interface ItemDatasetSelection {
  unitId: string;
  itemId: string;
}

export interface ItemDatasetOption extends ItemDatasetSelection {
  unitLabel: string;
  itemLabel: string;
  columnName: string;
}

export type ItemDatasetMappingIssueCode =
  | 'vomd-mapping'
  | 'ambiguous-vomd-fallback'
  | 'missing-vomd'
  | 'missing-item-id'
  | 'missing-variable-id'
  | 'variable-not-found'
  | 'ambiguous-variable'
  | 'ambiguous-item-fallback'
  | 'duplicate-vomd-item'
  | 'ambiguous-variable-mapping'
  | 'column-name-collision'
  | 'unknown-selection';

export type ItemDatasetMappingWarningCode =
  'vomd-fallback-used'
  | 'vomd-fallback-ignored';

interface ItemDatasetMappingDiagnosticDto {
  message: string;
  unitId?: string;
  itemId?: string;
  variableId?: string;
  columnName?: string;
  sourceFile?: string;
  suggestedAction?: string;
}

export interface ItemDatasetMappingIssueDto
  extends ItemDatasetMappingDiagnosticDto {
  code: ItemDatasetMappingIssueCode;
}

export interface ItemDatasetMappingWarningDto
  extends ItemDatasetMappingDiagnosticDto {
  code: ItemDatasetMappingWarningCode;
}

export interface ItemDatasetOptionsDto {
  items: ItemDatasetOption[];
  mappingIssues: ItemDatasetMappingIssueDto[];
  mappingWarnings?: ItemDatasetMappingWarningDto[];
}

interface ExportRequestTransportOptions {
  authToken?: string;
  serverUrl?: string;
  includeReplayUrl?: boolean;
}

export interface ResultsByVersionExportRequest extends ExportRequestTransportOptions {
  exportType: 'results-by-version';
  version?: ExportVersion;
  format?: Exclude<ExportFormat, 'json'>;
  missingsProfileId: number;
  includeResponseValues?: boolean;
  includeGeoGebraResponseValues?: boolean;
  includeGeoGebraFiles?: boolean;
}

export interface ItemMatrixExportRequest extends ExportRequestTransportOptions {
  exportType: 'item-matrix';
  version?: ExportVersion;
  format?: Exclude<ExportFormat, 'json'>;
  matrixValue?: 'code' | 'score';
  missingsProfileId: number;
  notReachedScope?: ItemDatasetNotReachedScope;
  recodeTrailingOmissions?: boolean;
  items?: ItemDatasetSelection[];
}

export interface PsychometricExportRequest
  extends ExportRequestTransportOptions, PsychometricExportOptions {
  exportType: 'psychometrics';
}

export type ExportRequest =
  | PsychometricExportRequest
  | ItemMatrixExportRequest
  | ResultsByVersionExportRequest;

export type OtherBackgroundExportType = Exclude<
  BackgroundExportType,
  ExportRequest['exportType']
>;

export interface OtherBackgroundExportRequest extends ExportRequestTransportOptions {
  exportType: OtherBackgroundExportType;
  format?: ExportFormat;
  outputCommentsInsteadOfCodes?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  doubleCodingMethod?:
    'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeDoubleCoded?: boolean;
  includeResponseValues?: boolean;
  excludeAutoCoded?: boolean;
  trainingRequired?: boolean;
  testResultFilters?: {
    groupNames?: string[];
    bookletNames?: string[];
    unitNames?: string[];
    personIds?: number[];
    includeLogAnomalies?: boolean;
  };
  jobDefinitionIds?: number[];
  coderTrainingIds?: number[];
  coderIds?: number[];
}

export type BackgroundExportRequest =
  ExportRequest | OtherBackgroundExportRequest;

export class ExportRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportRequestValidationError';
  }
}

const exportVersions: readonly ExportVersion[] = ['v1', 'v2', 'v3'];
const tabularFormats: readonly ExportFormat[] = ['csv', 'excel'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOneOf = <T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T =>
  typeof value === 'string' && allowedValues.includes(value as T);

const assertOptionalVersion = (
  request: Record<string, unknown>,
  exportType: string
): void => {
  if (
    request.version !== undefined &&
    !isOneOf(request.version, exportVersions)
  ) {
    throw new ExportRequestValidationError(
      `${exportType} exports support only "v1", "v2" or "v3" versions`
    );
  }
};

const assertOptionalTabularFormat = (
  request: Record<string, unknown>,
  exportType: string
): void => {
  if (
    request.format !== undefined &&
    !isOneOf(request.format, tabularFormats)
  ) {
    throw new ExportRequestValidationError(
      `${exportType} exports support only "csv" or "excel" format`
    );
  }
};

const assertPsychometricDomain = (domain: unknown): void => {
  if (domain === undefined) {
    return;
  }
  if (!isRecord(domain)) {
    throw new ExportRequestValidationError(
      'psychometrics domain must select the workspace or a valid VOMD field'
    );
  }
  if (domain.mode === 'workspace') {
    return;
  }
  if (
    domain.mode !== 'vomd-field' ||
    !isOneOf(domain.scope, ['UNIT', 'ITEM']) ||
    typeof domain.profileId !== 'string' ||
    domain.profileId.length === 0 ||
    typeof domain.entryId !== 'string' ||
    domain.entryId.length === 0
  ) {
    throw new ExportRequestValidationError(
      'psychometrics domain must select the workspace or a valid VOMD field'
    );
  }
};

export const parseExportRequest = (value: unknown): BackgroundExportRequest => {
  if (!isRecord(value) || !isOneOf(value.exportType, BACKGROUND_EXPORT_TYPES)) {
    const exportType = isRecord(value) ? String(value.exportType) : 'undefined';
    throw new ExportRequestValidationError(
      `Unknown export type: ${exportType}`
    );
  }

  switch (value.exportType) {
    case 'results-by-version':
      assertOptionalTabularFormat(value, value.exportType);
      assertOptionalVersion(value, value.exportType);
      if (
        !Number.isSafeInteger(value.missingsProfileId) ||
        Number(value.missingsProfileId) <= 0
      ) {
        throw new ExportRequestValidationError(
          'results-by-version exports require missingsProfileId to be a positive integer'
        );
      }
      if (value.includeGeoGebraFiles && value.format !== 'excel') {
        throw new ExportRequestValidationError(
          'GeoGebra file packages are supported only for results-by-version Excel exports'
        );
      }
      if (value.includeGeoGebraFiles && value.includeResponseValues === false) {
        throw new ExportRequestValidationError(
          'GeoGebra file packages require response values because links are written to the value column'
        );
      }
      break;
    case 'item-matrix':
      assertOptionalTabularFormat(value, value.exportType);
      assertOptionalVersion(value, value.exportType);
      if (
        value.matrixValue !== undefined &&
        !isOneOf(value.matrixValue, ['code', 'score'])
      ) {
        throw new ExportRequestValidationError(
          'item-matrix exports support only "code" or "score" matrix values'
        );
      }
      if (
        !Number.isSafeInteger(value.missingsProfileId) ||
        Number(value.missingsProfileId) <= 0
      ) {
        throw new ExportRequestValidationError(
          'item-matrix missingsProfileId must be a positive integer'
        );
      }
      if (
        value.notReachedScope !== undefined &&
        !isOneOf(value.notReachedScope, ['unit', 'testlet', 'booklet'])
      ) {
        throw new ExportRequestValidationError(
          'item-matrix notReachedScope must be "unit", "testlet" or "booklet"'
        );
      }
      if (
        value.recodeTrailingOmissions !== undefined &&
        typeof value.recodeTrailingOmissions !== 'boolean'
      ) {
        throw new ExportRequestValidationError(
          'item-matrix recodeTrailingOmissions must be a boolean'
        );
      }
      if (
        value.recodeTrailingOmissions === true &&
        (value.notReachedScope === undefined ||
          value.notReachedScope === 'unit')
      ) {
        throw new ExportRequestValidationError(
          'item-matrix recodeTrailingOmissions is supported only for testlet or booklet scope'
        );
      }
      if (
        value.items !== undefined &&
        (!Array.isArray(value.items) ||
          value.items.some(
            (item) =>
              !isRecord(item) ||
              typeof item.unitId !== 'string' ||
              item.unitId.trim() === '' ||
              typeof item.itemId !== 'string' ||
              item.itemId.trim() === ''
          ))
      ) {
        throw new ExportRequestValidationError(
          'item-matrix items must contain valid unitId/itemId pairs'
        );
      }
      break;
    case 'psychometrics':
      assertOptionalTabularFormat(value, value.exportType);
      assertOptionalVersion(value, value.exportType);
      if (
        value.partWholeCorrection !== undefined &&
        typeof value.partWholeCorrection !== 'boolean'
      ) {
        throw new ExportRequestValidationError(
          'psychometrics partWholeCorrection must be a boolean'
        );
      }
      if (
        value.maxCategoryCount !== undefined &&
        (!Number.isSafeInteger(value.maxCategoryCount) ||
          Number(value.maxCategoryCount) < 1 ||
          Number(value.maxCategoryCount) > 100)
      ) {
        throw new ExportRequestValidationError(
          'psychometrics maxCategoryCount must be an integer between 1 and 100'
        );
      }
      if (
        value.missingsProfileId !== undefined &&
        (!Number.isSafeInteger(value.missingsProfileId) ||
          Number(value.missingsProfileId) <= 0)
      ) {
        throw new ExportRequestValidationError(
          'psychometrics missingsProfileId must be a positive integer'
        );
      }
      assertPsychometricDomain(value.domain);
      break;
    default:
      break;
  }

  return value as unknown as BackgroundExportRequest;
};
