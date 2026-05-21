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
