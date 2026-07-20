import {
  buildAggregationPeerLookupKeys,
  buildAggregationPeerKeys,
  buildAggregationGroups,
  countEffectiveManualCodingCases,
  partitionResponsesByAggregationVariable,
  summarizeAggregationGroups
} from './aggregation-metrics.util';

describe('aggregation metrics', () => {
  const derivedVariables = new Map([
    ['UNIT_DERIVED', new Set(['score'])]
  ]);

  it('counts collapsed cases for aggregatable duplicate groups', () => {
    const responses = [
      {
        responseId: 1, unitName: 'unit_base', variableId: 'answer', value: 'A'
      },
      {
        responseId: 2, unitName: 'UNIT_BASE', variableId: 'answer', value: 'A'
      },
      {
        responseId: 3, unitName: 'unit_base', variableId: 'answer', value: 'B'
      }
    ];

    const groups = buildAggregationGroups(responses, [], 2, derivedVariables);
    const summary = summarizeAggregationGroups(groups, responses.length, 2, []);

    expect(summary).toMatchObject({
      duplicateGroups: 1,
      duplicateResponses: 2,
      collapsedCases: 1,
      rawCases: 3,
      effectiveCases: 2,
      threshold: 2,
      aggregationActive: true
    });
  });

  it('keeps derived and empty responses out of aggregation groups', () => {
    const responses = [
      {
        responseId: 1, unitName: 'UNIT_DERIVED', variableId: 'score', value: '1_0'
      },
      {
        responseId: 2, unitName: 'UNIT_DERIVED', variableId: 'score', value: '1_0'
      },
      {
        responseId: 3, unitName: 'UNIT_BASE', variableId: 'answer', value: ''
      },
      {
        responseId: 4, unitName: 'UNIT_BASE', variableId: 'answer', value: ''
      }
    ];

    const groups = buildAggregationGroups(responses, [], 2, derivedVariables);
    const summary = summarizeAggregationGroups(groups, responses.length, 2, []);

    expect(summary).toMatchObject({
      duplicateGroups: 0,
      duplicateResponses: 0,
      collapsedCases: 0,
      rawCases: 4,
      effectiveCases: 4
    });
  });

  it('respects disabled aggregation', () => {
    const responses = [
      {
        responseId: 1, unitName: 'UNIT_BASE', variableId: 'answer', value: 'A'
      },
      {
        responseId: 2, unitName: 'UNIT_BASE', variableId: 'answer', value: 'A'
      }
    ];

    const groups = buildAggregationGroups(
      responses,
      ['NO_AGGREGATION'],
      2,
      derivedVariables
    );
    const summary = summarizeAggregationGroups(
      groups,
      responses.length,
      2,
      ['NO_AGGREGATION']
    );

    expect(summary).toMatchObject({
      duplicateGroups: 0,
      duplicateResponses: 0,
      collapsedCases: 0,
      rawCases: 2,
      effectiveCases: 2,
      aggregationActive: false
    });
  });

  it('normalizes unit names in completed peer lookup keys like aggregation groups', () => {
    const peerKeys = buildAggregationPeerKeys(
      [
        {
          responseId: 1,
          unitName: 'unit_base',
          variableId: 'answer',
          value: 'Same\u00a0answer'
        }
      ],
      ['IGNORE_CASE', 'IGNORE_WHITESPACE'],
      derivedVariables
    );

    expect(peerKeys).toEqual([
      {
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        normalizedValue: 'sameanswer'
      }
    ]);
  });

  it('builds exact raw-value lookups only for normalized peer matches', () => {
    const peerKeys = buildAggregationPeerKeys(
      [{
        responseId: 1,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'Same answer'
      }],
      ['IGNORE_CASE', 'IGNORE_WHITESPACE'],
      derivedVariables
    );

    expect(buildAggregationPeerLookupKeys(
      peerKeys,
      [
        {
          unitName: 'unit_base',
          variableId: 'answer',
          value: ' sameanswer '
        },
        {
          unitName: 'UNIT_BASE',
          variableId: 'answer',
          value: 'different'
        },
        {
          unitName: 'OTHER_UNIT',
          variableId: 'answer',
          value: 'Same answer'
        }
      ],
      ['IGNORE_CASE', 'IGNORE_WHITESPACE']
    )).toEqual([{
      unitName: 'unit_base',
      variableId: 'answer',
      value: ' sameanswer '
    }]);
  });

  it('assigns all unit-name case variants to one canonical variable partition', () => {
    const responses = [
      { unitName: 'unit_base', variableId: 'answer', responseId: 1 },
      { unitName: 'UNIT_BASE', variableId: 'answer', responseId: 2 },
      { unitName: 'Unit_Base', variableId: 'answer', responseId: 3 }
    ];
    const partitions = partitionResponsesByAggregationVariable(
      responses,
      [
        { unitName: 'unit_base', variableId: 'answer' },
        { unitName: 'UNIT_BASE', variableId: 'answer' }
      ],
      response => response
    );

    expect(partitions.get('UNIT_BASE::answer')?.map(r => r.responseId)).toEqual([
      1,
      2,
      3
    ]);
    expect(partitions.size).toBe(1);
  });

  it('assigns a differently cased peer when there is one unambiguous variable', () => {
    const responses = [
      { unitName: 'UNIT_BASE', variableId: 'answer', responseId: 1 }
    ];
    const partitions = partitionResponsesByAggregationVariable(
      responses,
      [{ unitName: 'unit_base', variableId: 'answer' }],
      response => response
    );

    expect(partitions.get('UNIT_BASE::answer')?.map(r => r.responseId)).toEqual([1]);
  });

  it('keeps an open sibling covered by an assigned completed aggregation group', () => {
    const responses = [
      {
        responseId: 1,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'Same answer',
        personLogin: 'person-1'
      },
      {
        responseId: 2,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: ' sameanswer ',
        personLogin: 'person-2'
      }
    ];

    const counts = countEffectiveManualCodingCases(
      responses,
      new Set([1]),
      ['IGNORE_CASE', 'IGNORE_WHITESPACE'],
      2,
      derivedVariables,
      new Set([2])
    );

    expect(counts).toEqual({ uniqueCases: 1, casesInJobs: 1 });
  });

  it('does not transfer coverage when the full group stays below the threshold', () => {
    const responses = [
      {
        responseId: 1,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'Same answer',
        personLogin: 'person-1'
      },
      {
        responseId: 2,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'sameanswer',
        personLogin: 'person-2'
      }
    ];

    const counts = countEffectiveManualCodingCases(
      responses,
      new Set([1]),
      ['IGNORE_CASE', 'IGNORE_WHITESPACE'],
      3,
      derivedVariables,
      new Set([2])
    );

    expect(counts).toEqual({ uniqueCases: 1, casesInJobs: 0 });
  });

  it('deduplicates same-person responses across unit-name case variants', () => {
    const responses = [
      {
        responseId: 1,
        unitName: 'unit_base',
        variableId: 'answer',
        value: 'same',
        bookletName: 'booklet',
        personLogin: 'person-1'
      },
      {
        responseId: 2,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'same',
        bookletName: 'booklet',
        personLogin: 'person-1'
      },
      {
        responseId: 3,
        unitName: 'UNIT_BASE',
        variableId: 'answer',
        value: 'same',
        bookletName: 'booklet',
        personLogin: 'person-2'
      }
    ];

    const counts = countEffectiveManualCodingCases(
      responses,
      new Set([3]),
      [],
      3,
      derivedVariables,
      new Set([2])
    );

    expect(counts).toEqual({ uniqueCases: 1, casesInJobs: 0 });
  });
});
