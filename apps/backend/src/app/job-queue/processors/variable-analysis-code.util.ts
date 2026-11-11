import { CodeInfo } from '../../models/unit-variable-details.dto';
import { VariableAnalysisCodingVersion } from '../../../../../../api-dto/coding/variable-analysis-options';
import { statusStringToNumber } from '../../database/utils/response-status-converter';
import { SchemaValueDefinition } from './variable-analysis-schema.util';

const completeStatus = statusStringToNumber('CODING_COMPLETE');
const intendedIncompleteStatus = statusStringToNumber('INTENDED_INCOMPLETE');
const specialCodeIds = ['INVALID', 'INTENDED_INCOMPLETE'] as const;

function assignedCodeKey(code: string | number, status: number): string {
  return `${status}:${code}`;
}

/** Format only at the result boundary, after grouping and schema enrichment. */
export function formatAssignedCodeKey(key: string): string {
  if (key === '') return '';
  const separator = key.indexOf(':');
  const statusKey = key.slice(0, separator);
  const code = key.slice(separator + 1);
  const status = statusKey === 'null' ? null : Number(statusKey);
  const label = status === null ? 'UNSET' : specialCodeIds.find(id => statusStringToNumber(id) === status) ?? status;
  return status === completeStatus ? code : `${code} (${label})`;
}

/** Internal keys describe persisted status/code tuples; special string IDs use code zero. */
export function getAssignedCodeDefinitions(
  codes: CodeInfo[],
  codingVersion: VariableAnalysisCodingVersion = 'v1'
): SchemaValueDefinition[] {
  const definitions = new Map<string, SchemaValueDefinition>();
  codes.forEach((code, order) => {
    const specialId = specialCodeIds.find(id => id === code.id);
    const isNumericIncomplete = typeof code.id === 'number' && code.type === 'INTENDED_INCOMPLETE';
    // Manual assignment completes numeric fallback codes; autocoding retains status 12.
    let statuses = [statusStringToNumber(specialId ?? 'CODING_COMPLETE')];
    if (isNumericIncomplete) {
      statuses = codingVersion === 'v2' ?
        [completeStatus, intendedIncompleteStatus] : [intendedIncompleteStatus, completeStatus];
    }
    statuses.forEach((status, index) => {
      const value = assignedCodeKey(specialId ? 0 : code.id, status);
      const existing = definitions.get(value);
      if (existing) {
        // The stored tuple cannot distinguish these definitions. Do not invent a match.
        delete existing.label;
        delete existing.score;
        if (index === 0) delete existing.isObservedOnly;
        return;
      }
      definitions.set(value, {
        value,
        label: code.label,
        score: specialId ? 0 : code.score,
        order,
        ...(index > 0 ? { isObservedOnly: true } : {})
      });
    });
  });
  return [...definitions.values()];
}

/** Keep non-complete tuples separate before ranking, counting or enriching code rows. */
export function getAssignedCodeKeySql(codeColumn: string, statusColumn: string): string {
  return `CASE
    WHEN ${codeColumn} IS NULL THEN NULL
    ELSE CONCAT(COALESCE(CAST(${statusColumn} AS text), 'null'), ':', CAST(${codeColumn} AS text))
  END`;
}
