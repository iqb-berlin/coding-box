import { statusStringToNumber } from './response-status-converter';

function requireStatusNumber(status: string): number {
  const statusNumber = statusStringToNumber(status);
  if (statusNumber === null) {
    throw new Error(`Unknown response status: ${status}`);
  }
  return statusNumber;
}

export const CODING_INCOMPLETE_STATUS = requireStatusNumber('CODING_INCOMPLETE');
export const INTENDED_INCOMPLETE_STATUS = requireStatusNumber('INTENDED_INCOMPLETE');
export const DERIVE_ERROR_STATUS = requireStatusNumber('DERIVE_ERROR');

export const MANUAL_CODING_DEFAULT_CANDIDATE_STATUSES = [
  CODING_INCOMPLETE_STATUS,
  INTENDED_INCOMPLETE_STATUS
];

export interface ManualCodingVariableReference {
  unitName: string;
  variableId: string;
  includeDeriveError?: boolean;
}

export function toManualCodingVariablePairKey(
  unitName: string,
  variableId: string
): string {
  return `${unitName}\u001F${variableId}`;
}

export function getDeriveErrorManualCodingPairKeys(
  variables: ManualCodingVariableReference[]
): string[] {
  return Array.from(new Set(
    variables
      .filter(variable => variable.includeDeriveError === true)
      .map(variable => toManualCodingVariablePairKey(
        variable.unitName,
        variable.variableId
      ))
  ));
}
