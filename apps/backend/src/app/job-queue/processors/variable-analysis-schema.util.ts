import { CodingFactory } from '@iqb/responses';
import { VariableDetailDto } from '../../models/unit-variable-details.dto';

export interface SchemaValueDefinition {
  value: string;
  label?: string;
  score?: number;
  order: number;
  isFromSchema?: boolean;
}

type AnalysisVariable = Pick<VariableDetailDto, 'coding' | 'type' | 'multiple'>;

/** Resolve the complete raw answer using the same rule engine as autocoding. */
export function resolveSchemaValue(
  value: string | null,
  variable: AnalysisVariable
): SchemaValueDefinition | undefined {
  const { coding } = variable;
  // A whole-response code cannot be assigned to individual array categories.
  if (!coding?.codes?.length || variable.multiple || variable.type === 'json' || variable.type === 'attachment') {
    return undefined;
  }
  const responseValue = variable.type === 'boolean' && value !== null && ['true', 'false'].includes(value) ?
    value === 'true' : value;
  const response = {
    id: coding.id,
    status: 'VALUE_CHANGED' as const,
    value: responseValue
  };
  const result = CodingFactory.code(response, coding);
  if (!['CODING_COMPLETE', 'INVALID', 'INTENDED_INCOMPLETE'].includes(result.status)) {
    return undefined;
  }
  const codeId = ['INVALID', 'INTENDED_INCOMPLETE'].includes(result.status) ?
    result.status : result.code;
  let order = coding.codes.findIndex(code => code.id === codeId);
  if (result.status === 'INTENDED_INCOMPLETE') {
    const fallbackOrder = coding.codes.findIndex(code => code.id === result.code && code.type === 'INTENDED_INCOMPLETE');
    // Matched special IDs are returned as code 0, which may also be a numeric fallback ID.
    const matchedSpecialCode = order >= 0 && coding.codes[order].type !== 'INTENDED_INCOMPLETE' &&
      CodingFactory.code(response, { ...coding, codes: [coding.codes[order]] }).status === 'INTENDED_INCOMPLETE';
    if (fallbackOrder >= 0 && (result.code !== 0 || !matchedSpecialCode)) {
      order = fallbackOrder;
    }
  }
  if (order < 0) {
    return undefined;
  }
  return {
    value: value ?? '',
    label: coding.codes[order].label || String(coding.codes[order].id),
    score: result.score,
    order,
    isFromSchema: true
  };
}

/** Only literal, scalar alternatives can supply additional frequency rows. */
export function getExplicitSchemaValues(variable: AnalysisVariable): SchemaValueDefinition[] {
  if (variable.multiple || variable.coding?.fragmenting) {
    return [];
  }
  const candidates = new Set<string>();
  variable.coding?.codes?.forEach(code => {
    code.ruleSets?.forEach(ruleSet => {
      ruleSet.rules.forEach(rule => {
        if (rule.method === 'MATCH' || rule.method === 'NUMERIC_MATCH') {
          rule.parameters?.forEach(parameter => {
            parameter.split(/\r?\n/).filter(value => value !== '').forEach(value => candidates.add(value));
          });
        } else if (rule.method === 'IS_TRUE' || rule.method === 'IS_FALSE') {
          candidates.add(rule.method === 'IS_TRUE' ? 'true' : 'false');
        }
      });
    });
  });
  return [...candidates].flatMap(value => {
    const definition = resolveSchemaValue(value, variable);
    return definition ? [definition] : [];
  });
}
