import { VariableDetailDto } from '../../models/unit-variable-details.dto';
import { getExplicitSchemaValues, resolveSchemaValue } from './variable-analysis-schema.util';

const animals: VariableDetailDto = {
  id: 'ANIMALS',
  alias: 'animals',
  type: 'string',
  hasCodingScheme: true,
  coding: {
    id: 'ANIMALS',
    sourceType: 'BASE',
    processing: ['IGNORE_CASE', 'IGNORE_DISPENSABLE_SPACES'],
    codes: [
      {
        id: 7, label: 'Fisch', score: 1, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Hai\nHay'] }] }]
      },
      {
        id: 9, label: 'Tier mit Z', score: 0, ruleSets: [{ rules: [{ method: 'MATCH_REGEX', parameters: ['^Z.*'] }] }]
      }
    ]
  }
};

describe('variable analysis schema values', () => {
  it('keeps raw spelling and uses processing rules without equating values with code ids', () => {
    expect(resolveSchemaValue('  hAI  ', animals)).toMatchObject({
      value: '  hAI  ', label: 'Fisch', score: 1, isFromSchema: true
    });
    expect(resolveSchemaValue('7', animals)).toBeUndefined();
    expect(getExplicitSchemaValues(animals).map(row => row.value)).toEqual(['Hai', 'Hay']);
  });

  it('accepts default array and fragment settings on scalar rules', () => {
    const variable: VariableDetailDto = {
      ...animals,
      coding: {
        id: 'V',
        sourceType: 'BASE',
        codes: [{
          id: 1, score: 1, ruleSets: [{ valueArrayPos: 'ANY', rules: [{ method: 'MATCH', fragment: 0, parameters: ['Hai'] }] }]
        }]
      }
    };
    expect(getExplicitSchemaValues(variable).map(row => row.value)).toEqual(['Hai']);
  });

  it('annotates observed regex matches without enumerating the regex as an answer', () => {
    expect(resolveSchemaValue('Zebra', animals)).toMatchObject({ score: 0, isFromSchema: true });
    expect(getExplicitSchemaValues(animals).map(row => row.value)).not.toContain('^Z.*');
  });

  it('respects conjunctions and the first matching code for literal alternatives', () => {
    const variable: VariableDetailDto = {
      ...animals,
      coding: {
        id: 'NUMBERS',
        sourceType: 'BASE',
        codes: [
          {
            id: 8,
            score: 1,
            ruleSets: [{
              ruleOperatorAnd: true,
              rules: [
                { method: 'NUMERIC_MATCH', parameters: ['1\n2\n3'] },
                { method: 'NUMERIC_MORE_THAN', parameters: ['1'] }
              ]
            }]
          },
          { id: 3, score: 0, ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['2'] }] }] }
        ]
      }
    };
    expect(getExplicitSchemaValues(variable).map(row => [row.value, row.score])).toEqual([['2', 1], ['3', 1]]);
    expect(resolveSchemaValue('1', variable)).toBeUndefined();
  });

  it('does not invent answers for ranges or manual instructions', () => {
    const variable: VariableDetailDto = {
      ...animals,
      coding: {
        id: 'V',
        sourceType: 'BASE',
        codes: [
          { id: 1, score: 1, ruleSets: [{ rules: [{ method: 'NUMERIC_RANGE', parameters: ['1', '10'] }] }] },
          { id: 4, score: 0, manualInstruction: 'Andere Tiere' }
        ]
      }
    };
    expect(getExplicitSchemaValues(variable)).toEqual([]);
    expect(resolveSchemaValue('5', variable)).toMatchObject({ score: 1 });
    expect(resolveSchemaValue('Andere Tiere', variable)).toBeUndefined();
  });

  it('handles boolean alternatives as boolean values', () => {
    const variable: VariableDetailDto = {
      ...animals,
      type: 'boolean',
      coding: {
        id: 'BOOL',
        sourceType: 'BASE',
        codes: [
          { id: 5, score: 1, ruleSets: [{ rules: [{ method: 'IS_TRUE' }] }] },
          { id: 6, score: 0, ruleSets: [{ rules: [{ method: 'IS_FALSE' }] }] }
        ]
      }
    };
    expect(getExplicitSchemaValues(variable).map(row => [row.value, row.score])).toEqual([['true', 1], ['false', 0]]);
  });

  it('keeps whole-response coding separate from individual multiple-response categories', () => {
    expect(getExplicitSchemaValues({ ...animals, multiple: true })).toEqual([]);
    expect(resolveSchemaValue('Hai', { ...animals, multiple: true })).toBeUndefined();
  });

  it('does not interpret serialized JSON or attachments as scalar answers', () => {
    expect(resolveSchemaValue('Hai', { ...animals, type: 'json' })).toBeUndefined();
    expect(resolveSchemaValue('Hai', { ...animals, type: 'attachment' })).toBeUndefined();
  });
});
