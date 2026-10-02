import { VariableCodingData } from '@iqbspecs/coding-scheme';

export type AutocoderOutputShadow = {
  kind: 'BASE_DERIVED' | 'BASE_NO_VALUE_DERIVED';
  baseTechnicalId: string;
  derivedTechnicalId: string;
};

const normalizeVariableId = (variableId: unknown): string => (
  String(variableId ?? '').toUpperCase()
);

export const createAutocoderOutputShadows = (
  variableCodings: VariableCodingData[]
): AutocoderOutputShadow[] => {
  const codingsByTechnicalId = new Map<string, VariableCodingData[]>();
  const codingsByOutputAlias = new Map<string, VariableCodingData[]>();

  variableCodings.forEach(coding => {
    const technicalId = String(coding.id || '');
    if (!technicalId) {
      throw new Error('coding contains an empty technical variable ID');
    }

    const normalizedTechnicalId = normalizeVariableId(technicalId);
    codingsByTechnicalId.set(normalizedTechnicalId, [
      ...(codingsByTechnicalId.get(normalizedTechnicalId) || []),
      coding
    ]);

    const outputAlias = String(coding.alias || coding.id);
    const normalizedOutputAlias = normalizeVariableId(outputAlias);
    codingsByOutputAlias.set(normalizedOutputAlias, [
      ...(codingsByOutputAlias.get(normalizedOutputAlias) || []),
      coding
    ]);
  });

  const duplicateTechnicalId = Array.from(codingsByTechnicalId.entries())
    .find(([, codings]) => codings.length > 1);
  if (duplicateTechnicalId) {
    throw new Error(
      `duplicate technical variable ID "${duplicateTechnicalId[0]}"`
    );
  }

  const outputShadows: AutocoderOutputShadow[] = [];
  codingsByOutputAlias.forEach((codings, normalizedAlias) => {
    if (codings.length === 1) {
      return;
    }

    const baseCoding = codings.find(coding => (
      coding.sourceType === 'BASE' &&
      normalizeVariableId(coding.id) === normalizedAlias
    ));
    const derivedCodings = codings.filter(coding => (
      coding !== baseCoding &&
      coding.sourceType !== 'BASE' &&
      coding.sourceType !== 'BASE_NO_VALUE' &&
      normalizeVariableId(coding.alias || coding.id) === normalizedAlias &&
      (coding.deriveSources || []).some(source => (
        normalizeVariableId(source) === normalizedAlias
      ))
    ));
    const isAllowedDerivedShadow = Boolean(
      baseCoding &&
      codings.length === 2 &&
      derivedCodings.length === 1
    );

    if (isAllowedDerivedShadow && baseCoding) {
      outputShadows.push({
        kind: 'BASE_DERIVED',
        baseTechnicalId: String(baseCoding.id),
        derivedTechnicalId: String(derivedCodings[0].id)
      });
      return;
    }

    const baseNoValueCoding = codings.find(coding => (
      coding.sourceType === 'BASE_NO_VALUE' &&
      normalizeVariableId(coding.id) !== normalizedAlias &&
      (coding.deriveSources || []).length === 0 &&
      (coding.codes || []).length === 0
    ));
    const baseNoValueDerivedCodings = codings.filter(coding => (
      coding !== baseNoValueCoding &&
      coding.sourceType !== 'BASE' &&
      coding.sourceType !== 'BASE_NO_VALUE' &&
      normalizeVariableId(coding.id) === normalizedAlias &&
      normalizeVariableId(coding.alias || coding.id) === normalizedAlias &&
      (coding.deriveSources || []).length > 0
    ));
    const baseNoValueTechnicalId = baseNoValueCoding ?
      normalizeVariableId(baseNoValueCoding.id) :
      '';
    const isBaseNoValueUsedAsSource = Boolean(
      baseNoValueTechnicalId &&
      variableCodings.some(coding => (
        (coding.deriveSources || []).some(source => (
          normalizeVariableId(source) === baseNoValueTechnicalId
        ))
      ))
    );
    const isAllowedBaseNoValueShadow = Boolean(
      baseNoValueCoding &&
      codings.length === 2 &&
      baseNoValueDerivedCodings.length === 1 &&
      !isBaseNoValueUsedAsSource
    );

    if (!isAllowedBaseNoValueShadow || !baseNoValueCoding) {
      throw new Error(`duplicate output alias "${normalizedAlias}"`);
    }

    outputShadows.push({
      kind: 'BASE_NO_VALUE_DERIVED',
      baseTechnicalId: String(baseNoValueCoding.id),
      derivedTechnicalId: String(baseNoValueDerivedCodings[0].id)
    });
  });

  return outputShadows;
};
