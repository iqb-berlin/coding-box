import { ItemDatasetCellResolver, ItemDatasetColumn, ItemDatasetProfile } from './item-dataset-cell-resolver';
import { buildItemDatasetVariablePositions } from './item-dataset-variable-positions.util';

const column = (itemId: string, variableId: string, itemOrder: number, unitId = 'DLB004'): ItemDatasetColumn => ({
  key: `${unitId}\u001F${variableId}`,
  header: `${unitId}_${itemId}`,
  unitName: unitId,
  unitId,
  variableId,
  sourceVariableId: variableId,
  itemId,
  itemLabel: itemId,
  itemOrder,
  isDerived: false
});

const profile = (offset = 0): ItemDatasetProfile => {
  const entries = [
    {
      id: 'mir' as const, code: -98 - offset, score: 0, label: 'invalid'
    },
    {
      id: 'mci' as const, code: -97 - offset, score: null, label: 'coding impossible'
    },
    {
      id: 'mbi_mbo' as const, code: -99 - offset, score: 0, label: 'omitted'
    },
    {
      id: 'mnr' as const, code: -96 - offset, score: null, label: 'not reached'
    },
    {
      id: 'mbd' as const, code: -94 - offset, score: null, label: 'by design'
    }
  ];
  return { byId: new Map(entries.map(entry => [entry.id, entry])), byCode: new Map(entries.map(entry => [entry.code, entry])) };
};

describe('item dataset MNR ordering', () => {
  const resolver = new ItemDatasetCellResolver();
  const columns = [column('10', '10', 0), column('12', '01', 1), column('16', '11', 2)];
  const design = {
    units: new Map([
      ['DLB004', { unitId: 'DLB004', order: 0, testletKey: 'T1' }],
      ['LATER', { unitId: 'LATER', order: 1, testletKey: 'T2' }]
    ])
  };
  const variablePositions = buildItemDatasetVariablePositions('DLB004', [], JSON.stringify({
    pages: [
      { sections: [{ elements: [{ id: '01' }] }] },
      { sections: [{ elements: [{ id: '10' }] }] },
      { sections: [{ elements: [{ id: '11' }] }] }
    ]
  }));
  const values = new Map([
    [columns[0].key, { status: 1, code: null, score: null }],
    [columns[1].key, { status: 5, code: 1, score: 1 }],
    [columns[2].key, { status: 1, code: null, score: null }]
  ]);

  it.each(['unit', 'testlet', 'booklet'] as const)('retains DLB004 trailing NR using %s scope and both missing options', scope => {
    for (const offset of [0, 100]) {
      for (const recodeTrailingOmissions of [false, true]) {
        const cells = resolver.resolve(columns, design, values, profile(offset), new Map(), {
          notReachedScope: scope, recodeTrailingOmissions, variablePositions
        });
        expect(cells.map(cell => cell.code)).toEqual([-96 - offset, 1, -96 - offset]);
        expect(columns.map(item => item.header)).toEqual(['DLB004_10', 'DLB004_12', 'DLB004_16']);
      }
    }
  });

  it.each(['unit', 'testlet', 'booklet'] as const)('keeps later-work boundaries within the configured %s scope', scope => {
    const later = column('1', 'LATER', 0, 'LATER');
    const cells = resolver.resolve([...columns, later], design, new Map([
      ...values, [later.key, { code: 1, score: 1, status: 5 }]
    ]), profile(), new Map(), { notReachedScope: scope, variablePositions });
    expect(cells.map(cell => cell.code)).toEqual(scope === 'booklet' ? [-99, 1, -99, 1] : [-96, 1, -96, 1]);
  });

  it('recodes NR before later variable work even when its item is last', () => {
    const cells = resolver.resolve(columns, design, new Map([
      [columns[0].key, { status: 5, code: 1, score: 1 }],
      [columns[1].key, { status: 1, code: null, score: null }]
    ]), profile(), new Map(), { variablePositions });
    expect(cells.map(cell => cell.code)).toEqual([1, -99, -96]);
  });

  it('classifies omissions according to variable order when trailing recoding is enabled', () => {
    const cells = resolver.resolve(columns, design, new Map([
      [columns[1].key, { status: 5, code: 1, score: 1 }],
      [columns[0].key, { status: 2, code: null, score: null }]
    ]), profile(), new Map(), { variablePositions, recodeTrailingOmissions: true });
    expect(cells.map(cell => cell.code)).toEqual([-96, 1, -96]);
  });

  it('keeps already stored missing codes intact', () => {
    const cells = resolver.resolve(columns, design, new Map([
      ...values, [columns[1].key, { status: 1, code: -96, score: null }]
    ]), profile(), new Map(), { variablePositions });
    expect(cells.map(cell => cell.code)).toEqual([-96, -96, -96]);
  });

  it('uses each hidden source at its own position, before or after an answered variable', () => {
    const derived = { ...column('1', 'DERIVED', 0), isDerived: true, sourceType: 'COPY_VALUE' };
    const activity = column('2', 'V5', 1);
    for (const source of ['V1', 'V10']) {
      const positions = buildItemDatasetVariablePositions('DLB004', [], undefined, JSON.stringify({
        variableCodings: [
          { id: source, sourceType: 'BASE' },
          { id: 'V5', sourceType: 'BASE' },
          { id: 'DERIVED', sourceType: 'COPY_VALUE', deriveSources: [source] }
        ]
      }));
      const cells = resolver.resolve([derived, activity], design, new Map([
        [activity.key, { status: 5, code: 1, score: 1 }]
      ]), profile(), new Map([[derived.key, [`DLB004\u001F${source}`]]]), { variablePositions: positions });
      expect(cells.map(cell => cell.code)).toEqual([source === 'V1' ? -99 : -96, 1]);
    }
  });

  it('treats duplicate items pointing to the same variable as one analysis position', () => {
    const duplicate = column('99', '01', 99);
    const cells = resolver.resolve([columns[0], duplicate, columns[1]], design, values, profile(), new Map(), { variablePositions });
    expect(cells.map(cell => cell.code)).toEqual([-96, 1, 1]);
  });

  it('uses a shared hidden source at its own position for multiple derived items', () => {
    const first = { ...column('1', 'D1', 0), isDerived: true };
    const second = { ...column('2', 'D2', 1), isDerived: true };
    const activity = column('3', 'V2', 2);
    const sourceKey = 'DLB004\u001FV1';
    const positions = new Map([[sourceKey, 1], [first.key, 2], [second.key, 3], [activity.key, 4]]);
    const cells = resolver.resolve([first, second, activity], design, new Map([
      [activity.key, { status: 5, code: 1, score: 1 }]
    ]), profile(), new Map([[first.key, [sourceKey]], [second.key, [sourceKey]]]), { variablePositions: positions });
    expect(cells.map(cell => cell.code)).toEqual([-99, -99, 1]);
  });
});
