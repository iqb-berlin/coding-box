import { UnitVariableValueDto } from './unit-variable-value.dto';

/**
 * Data transfer object for a unit variable
 * Based on the Variable element in unit.xsd schema
 */
export class UnitVariableDto {
  id!: string;
  alias?: string;
  type!: 'string' | 'integer' | 'number' | 'boolean' | 'attachment' | 'json' | 'no-value';
  format?: string;
  multiple?: boolean;
  nullable?: boolean;
  page?: string;
  values?: UnitVariableValueDto[];
  valuesComplete?: boolean;
  valuePositionLabels?: string[];
}
