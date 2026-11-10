import { VariableAnalysisOptions } from '../../../../../../api-dto/coding/variable-analysis-options';
import { VariableDetailDto } from '../../models/unit-variable-details.dto';
import { getExplicitSchemaValues, SchemaValueDefinition } from './variable-analysis-schema.util';
import { getAssignedCodeDefinitions } from './variable-analysis-code.util';

export interface VariableAnalysisMetadata {
  coding?: VariableDetailDto['coding'];
  type: VariableDetailDto['type'];
  multiple: boolean;
  categoryDefinitions: SchemaValueDefinition[];
  valuesByPosition: SchemaValueDefinition[];
}

export function getVariableAnalysisMetadata(
  variable: VariableDetailDto,
  options: VariableAnalysisOptions = {}
): VariableAnalysisMetadata {
  const categoryDefinitions = options.analysisMode === 'codes' ?
    getAssignedCodeDefinitions(variable.codes || [], options.codingVersion) : getExplicitSchemaValues(variable);
  const seenValues = new Set(categoryDefinitions.map(definition => definition.value));

  if (options.analysisMode === 'codes') {
    return {
      type: variable.type, multiple: variable.multiple === true, categoryDefinitions, valuesByPosition: []
    };
  }

  (variable.values || []).forEach(valueInfo => {
    const value = String(valueInfo.value);
    if (seenValues.has(value)) {
      return;
    }
    seenValues.add(value);
    categoryDefinitions.push({
      value,
      label: valueInfo.label,
      order: categoryDefinitions.length
    });
  });

  const variableValues = variable.values || [];
  const valuePositionLabels = variable.valuePositionLabels || [];
  const positionCount = Math.max(
    variableValues.length,
    valuePositionLabels.length
  );
  const valuesByPosition: SchemaValueDefinition[] = [];
  Array.from({ length: positionCount }).forEach((_, index) => {
    const variableValue = variableValues[index]?.value;
    const label =
      valuePositionLabels[index] ||
      variableValues[index]?.label ||
      String(variableValue ?? index + 1);
    valuesByPosition.push({
      value: variableValue !== undefined ?
        String(variableValue) :
        String(index + 1),
      label,
      order: index
    });
  });

  valuesByPosition.forEach(positionValue => {
    if (seenValues.has(positionValue.value)) {
      return;
    }
    seenValues.add(positionValue.value);
    categoryDefinitions.push({
      ...positionValue,
      order: categoryDefinitions.length
    });
  });

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
