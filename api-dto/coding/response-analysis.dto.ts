/**
 * DTO for response analysis - identifies empty responses and duplicate values
 * based on the response matching settings for a workspace
 */

export interface EmptyResponseDto {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  responseId: number;
  value: string | null;
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

export interface EmptyResponseAnalysisDto {
  total: number;
  items: EmptyResponseDto[];
  page?: number;
  pageSize?: number;
}

export interface DuplicateValueAnalysisDto {
  total: number;
  totalResponses: number;
  groups: DuplicateValueGroupDto[];
  isAggregationApplied: boolean;
  page?: number;
  pageSize?: number;
}

export interface ResponseAnalysisDto {
  emptyResponses: EmptyResponseAnalysisDto;
  duplicateValues: DuplicateValueAnalysisDto;
  matchingFlags: string[];
  analysisTimestamp: string;
  isCalculating?: boolean;
  progress?: number;
}
