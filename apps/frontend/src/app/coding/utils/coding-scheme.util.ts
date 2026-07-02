import { CodingScheme, VariableCoding } from '../../models/coding-interfaces';

export function findVariableCodingByPublicId(
  codingScheme: Pick<CodingScheme, 'variableCodings'> | null | undefined,
  variableId: string | null | undefined
): VariableCoding | undefined {
  const normalizedVariableId = String(variableId || '').trim();
  if (!normalizedVariableId) {
    return undefined;
  }

  const variableCodings = codingScheme?.variableCodings || [];

  return variableCodings.find(variableCoding => (
    String(variableCoding.alias || '').trim() === normalizedVariableId
  )) || variableCodings.find(variableCoding => (
    String(variableCoding.id || '').trim() === normalizedVariableId
  ));
}
