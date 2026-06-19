import {
  getMathTextResponseIds,
  normalizeMathTextReplayDataParts
} from './replay-data-parts-normalization';

describe('replay data parts normalization', () => {
  it('normalizes empty array values for math-text-mix variables', () => {
    const dataParts = {
      chunk1: JSON.stringify([
        { id: '02b', value: [], status: 2 },
        { id: 'other', value: ['kept'], status: 2 }
      ])
    };

    const normalized = normalizeMathTextReplayDataParts(dataParts, {
      BaseVariables: {
        Variable: [
          {
            id: '02b',
            alias: '02b_alias',
            type: 'json',
            format: 'math-text-mix'
          },
          { id: 'other', type: 'json' }
        ]
      }
    });

    const responses = JSON.parse(normalized.chunk1);
    expect(responses[0].value).toBe('[]');
    expect(responses[1].value).toEqual(['kept']);
  });

  it('normalizes token array values for text-area-math elements', () => {
    const value = [
      { type: 'text', value: '' },
      { type: 'formula', value: 'x^2' }
    ];
    const dataParts = {
      chunk1: JSON.stringify([{ id: 'formula_1', value, status: 3 }])
    };

    const normalized = normalizeMathTextReplayDataParts(dataParts, {
      pages: [{
        sections: [{
          elements: [{ id: 'formula_1', type: 'text-area-math' }]
        }]
      }]
    });

    const [response] = JSON.parse(normalized.chunk1);
    expect(response.value).toBe(JSON.stringify(value));
  });

  it('keeps already stringified math text values unchanged', () => {
    const dataParts = {
      chunk1: JSON.stringify([{ id: '02b', value: '[]', status: 2 }])
    };

    const normalized = normalizeMathTextReplayDataParts(dataParts, {
      BaseVariables: {
        Variable: [{ id: '02b', type: 'json', format: 'math-text-mix' }]
      }
    });

    const [response] = JSON.parse(normalized.chunk1);
    expect(response.value).toBe('[]');
  });

  it('keeps array values for other variables unchanged', () => {
    const dataParts = {
      chunk1: JSON.stringify([{ id: 'choice_1', value: [true, false], status: 3 }])
    };

    const normalized = normalizeMathTextReplayDataParts(dataParts, {
      pages: [{
        sections: [{
          elements: [{ id: 'formula_1', type: 'text-area-math' }]
        }]
      }]
    });

    const [response] = JSON.parse(normalized.chunk1);
    expect(response.value).toEqual([true, false]);
  });

  it('uses aliases from math-text-mix variable definitions', () => {
    const dataParts = {
      chunk1: JSON.stringify([{ id: '02b_alias', value: [], status: 2 }])
    };

    const normalized = normalizeMathTextReplayDataParts(dataParts, {
      Unit: {
        BaseVariables: [{
          Variable: [{
            $: {
              id: '02b',
              alias: '02b_alias',
              type: 'json',
              format: 'math-text-mix'
            }
          }]
        }]
      }
    });

    const [response] = JSON.parse(normalized.chunk1);
    expect(response.value).toBe('[]');
  });

  it('extracts ids from both modern json and xml2js style definitions', () => {
    const responseIds = getMathTextResponseIds({
      pages: [{
        sections: [{
          elements: [{ id: 'formula_1', type: 'text-area-math' }]
        }]
      }],
      Unit: {
        BaseVariables: [{
          Variable: [{
            $: {
              id: '02b',
              alias: '02b_alias',
              format: 'math-text-mix'
            }
          }]
        }]
      }
    });

    expect(responseIds).toEqual(new Set(['formula_1', '02b', '02b_alias']));
  });
});
