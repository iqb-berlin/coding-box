export class VariableFrequencyDto {
  unitId?: number;
  unitName?: string;
  variableId: string;
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  percentage: number;
}
