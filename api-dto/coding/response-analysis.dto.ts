/**
 * DTO for response analysis - identifies empty responses and duplicate values
 * based on the response matching settings for a workspace.
 */

export interface EmptyResponseDto {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  personLogin: string;
  personCode: string;
  bookletName: string;
  responseId: number;
}

export interface DuplicateValueGroupDto {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  normalizedValue: string;
  originalValue: string;
  occurrences: {
    personLogin: string;
    personCode: string;
    bookletName: string;
    responseId: number;
    value: string;
  }[];
}

export interface ResponseAnalysisDto {
  emptyResponses: {
    total: number;
    items: EmptyResponseDto[];
  };
  duplicateValues: {
    total: number;
    totalResponses: number;
    groups: DuplicateValueGroupDto[];
    isAggregationApplied: boolean;
  };
  matchingFlags: string[];
  analysisTimestamp: string;
}
