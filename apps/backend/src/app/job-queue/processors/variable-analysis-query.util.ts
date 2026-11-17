import { VariableAnalysisOptions } from '../../../../../../api-dto/coding/variable-analysis-options';
import {
  VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN,
  VARIABLE_ANALYSIS_INVALID_RAW_STATUSES,
  VARIABLE_ANALYSIS_VALID_CODE_STATUSES
} from '../../../../../../api-dto/coding/variable-analysis-rules';
import { getAssignedCodeKeySql } from './variable-analysis-code.util';

export function getEmptyVariableAnalysisValueSql(column: string): string {
  return `(${column} IS NULL OR ${column} ~* '${VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN}')`;
}

/** Only fixed identifiers are selected here; request data never becomes SQL. */
export function getVariableAnalysisColumns(options: VariableAnalysisOptions): {
  value: string; status: string; valid: string;
} {
  if (options.analysisMode !== 'codes') {
    return {
      value: 'response.value',
      status: 'response.status',
      valid: `NOT ${getEmptyVariableAnalysisValueSql('response.value')} AND COALESCE(response.status, 0) NOT IN (${VARIABLE_ANALYSIS_INVALID_RAW_STATUSES.join(', ')})`
    };
  }

  const { code, status } = {
    v1: { code: 'response.code_v1', status: 'response.status_v1' },
    v2: { code: 'response.code_v2', status: 'response.status_v2' },
    v3: { code: 'response.code_v3', status: 'response.status_v3' }
  }[options.codingVersion ?? 'v1'];
  return {
    value: getAssignedCodeKeySql(code, status),
    status,
    valid: `${code} IS NOT NULL AND ${status} IN (${VARIABLE_ANALYSIS_VALID_CODE_STATUSES.join(', ')})`
  };
}
