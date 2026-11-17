import { VariableAnalysisOptions } from '../../../../../../api-dto/coding/variable-analysis-options';
import { VariableDetailDto } from '../../models/unit-variable-details.dto';
import { getExplicitSchemaValues, SchemaValueDefinition } from './variable-analysis-schema.util';
import { getAssignedCodeDefinitions } from './variable-analysis-code.util';

export interface VariableAnalysisCategoryDefinition extends SchemaValueDefinition {
  position?: number;
}

export interface VariableAnalysisMetadata {
  coding?: VariableDetailDto['coding'];
  type: VariableDetailDto['type'];
  multiple: boolean;
  categoryDefinitions: VariableAnalysisCategoryDefinition[];
  valuesByPosition: VariableAnalysisCategoryDefinition[];
}

export function getVariableAnalysisMetadata(
  variable: VariableDetailDto,
  options: VariableAnalysisOptions = {}
): VariableAnalysisMetadata {
  const categoryDefinitions: VariableAnalysisCategoryDefinition[] = options.analysisMode === 'codes' ?
    getAssignedCodeDefinitions(variable.codes || [], options.codingVersion) : getExplicitSchemaValues(variable);

  if (options.analysisMode === 'codes') {
    return {
      type: variable.type, multiple: variable.multiple === true, categoryDefinitions, valuesByPosition: []
    };
  }

  const variableValues = variable.values || [];
  const valuePositionLabels = variable.valuePositionLabels || [];
  const booleanMultiple = variable.type === 'boolean' && variable.multiple === true;
  const positionCount = Math.max(variableValues.length, valuePositionLabels.length);
  const valuesByPosition: VariableAnalysisCategoryDefinition[] = Array.from({ length: positionCount }, (_, index) => {
    const valueInfo = variableValues[index];
    const position = booleanMultiple && String(valueInfo?.value ?? '').trim() === '' ? index + 1 : undefined;
    const value = position === undefined && valueInfo ? String(valueInfo.value) : String(index + 1);
    return {
      value,
      label: valuePositionLabels[index] || valueInfo?.label || value,
      order: index,
      position
    };
  });

  const seenKeys = new Set<string | number>(categoryDefinitions.map(definition => definition.value));
  const appendCategory = (definition: VariableAnalysisCategoryDefinition) => {
    const key = definition.position ?? definition.value;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    categoryDefinitions.push({ ...definition, order: categoryDefinitions.length });
  };
  variableValues.forEach((valueInfo, index) => {
    const definition = valuesByPosition[index];
    appendCategory(definition.position === undefined ?
      { value: definition.value, label: valueInfo.label, order: index } : definition);
  });
  valuesByPosition.forEach(appendCategory);

  return {
    coding: variable.coding,
    type: variable.type,
    multiple: variable.multiple === true,
    categoryDefinitions,
    valuesByPosition
  };
}

export function enrichSchemaValueDefinition(
  schemaValue: SchemaValueDefinition,
  definition: SchemaValueDefinition | undefined
): SchemaValueDefinition {
  return {
    ...schemaValue,
    label: definition?.label ?? schemaValue.label,
    score: definition?.score,
    code: definition?.code,
    order: definition?.order ?? schemaValue.order,
    isFromSchema: definition?.isFromSchema
  };
}
