import { spawnSync } from 'node:child_process';
import {
  isEmptyVariableAnalysisValue,
  isValidVariableAnalysisRawValue,
  VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN
} from '../../../../../../api-dto/coding/variable-analysis-rules';

describe('Variable analysis empty values', () => {
  it.each([
    null, undefined, '', ' \t\r\n', '\u00a0\u2003\ufeff',
    '[]', ' [ \t ] \n', '[false]', ' [ false, FALSE ] '
  ])('recognizes the empty representation %j', value => {
    expect(isEmptyVariableAnalysisValue(value)).toBe(true);
    expect(isValidVariableAnalysisRawValue(value, 3)).toBe(false);
  });

  it.each(['null', 'false', '0', '[true,false]', '["A"]', '"[]"', '[false,]', ' [ false ] x '])(
    'retains the non-empty value %j', value => {
      expect(isEmptyVariableAnalysisValue(value)).toBe(false);
      expect(isValidVariableAnalysisRawValue(value, 3)).toBe(true);
    }
  );

  it('finishes long whitespace-prefixed values within a bounded child process', () => {
    // A separate process lets the timeout stop a backtracking regression without
    // blocking the Jest worker. The old pattern takes seconds for a single value.
    const result = spawnSync(process.execPath, ['-e', `
      const pattern = require('node:fs').readFileSync(0, 'utf8');
      const empty = new RegExp(pattern, 'i');
      const padding = ' '.repeat(100000);
      const values = [padding, padding + '["A"]', padding + 'x',
        padding + '[ false, FALSE ]' + padding, '[' + padding + ']'];
      process.stdout.write(JSON.stringify(values.map(value => empty.test(value))));
    `], {
      input: VARIABLE_ANALYSIS_EMPTY_VALUE_PATTERN,
      encoding: 'utf8',
      timeout: 3000,
      killSignal: 'SIGKILL'
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, false, false, true, true]);
  });
});
