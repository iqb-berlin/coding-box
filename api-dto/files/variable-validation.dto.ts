export type VariableValidationErrorCode =
  | 'UNIT_FILE_NOT_FOUND'
  | 'VARIABLE_NOT_DEFINED_IN_UNIT';

export interface VariableValidationSummaryDto {
  unitFileNotFound: number;
  variableNotDefinedInUnit: number;
}

export interface InvalidVariableDto {
  fileName: string;
  variableId: string;
  value: string;
  responseId?: number;
  expectedType?: string;
  errorReason?: string;
  errorCode?: VariableValidationErrorCode;
}

export interface VariableValidationDto {
  checkedFiles: number;
  invalidVariables: InvalidVariableDto[];
}
