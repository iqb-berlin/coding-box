// Explicit ECMAScript whitespace avoids PostgreSQL's locale-dependent \s.
const whitespace = String.raw`[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]`;

/** Shared by the SQL adapter, multiple-response processing, preview and exports. */
// Keep trailing whitespace inside the optional list to avoid quadratic backtracking.
export const VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN = String.raw`^${whitespace}*(\[${whitespace}*(false${whitespace}*(,${whitespace}*false${whitespace}*)*)?\]${whitespace}*)?$`;

export const VARIABLE_ANALYSIS_INVALID_RAW_STATUSES: readonly number[] = [
  0, // UNSET
  1, // NOT_REACHED
  2, // DISPLAYED
  4, // DERIVE_ERROR
  7, // INVALID
  9, // CODING_ERROR
  10 // PARTLY_DISPLAYED
];

export const VARIABLE_ANALYSIS_VALID_CODE_STATUSES: readonly number[] = [
  5, // CODING_COMPLETE
  12 // INTENDED_INCOMPLETE
];

const emptyValue = new RegExp(VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN, 'i');

export function isEmptyVariableAnalysisValue(value: string | null | undefined): boolean {
  return value === null || value === undefined || emptyValue.test(value);
}

export function isValidVariableAnalysisRawValue(
  value: string | null | undefined,
  status: number | null | undefined
): boolean {
  return !isEmptyVariableAnalysisValue(value) &&
    !VARIABLE_ANALYSIS_INVALID_RAW_STATUSES.includes(status ?? 0);
}
