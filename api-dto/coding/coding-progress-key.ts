import type { ReplayCodingSessionUnitDto } from './replay-coding-session.dto';

type JobPerson = Pick<ReplayCodingSessionUnitDto, 'personLogin' | 'personCode' | 'bookletName'> & { personGroup?: string | null };

export function jobTestPerson(unit: JobPerson): string {
  return [unit.personLogin, unit.personCode, ...(unit.personGroup ? [unit.personGroup] : []), unit.bookletName].join('@');
}

/** Legacy person/unit/variable keys remain valid for unambiguous cases. */
export function codingProgressKeyForResponse(key: string, responseId?: number): string {
  return responseId === undefined ? key : `response:${responseId}::${key}`;
}

export function parseCodingProgressKey(key: string) {
  const parts = key.split('::');
  const id = /^response:(\d+)$/.exec(parts[0]);
  if (id) parts.shift();
  const [testPerson, , unitId, ...variable] = parts;
  if (variable.length === 0) return null;
  return { testPerson, unitId, variableId: variable.join('::'), responseId: id ? Number(id[1]) : undefined };
}

export function jobProgressKey(unit: JobPerson & Pick<ReplayCodingSessionUnitDto, 'unitName' | 'variableId' | 'progressResponseId'>): string {
  const key = `${jobTestPerson(unit)}::${unit.bookletName || 'default'}::${unit.unitName}::${unit.variableId}`;
  return codingProgressKeyForResponse(key, unit.progressResponseId);
}
