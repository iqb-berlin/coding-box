import {
  buildAggregationGroups,
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
});
