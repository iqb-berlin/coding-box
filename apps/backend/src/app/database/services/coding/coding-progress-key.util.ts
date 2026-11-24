import { codingProgressKeyForResponse } from '../../../../../../../api-dto/coding/coding-progress-key';

export interface CodingTestPersonParts {
  login: string;
  code: string;
  group?: string;
  booklet: string;
}

export function parseCodingTestPerson(testPerson: string): CodingTestPersonParts {
  const parts = (testPerson || '').split('@');
  const booklet = parts[parts.length - 1] || '';

  return {
    login: parts[0] || '',
    code: parts[1] || '',
    group: parts.length === 4 ? parts[2] : undefined,
    booklet
  };
}

export function formatCodingTestPerson(parts: CodingTestPersonParts): string {
  if (parts.group !== undefined && parts.group !== null && parts.group !== '') {
    return `${parts.login}@${parts.code}@${parts.group}@${parts.booklet}`;
  }

  return `${parts.login}@${parts.code}@${parts.booklet}`;
}

export function formatCodingTestPersonFromUnit(unit: {
  person_login: string;
  person_code: string;
  person_group?: string | null;
  booklet_name: string;
}): string {
  return formatCodingTestPerson({
    login: unit.person_login,
    code: unit.person_code,
    group: unit.person_group || undefined,
    booklet: unit.booklet_name
  });
}

export function generateCodingProgressKey(testPerson: string, unitId: string, variableId: string): string {
  const { booklet } = parseCodingTestPerson(testPerson);
  return `${testPerson}::${booklet || 'default'}::${unitId}::${variableId}`;
}

type ProgressUnit = Parameters<typeof formatCodingTestPersonFromUnit>[0] & {
  response_id: number;
  unit_name: string;
  variable_id: string;
};

function legacyJobUnitProgressKey(unit: ProgressUnit): string {
  return generateCodingProgressKey(formatCodingTestPersonFromUnit(unit), unit.unit_name, unit.variable_id);
}

export function jobUnitProgressKeys(units: ProgressUnit[]) {
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const unit of units) {
    const key = legacyJobUnitProgressKey(unit);
    if (seen.has(key)) ambiguous.add(key);
    seen.add(key);
  }
  const responseIdFor = (unit: ProgressUnit) => (
    ambiguous.has(legacyJobUnitProgressKey(unit)) ? unit.response_id : undefined
  );
  return {
    responseIdFor,
    keyFor: (unit: ProgressUnit) => codingProgressKeyForResponse(legacyJobUnitProgressKey(unit), responseIdFor(unit))
  };
}
