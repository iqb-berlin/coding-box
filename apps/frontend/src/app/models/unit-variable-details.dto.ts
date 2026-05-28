/**
 * Data transfer object for detailed unit variable information
 */
export interface UnitVariableDetailsDto {
  unitName: string;
  unitId: string;
  variables: VariableDetailDto[];
}

export interface CodeInfo {
  id: string | number;
  label: string;
  score?: number;
}

export interface VariableValueInfo {
  value: string;
  label: string;
}

export interface VariableDetailDto {
  id: string;
  alias: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value';
  multiple?: boolean;
  nullable?: boolean;
  hasCodingScheme: boolean;
  codingSchemeRef?: string;
  codes?: CodeInfo[];
  values?: VariableValueInfo[];
  valuesComplete?: boolean;
  valuePositionLabels?: string[];
  isDerived?: boolean;
  hasManualInstruction?: boolean;
  hasClosedCoding?: boolean;
  coderTrainingRequired?: boolean;
}
