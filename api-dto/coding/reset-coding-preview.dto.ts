export interface ResetCodingScope {
  version: 'v1' | 'v2' | 'v3';
  unitFilters: string[];
  variableFilters: string[];
}

export interface ResetCodingPreviewResult {
  status: 'valid' | 'invalid-filters';
  unknownUnits: string[];
  unknownVariables: string[];
  /** Distinct responses changed or removed, including generated-response cleanup. */
  affectedResponseCount: number | null;
  resetResponseCount: number | null;
  deletedGeneratedResponseCount: number | null;
  checkedAt: string;
}

export interface ResetCodingPreviewJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
  result?: ResetCodingPreviewResult;
}
