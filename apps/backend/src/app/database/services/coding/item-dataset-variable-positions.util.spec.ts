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
});
