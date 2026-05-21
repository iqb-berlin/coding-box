export type AutocodingReadinessStatus = 'READY' | 'BLOCKED' | 'NO_RESULTS';

export type AutocodingReadinessBlocker =
  | 'NO_RELEVANT_RESPONSES'
  | 'MISSING_UNIT_FILES'
  | 'MISSING_CODING_SCHEMES'
  | 'INVALID_CODING_SCHEMES'
  | 'NO_VALID_VARIABLE_MATCHES'
  | 'NO_CODEABLE_RESPONSES';

export interface AutocodingInvalidVariableSampleDto {
  unitName: string;
  responseCount: number;
  sampleVariableIds: string[];
  knownVariableIds: string[];
}

export interface AutocodingReadinessDto {
  workspaceId: number;
  autoCoderRun: 1 | 2;
  readiness: AutocodingReadinessStatus;
  blockers: AutocodingReadinessBlocker[];
  rawResponsesTotal: number;
  rawResponsesWithRelevantStatus: number;
  resultUnitsTotal: number;
  resultUnitKeysTotal: number;
  matchedUnitFiles: number;
  missingUnitFiles: string[];
  matchedCodingSchemes: number;
  missingCodingSchemes: string[];
  invalidCodingSchemes: string[];
  validVariablePairs: number;
  validResponses: number;
  codeableResponses: number;
  invalidVariableSamples: AutocodingInvalidVariableSampleDto[];
  computedAt?: string;
  computationMs?: number;
  fromCache?: boolean;
  sourceRevision?: number;
  fileRevision?: string;
}
