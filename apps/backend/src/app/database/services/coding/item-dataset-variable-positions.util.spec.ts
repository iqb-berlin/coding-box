import { buildItemDatasetVariablePositions } from './item-dataset-variable-positions.util';

const positions = (
  variables: Array<Record<string, unknown>>,
  pages?: unknown[]
) => buildItemDatasetVariablePositions(
  'UNIT',
  [],
  pages ? JSON.stringify({ pages }) : undefined,
  JSON.stringify({ variableCodings: variables })
);

const sequence = (result: Map<string, number>, ids: string[]) => [...ids].sort(
  (left, right) => result.get(`UNIT\u001F${left}`)! - result.get(`UNIT\u001F${right}`)!
);

describe('item dataset variable positions', () => {
  it('orders by numeric page, section and natural variable name independently of scheme order', () => {
    const ids = ['V10', 'V2', 'V1', 'V3', 'NO_PAGE'];
    const result = positions(ids.map(id => ({ id, sourceType: 'BASE' })), [
      { sections: [{ elements: [{ id: 'V3' }] }, { elements: [{ id: 'V1' }] }] },
      { sections: [{ elements: [{ id: 'V10' }, { id: 'V2' }] }] }
    ]);
    expect(sequence(result, ids)).toEqual(['V3', 'V1', 'V2', 'V10', 'NO_PAGE']);
  });

  it('uses natural variable names when layout metadata is absent', () => {
    const ids = ['V10', 'V2', 'V1'];
    expect(sequence(positions(ids.map(id => ({ id }))), ids)).toEqual(['V1', 'V2', 'V10']);
  });

  it('uses natural names for text definitions and non-numeric Unit page IDs', () => {
    const result = buildItemDatasetVariablePositions('UNIT', [
      { id: 'V10', alias: 'V10', page: 'last' },
      { id: 'V2', alias: 'V2', page: 'first' }
    ], 'Text definition');
    expect(sequence(result, ['V10', 'V2'])).toEqual(['V2', 'V10']);
  });

  it.each([undefined, JSON.stringify({
    variableCodings: [{ id: 'V10', sourceType: 'BASE' }, { id: 'V2', sourceType: 'BASE' }]
  })])('uses IDs and Unit pages when neither Unit nor scheme supplies aliases (%s)', codingScheme => {
    const result = buildItemDatasetVariablePositions('UNIT', [
      { id: 'V10', page: '0' }, { id: 'V2', page: '1' }
    ], undefined, codingScheme);
    expect(sequence(result, ['V2', 'V10'])).toEqual(['V10', 'V2']);
  });

  it.each([undefined, '<task/>', JSON.stringify({
    pages: [
      { sections: [{ elements: [{ id: 'V1' }] }] },
      { sections: [{ elements: [{ id: 'V2' }] }] }
    ]
  })])('uses Unit pages as fallback while preserving layout and VOCS priority (%s)', definition => {
    const mapped = [
      { id: 'B1', alias: 'V1', page: '1' },
      { id: 'B2', alias: 'V2', page: '0' }
    ];
    const result = buildItemDatasetVariablePositions('UNIT', mapped, definition);
    expect(sequence(result, ['V1', 'V2'])).toEqual(definition?.startsWith('{') ? ['V1', 'V2'] : ['V2', 'V1']);
    const overridden = buildItemDatasetVariablePositions('UNIT', mapped, definition, JSON.stringify({
      variableCodings: [
        { id: 'B1', sourceType: 'BASE', page: '1' },
        { id: 'B2', sourceType: 'BASE', page: '3' }
      ]
    }));
    expect(sequence(overridden, ['V1', 'V2'])).toEqual(['V1', 'V2']);
  });

  it('supports aliases and VOCS page overrides using versioned-export page numbering', () => {
    const result = positions([
      {
        id: 'internal1', alias: 'V1', sourceType: 'BASE', page: '10'
      },
      {
        id: 'internal2', alias: 'V2', sourceType: 'BASE', page: '2'
      }
    ], [
      { alwaysVisible: true, sections: [{ elements: [{ id: 'V1' }] }] },
      { sections: [{ elements: [{ id: 'V1' }, { id: 'V2' }] }] }
    ]);
    expect(sequence(result, ['V1', 'V2'])).toEqual(['V2', 'V1']);
    expect(result.get('UNIT\u001Finternal1')).toBe(result.get('UNIT\u001FV1'));
    expect(result.get('UNIT\u001Finternal2')).toBe(result.get('UNIT\u001FV2'));
  });

  it('inserts derivations after their last source, including chains before siblings', () => {
    const result = positions([
      { id: 'A1', sourceType: 'BASE' },
      { id: 'A2', sourceType: 'BASE' },
      { id: 'A3', sourceType: 'BASE' },
      { id: 'D2', sourceType: 'SUM_SCORE', deriveSources: ['A1', 'A2'] },
      { id: 'D10', sourceType: 'COPY_VALUE', deriveSources: ['A2'] },
      { id: 'CHAIN', sourceType: 'COPY_VALUE', deriveSources: ['D2'] }
    ]);
    expect(sequence(result, ['A3', 'D10', 'A2', 'A1', 'CHAIN', 'D2'])).toEqual([
      'A1', 'A2', 'D2', 'CHAIN', 'D10', 'A3'
    ]);
  });

  it('uses own layout positions for missing, ambiguous and cyclic sources and blocked descendants', () => {
    const result = positions([
      { id: 'A1', alias: 'SAME', sourceType: 'BASE' },
      { id: 'A2', alias: 'SAME', sourceType: 'BASE' },
      { id: 'D1', deriveSources: ['ABSENT'], page: '1' },
      { id: 'D2', deriveSources: ['SAME'], page: '2' },
      { id: 'C1', deriveSources: ['C2'], page: '3' },
      { id: 'C2', deriveSources: ['C1'], page: '4' },
      { id: 'D3', deriveSources: ['C1'], page: '5' }
    ]);
    expect(sequence(result, ['D3', 'C2', 'D2', 'C1', 'D1'])).toEqual(['D1', 'D2', 'C1', 'C2', 'D3']);
    expect(result.has('UNIT\u001FSAME')).toBe(false);
  });

  it('registers mapped variables without schemes and retains layout-only sources', () => {
    const result = buildItemDatasetVariablePositions('UNIT', [{ id: 'internal', alias: 'V10' }], JSON.stringify({
      pages: [{ sections: [{ elements: [{ id: 'V10' }, { id: 'SOURCE2' }] }] }]
    }));
    expect(result.get('UNIT\u001Finternal')).toBe(result.get('UNIT\u001FV10'));
    expect(result.get('UNIT\u001FSOURCE2')).toBeLessThan(result.get('UNIT\u001FV10')!);
  });

  it('uses mapped aliases for existing scheme IDs while retaining derivation links and page overrides', () => {
    const mapped = [{ id: 'B1', alias: 'V1' }, { id: 'B2', alias: 'V2' }, { id: 'D', alias: 'DERIVED' }];
    const result = buildItemDatasetVariablePositions('UNIT', mapped, JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: 'V2' }] }] },
        { sections: [{ elements: [{ id: 'V1' }] }] }
      ]
    }), JSON.stringify({
      variableCodings: [
        { id: 'B1', sourceType: 'BASE', page: '1' },
        { id: 'B2', sourceType: 'BASE', page: '2' },
        { id: 'D', sourceType: 'COPY_VALUE', deriveSources: ['B1'] }
      ]
    }));
    expect(sequence(result, ['V2', 'DERIVED', 'V1'])).toEqual(['V1', 'DERIVED', 'V2']);
    for (const variable of mapped) {
      expect(result.get(`UNIT\u001F${variable.id}`)).toBe(result.get(`UNIT\u001F${variable.alias}`));
    }
  });

  it('retains scheme and mapped aliases for layout, source links and response positions', () => {
    const result = buildItemDatasetVariablePositions('UNIT', [
      { id: 'A', alias: 'UNIT_ALIAS' },
      { id: 'A', alias: 'EXPORT_ALIAS' }
    ], JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: 'SCHEME_ALIAS' }] }] },
        { sections: [{ elements: [{ id: 'B' }] }] }
      ]
    }), JSON.stringify({
      variableCodings: [
        { id: 'A', alias: 'SCHEME_ALIAS', sourceType: 'BASE' },
        { id: 'B', sourceType: 'BASE' },
        { id: 'D1', sourceType: 'COPY_VALUE', deriveSources: ['SCHEME_ALIAS'] },
        { id: 'D2', sourceType: 'COPY_VALUE', deriveSources: ['UNIT_ALIAS'] }
      ]
    }));
    for (const alias of ['SCHEME_ALIAS', 'UNIT_ALIAS', 'EXPORT_ALIAS']) {
      expect(result.get(`UNIT\u001F${alias}`)).toBe(result.get('UNIT\u001FA'));
    }
    expect(sequence(result, ['B', 'D2', 'A', 'D1'])).toEqual(['A', 'D1', 'D2', 'B']);
  });

  it('rejects aliases shared by different IDs across Unit and scheme declarations', () => {
    const result = buildItemDatasetVariablePositions('UNIT', [
      { id: 'A', alias: 'UNIT_A' }, { id: 'B', alias: 'SHARED' }
    ], undefined, JSON.stringify({
      variableCodings: [
        {
          id: 'A', alias: 'SHARED', sourceType: 'BASE', page: '2'
        },
        {
          id: 'B', alias: 'SCHEME_B', sourceType: 'BASE', page: '3'
        },
        {
          id: 'D', sourceType: 'COPY_VALUE', deriveSources: ['SHARED'], page: '1'
        }
      ]
    }));
    expect(result.has('UNIT\u001FSHARED')).toBe(false);
    expect(sequence(result, ['B', 'A', 'D'])).toEqual(['D', 'A', 'B']);
    expect(result.get('UNIT\u001FUNIT_A')).toBe(result.get('UNIT\u001FA'));
    expect(result.get('UNIT\u001FSCHEME_B')).toBe(result.get('UNIT\u001FB'));
  });

  it.each([false, true])('preserves ID precedence for sources and alias precedence for layout (%s)', schemeAliases => {
    const result = buildItemDatasetVariablePositions('UNIT', [
      { id: '04', alias: '02' }, { id: '07', alias: '04' }
    ], JSON.stringify({
      pages: [
        { sections: [{ elements: [{ id: '02' }] }] },
        { sections: [{ elements: [{ id: '04' }] }] }
      ]
    }), JSON.stringify({
      variableCodings: [
        { id: '04', alias: schemeAliases ? '02' : undefined, sourceType: 'BASE' },
        { id: '07', alias: schemeAliases ? '04' : undefined, sourceType: 'BASE' },
        { id: 'D', sourceType: 'COPY_VALUE', deriveSources: ['04'] }
      ]
    }));
    expect(sequence(result, ['04', 'D', '02'])).toEqual(['02', 'D', '04']);
    expect(result.get('UNIT\u001F04')).toBe(result.get('UNIT\u001F07'));
  });
});
