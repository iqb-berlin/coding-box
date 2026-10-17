import { execFileSync } from 'node:child_process';
import { CodingSchemeFactory as Reference } from '@iqb/responses-legacy-reference';
import { CodingSchemeFactory as Current } from '@iqb/responses';
import { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { ConfigOptions } from 'mathjs';
import { CodingSchemeFactory as Compatible } from './generated/autocoder-compatibility-engine';

const statuses = [
  'UNSET', 'NOT_REACHED', 'DISPLAYED', 'VALUE_CHANGED', 'DERIVE_ERROR', 'CODING_COMPLETE',
  'NO_CODING', 'INVALID', 'CODING_INCOMPLETE', 'CODING_ERROR', 'PARTLY_DISPLAYED',
  'DERIVE_PENDING', 'INTENDED_INCOMPLETE', 'CODE_SELECTION_PENDING'
];
const values = [null, '', 0, 1, -1, 2.5, '0', '2.5', 'a', false, true, [1, 2], [null, 1], ['a', 'b']];
const sourceTypes = ['MANUAL', 'COPY_VALUE', 'CONCAT_CODE', 'SUM_CODE', 'SUM_SCORE', 'UNIQUE_VALUES', 'SOLVER'] as const;
const solverReference = (variable: string): string => `\${${variable}}`;
const expressions = [
  `${solverReference('A')}+${solverReference('B')}`, `${solverReference('A:0:0')}+${solverReference('B:INC:0')}`, `${solverReference('A')} > 0 ? null : ${solverReference('B')}`, `${solverReference('A')} > 0 ? ${solverReference('B')} : null`,
  `${solverReference('A')} / ${solverReference('B')}`, `${solverReference('A')} == ${solverReference('B')} ? 1 : 0`, `round(${solverReference('A')}/${solverReference('B')},2)`, 'null', 'null + 0'
];
const codes: VariableCodingData['codes'] = [
  {
    id: 9, type: 'FULL_CREDIT', score: 9, ruleSets: [{ rules: [{ method: 'IS_NULL' }] }]
  },
  ...[0, 1].map(id => ({
    id,
    type: 'FULL_CREDIT' as const,
    score: id,
    ruleSets: [{ rules: [{ method: 'NUMERIC_MATCH' as const, parameters: [String(id)] }] }]
  })),
  {
    id: 3, type: 'RESIDUAL_AUTO', score: 3, ruleSets: []
  }
];
const serializedInput = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('Responses 5.3.1 with the original Kodierbox solver contract', () => {
  it('keeps the generated engine reproducible from the installed current package', () => {
    execFileSync(process.execPath, ['scripts/build-autocoder-compat.mjs', '--check'], {
      cwd: process.cwd(), stdio: 'pipe'
    });
  });

  it.each(sourceTypes)('matches the independent 5.2.0 reference for %s', sourceType => {
    let comparisons = 0;
    for (const status of statuses) {
      for (const value of values) {
        for (const aliases of [false, true]) {
          for (const subform of [undefined, 'S']) {
            for (const expression of sourceType === 'SOLVER' ? expressions : ['']) {
              const scheme: VariableCodingData[] = [
                {
                  id: 'A', alias: aliases ? 'OUT_A' : undefined, sourceType: 'BASE', codes
                },
                {
                  id: 'B', alias: aliases ? 'OUT_B' : undefined, sourceType: 'BASE', codes
                },
                {
                  id: 'D',
                  alias: aliases ? 'OUT_D' : undefined,
                  sourceType,
                  deriveSources: sourceType === 'COPY_VALUE' ? ['A'] : ['A', 'B'],
                  sourceParameters: { processing: [], solverExpression: expression },
                  codes
                }
              ];
              const input = [
                {
                  id: aliases ? 'OUT_A' : 'A', status, value, subform, code: 0, score: 0, codes: [{ id: 0 }]
                },
                {
                  id: aliases ? 'OUT_B' : 'B', status: 'CODING_COMPLETE', value: 2, code: 2, score: 2, subform
                }
              ];
              expect(Compatible.code(serializedInput(input), scheme)).toEqual(Reference.code(serializedInput(input), scheme));
              comparisons += 1;
            }
          }
        }
      }
    }
    expect(comparisons).toBe(sourceType === 'SOLVER' ? 7056 : 784);
  });

  it('preserves existing derived targets, pending states and structural no-value variables', () => {
    for (const status of statuses) {
      for (const expression of [`ceil(${solverReference('A')})`, `${solverReference('A')} > 0 ? null : ${solverReference('A')}`]) {
        const scheme: VariableCodingData[] = [
          { id: 'A', sourceType: 'BASE', codes },
          { id: 'N', sourceType: 'BASE_NO_VALUE', codes: [] },
          {
            id: 'D',
            sourceType: 'SOLVER',
            deriveSources: ['A'],
            sourceParameters: {
              processing: [], solverExpression: expression
            },
            codes
          }
        ];
        const input = [
          { id: 'A', value: 1e-15, status: 'VALUE_CHANGED' },
          { id: 'N', value: null, status: 'UNSET' },
          {
            id: 'D', value: 222, status, code: 7, score: 7
          }
        ];
        expect(Compatible.code(serializedInput(input), scheme)).toEqual(Reference.code(serializedInput(input), scheme));
      }
    }
  });

  it.each([
    [`ceil(${solverReference('A')})`, 1e-15, 1], [`${solverReference('A')} == 0 ? 1 : 0`, 1e-15, 0],
    [`floor(${solverReference('A')})`, -1e-15, -1], [`${solverReference('A')} > 0 ? null : ${solverReference('A')}`, 1, null],
    ['min(null)', 1, null], ['max(null)', 1, null], ['1 / 0', 1, null], ['sqrt(-1)', 1, null]
  ])('preserves %s including a dependent score sum and separate subforms', (expression, value, expected) => {
    const scheme: VariableCodingData[] = [
      { id: 'A', sourceType: 'BASE', codes: [{ id: 1, type: 'RESIDUAL_AUTO', score: 1 }] },
      {
        id: 'D',
        sourceType: 'SOLVER',
        deriveSources: ['A'],
        sourceParameters: { processing: [], solverExpression: String(expression) },
        codes
      },
      {
        id: 'S', sourceType: 'SUM_SCORE', deriveSources: ['D', 'A'], codes
      }
    ];
    const input = ['first', 'second'].map(subform => ({
      id: 'A', value, subform, status: 'VALUE_CHANGED'
    }));
    const actual = Compatible.code(serializedInput(input), scheme);
    expect(actual).toEqual(Reference.code(serializedInput(input), scheme));
    for (const subform of ['first', 'second']) {
      const derived = actual.find(r => r.id === 'D' && r.subform === subform);
      expect(derived?.value).toBe(expected);
      expect(derived?.status).toBe(expected === null ? 'DERIVE_ERROR' : 'CODING_COMPLETE');
      expect(actual.find(r => r.id === 'S' && r.subform === subform)?.status)
        .toBe(expected === null ? 'DERIVE_ERROR' : 'CODING_COMPLETE');
    }
  });

  it('does not modify global math configuration or the normal Responses factory', () => {
    // The default mathjs 12 entry has a read-only config() getter. Its .d.ts
    // incorrectly reuses the configurable instance's required argument.
    const math = jest.requireActual<{ config: () => ConfigOptions }>('mathjs');
    const configuration = math.config();
    const factory = Current.code;
    const scheme: VariableCodingData[] = [
      { id: 'A', sourceType: 'BASE', codes: [{ id: 1, type: 'RESIDUAL_AUTO', score: 1 }] },
      {
        id: 'D',
        sourceType: 'SOLVER',
        deriveSources: ['A'],
        sourceParameters: {
          processing: [], solverExpression: `ceil(${solverReference('A')})`
        },
        codes
      }
    ];
    const input = [{ id: 'A', value: 1e-15, status: 'VALUE_CHANGED' }];
    const before = Current.code(serializedInput(input), scheme);
    expect(Compatible.code(serializedInput(input), scheme).find(r => r.id === 'D')?.value).toBe(1);
    expect(Current.code(serializedInput(input), scheme)).toEqual(before);
    expect(before.find(r => r.id === 'D')?.value).toBe(0);
    expect(Current.code).toBe(factory);
    expect(math.config()).toEqual(configuration);
  });

  it.each([
    'config({epsilon:0.1}).epsilon',
    'evaluate("config({epsilon:0.1}).epsilon")',
    'parser().evaluate("config({epsilon:0.1}).epsilon")'
  ])('keeps the original read-only solver configuration for %s', expression => {
    const scheme: VariableCodingData[] = [
      { id: 'A', sourceType: 'BASE', codes },
      {
        id: 'D',
        sourceType: 'SOLVER',
        deriveSources: ['A'],
        sourceParameters: {
          processing: [], solverExpression: expression
        },
        codes
      }
    ];
    const input = [{
      id: 'A', value: 1, status: 'CODING_COMPLETE', code: 1, score: 1
    }];
    expect(Compatible.code(serializedInput(input), scheme)).toEqual(Reference.code(serializedInput(input), scheme));
    expect(Compatible.code(serializedInput(input), scheme).find(r => r.id === 'D')?.status).toBe('DERIVE_ERROR');
    scheme[1].sourceParameters!.solverExpression = `ceil(${solverReference('A')})`;
    input[0].value = 1e-15;
    expect(Compatible.code(serializedInput(input), scheme).find(r => r.id === 'D')?.value).toBe(1);
  });
});
