export class VariableFrequencyDto {
  unitId?: number;
  unitName?: string;
  variableId: string;
  value: string;
  /** One-based Boolean position when the option has no declared value. */
  position?: number;
  /** Emptiness of the complete analysis value, before preview truncation. */
  isEmptyValue?: boolean;
  label?: string;
  score?: number;
  code?: number | string;
  schemaOrder?: number;
  isFromSchema?: boolean;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  validOccurrenceCount?: number;
  percentage: number;
  percentageTotal?: number;
  percentageValid?: number | null;
  pointBiserial?: number | null;
  codePbc?: number | null;
  categoryPbc?: number | null;
}
