import type { CodingSchemeProblem } from '@iqb/responses/coding-interfaces';
import * as Autocoder from '@iqb/responses';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { applyAutocoderSchemaValidationMode } from './autocoder-schema-validation.util';

const problem = (
  type: CodingSchemeProblem['type'],
  breaking = true
): CodingSchemeProblem => ({
  type,
  breaking,
  variableId: 'variable-1',
  variableLabel: 'Variable 1'
});

const baseVariable = (
  id: string,
  type: VariableInfo['type']
): VariableInfo => ({
  id,
  type,
  format: '',
  multiple: false,
  nullable: true,
  values: [],
  valuePositionLabels: []
});

const coding = (
  id: string,
  sourceType: VariableCodingData['sourceType'],
  deriveSources?: string[]
): VariableCodingData => ({ id, sourceType, deriveSources });

describe('applyAutocoderSchemaValidationMode', () => {
  it('keeps all breaking problems blocking in strict mode', () => {
    const problems = [
      problem('INVALID_SOURCE'),
      problem('SOURCE_MISSING'),
      problem('RULE_REGEX_INVALID'),
      problem('VACANT', false)
    ];

    expect(applyAutocoderSchemaValidationMode(
      problems,
      'strict',
      [],
      []
    )).toEqual({
      blockingProblems: problems.slice(0, 3),
      toleratedProblems: []
    });
  });

  it.each([
    ['BASE', 'no-value'],
    ['BASE_NO_VALUE', 'string']
  ] as const)(
    'tolerates a legacy %s mismatch against %s in compatible mode',
    (sourceType, variableType) => {
      const invalidSource = problem('INVALID_SOURCE');

      expect(applyAutocoderSchemaValidationMode(
        [invalidSource],
        'compatible',
        [baseVariable('variable-1', variableType)],
        [coding('variable-1', sourceType)]
      )).toEqual({
        blockingProblems: [],
        toleratedProblems: [invalidSource]
      });
    }
  );

  it('tolerates a missing legacy BASE_NO_VALUE variable', () => {
    const missingSource = problem('SOURCE_MISSING');

    expect(applyAutocoderSchemaValidationMode(
      [missingSource],
      'compatible',
      [],
      [coding('variable-1', 'BASE_NO_VALUE')]
    )).toEqual({
      blockingProblems: [],
      toleratedProblems: [missingSource]
    });
  });

  it('blocks a missing BASE variable in compatible mode', () => {
    const missingSource = problem('SOURCE_MISSING');

    expect(applyAutocoderSchemaValidationMode(
      [missingSource],
      'compatible',
      [],
      [coding('variable-1', 'BASE')]
    )).toEqual({
      blockingProblems: [missingSource],
      toleratedProblems: []
    });
  });

  it('keeps non-source and nonbreaking problems unchanged', () => {
    const sourceMismatch = problem('INVALID_SOURCE');
    const invalidRule = problem('RULE_PARAMETER_INVALID');
    const vacant = problem('VACANT', false);

    expect(applyAutocoderSchemaValidationMode(
      [sourceMismatch, invalidRule, vacant],
      'compatible',
      [baseVariable('variable-1', 'string')],
      [coding('variable-1', 'BASE_NO_VALUE')]
    )).toEqual({
      blockingProblems: [invalidRule],
      toleratedProblems: [sourceMismatch]
    });
  });

  it('blocks missing derived sources in compatible mode', () => {
    const missingSource = problem('SOURCE_MISSING');

    expect(applyAutocoderSchemaValidationMode(
      [missingSource],
      'compatible',
      [],
      [coding('variable-1', 'SUM_SCORE', ['missing-variable'])]
    )).toEqual({
      blockingProblems: [missingSource],
      toleratedProblems: []
    });
  });

  it('blocks duplicate coding IDs in compatible mode', () => {
    const invalidSource = problem('INVALID_SOURCE');

    expect(applyAutocoderSchemaValidationMode(
      [invalidSource],
      'compatible',
      [baseVariable('variable-1', 'no-value')],
      [
        coding('variable-1', 'BASE'),
        coding('variable-1', 'BASE')
      ]
    )).toEqual({
      blockingProblems: [invalidSource],
      toleratedProblems: []
    });
  });

  it('blocks duplicate base variables in compatible mode', () => {
    const invalidSource = problem('INVALID_SOURCE');

    expect(applyAutocoderSchemaValidationMode(
      [invalidSource],
      'compatible',
      [
        baseVariable('variable-1', 'no-value'),
        baseVariable('variable-1', 'no-value')
      ],
      [coding('variable-1', 'BASE')]
    )).toEqual({
      blockingProblems: [invalidSource],
      toleratedProblems: []
    });
  });

  it.each([
    ['BASE', 'no-value'],
    ['BASE_NO_VALUE', 'string']
  ] as const)(
    'tolerates the actual validator result for %s against %s',
    (sourceType, variableType) => {
      const baseVariables = [baseVariable('variable-1', variableType)];
      const variableCodings = [coding('variable-1', sourceType)];
      const problems = Autocoder.CodingSchemeFactory.validate(
        baseVariables,
        variableCodings
      );

      expect(problems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'INVALID_SOURCE',
          breaking: true,
          variableId: 'variable-1'
        })
      ]));
      expect(applyAutocoderSchemaValidationMode(
        problems,
        'compatible',
        baseVariables,
        variableCodings
      ).blockingProblems).toEqual([]);
    }
  );

  it('tolerates the actual validator result for a missing BASE_NO_VALUE', () => {
    const variableCodings = [coding('variable-1', 'BASE_NO_VALUE')];
    const problems = Autocoder.CodingSchemeFactory.validate(
      [],
      variableCodings
    );

    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SOURCE_MISSING',
        breaking: true,
        variableId: 'variable-1'
      })
    ]));
    expect(applyAutocoderSchemaValidationMode(
      problems,
      'compatible',
      [],
      variableCodings
    ).blockingProblems).toEqual([]);
  });
});
