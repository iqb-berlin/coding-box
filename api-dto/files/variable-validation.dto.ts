export interface InvalidVariableDto {
  fileName: string;
  variableId: string;
  value: string;
  responseId?: number;
}

export interface VariableValidationDto {
  checkedFiles: number;
  invalidVariables: InvalidVariableDto[];
}
