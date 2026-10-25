import { VariableCodingData } from '@iqbspecs/coding-scheme';
import { parseStringPromise } from 'xml2js';
import { createAutocoderOutputShadows } from './autocoder-output-shadow.util';

export type UnitCodingSchemeVariable = { id?: string; alias?: string };
type CompatibilityContext = { unitId: string; schemeId: string };

const normalized = (value: unknown): string => String(value ?? '').toUpperCase();
const effectiveAlias = (variable: UnitCodingSchemeVariable): string => variable.alias || variable.id || '';
const describeContext = (context: CompatibilityContext): string => (
  `Das Kodierschema "${context.schemeId}" ist nicht mit der Unit "${context.unitId}" kompatibel: `
);

/** Compare the original namespaces before the autocoder replaces aliases with technical IDs. */
export function getUnitCodingSchemeCompatibilityErrors(
  baseVariables: UnitCodingSchemeVariable[],
  variableCodings: VariableCodingData[],
  context?: CompatibilityContext
): string[] {
  const errors: string[] = [];
  const variablesById = new Map<string, UnitCodingSchemeVariable>();
  const variablesByAlias = new Map<string, UnitCodingSchemeVariable>();
  baseVariables.forEach(variable => {
    if (!variable.id?.trim()) {
      errors.push('Eine Basisvariable der Unit hat keine technische ID.');
      return;
    }
    const id = normalized(variable.id);
    if (variablesById.has(id)) {
      errors.push(`Die technische ID "${variable.id}" ist in der Unit mehrfach vorhanden.`);
    }
    variablesById.set(id, variable);
    const alias = effectiveAlias(variable);
    if (!alias.trim()) {
      errors.push(`Die technische Variable "${variable.id}" hat in der Unit keinen gültigen Alias.`);
    }
    const aliasKey = normalized(alias);
    if (variablesByAlias.has(aliasKey)) {
      errors.push(`Der Alias "${alias}" ist in der Unit mehrfach vorhanden.`);
    }
    variablesByAlias.set(aliasKey, variable);
  });

  try {
    // Reuse the runtime's exact exceptions for permitted BASE/BASE_NO_VALUE derived shadows.
    createAutocoderOutputShadows(variableCodings);
  } catch (error) {
    errors.push(`Das VOCS enthält einen mehrdeutigen Variablennamensraum: ${(error as Error).message}.`);
  }

  const sourceIds = new Set([
    ...variablesById.keys(),
    ...variableCodings.map(coding => normalized(coding.id))
  ]);
  variableCodings.forEach(coding => {
    if (coding.sourceType === 'BASE' || coding.sourceType === 'BASE_NO_VALUE') {
      const variable = variablesById.get(normalized(coding.id));
      if (!variable) {
        // Legacy structural no-value variables may be virtual. The existing engine
        // validation mode still decides whether their source type is supported.
        if (coding.sourceType !== 'BASE_NO_VALUE') {
          errors.push(`Die technische Basisvariable "${coding.id}" des VOCS fehlt in der Unit.`);
        }
        return;
      }
      const unitAlias = effectiveAlias(variable);
      const schemeAlias = effectiveAlias(coding);
      if (!schemeAlias.trim() || normalized(unitAlias) !== normalized(schemeAlias)) {
        errors.push(`Die technische Variable "${coding.id}" hat in der Unit den Alias "${unitAlias}", im VOCS jedoch "${schemeAlias}".`);
      }
      return;
    }
    (coding.deriveSources || []).forEach(source => {
      if (!sourceIds.has(normalized(source))) {
        errors.push(`Die abgeleitete Variable "${coding.id}" verweist auf die fehlende technische Quellvariable "${source}".`);
      }
    });
  });
  return context ? errors.map(error => describeContext(context) + error) : errors;
}

export async function validateUnitCodingSchemeCompatibility(
  unitXml: string,
  variableCodings: VariableCodingData[],
  unitId: string,
  schemeId: string
): Promise<string[]> {
  const context = { unitId, schemeId };
  try {
    const parsed = await parseStringPromise(unitXml, { explicitArray: false });
    if (!parsed?.Unit) return [`${describeContext(context)}Die Unit-XML ist nicht lesbar.`];
    const variables = parsed.Unit.BaseVariables?.Variable || [];
    const baseVariables: UnitCodingSchemeVariable[] = (Array.isArray(variables) ? variables : [variables])
      .map(variable => ({ id: variable.$?.id, alias: variable.$?.alias }));
    return getUnitCodingSchemeCompatibilityErrors(baseVariables, variableCodings, context);
  } catch {
    return [`${describeContext(context)}Die Unit-XML ist nicht lesbar.`];
  }
}
