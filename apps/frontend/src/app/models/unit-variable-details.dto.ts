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

export interface VariableDetailDto {
  id: string;
  alias: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value';
  hasCodingScheme: boolean;
  codingSchemeRef?: string;
  codes?: CodeInfo[];
  isDerived?: boolean;
  hasManualInstruction?: boolean;
}
