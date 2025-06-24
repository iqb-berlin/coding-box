export interface InvalidVariableDto {
  fileName: string;
  variableId: string;
  value: string;
  responseId?: number;
  expectedType?: string;
  errorReason?: string;
}

export interface VariableValidationDto {
  checkedFiles: number;
  invalidVariables: InvalidVariableDto[];
}
