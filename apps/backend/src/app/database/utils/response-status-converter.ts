import { ResponseStatusType } from '@iqbspecs/response/response.interface';

const responseStatesNumericMap: { key: number; value: string }[] = [
  { key: 0, value: 'UNSET' },
  { key: 1, value: 'NOT_REACHED' },
  { key: 2, value: 'DISPLAYED' },
  { key: 3, value: 'VALUE_CHANGED' },
  { key: 4, value: 'DERIVE_ERROR' },
  { key: 5, value: 'CODING_COMPLETE' },
  { key: 6, value: 'NO_CODING' },
  { key: 7, value: 'INVALID' },
  { key: 8, value: 'CODING_INCOMPLETE' },
  { key: 9, value: 'CODING_ERROR' },
  { key: 10, value: 'PARTLY_DISPLAYED' },
  { key: 11, value: 'DERIVE_PENDING' },
  { key: 12, value: 'INTENDED_INCOMPLETE' },
  { key: 13, value: 'CODE_SELECTION_PENDING' }
];

const stringToNumberMap = new Map(responseStatesNumericMap.map(entry => [entry.value, entry.key]));
const numberToStringMap = new Map(responseStatesNumericMap.map(entry => [entry.key, entry.value]));

/**
 * Converts a status number to the corresponding ResponseStatusType string.
 * @param statusNumber The numeric status value
 * @returns The string representation of the status, or null if not found
 */
export function statusNumberToString(statusNumber: number): ResponseStatusType | null {
  return (numberToStringMap.get(statusNumber) as ResponseStatusType) || null;
}

/**
 * Converts a ResponseStatusType string to the corresponding numeric status.
 * @param statusString The string status value
 * @returns The numeric representation of the status, or null if not found
 */
export function statusStringToNumber(statusString: string): number | null {
  const numericStatus = parseInt(statusString, 10);
  if (!Number.isNaN(numericStatus) && numberToStringMap.has(numericStatus)) {
    return numericStatus;
  }
  return stringToNumberMap.get(statusString) ?? null;
}
