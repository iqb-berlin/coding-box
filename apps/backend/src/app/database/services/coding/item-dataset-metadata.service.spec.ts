import type { FindOperator } from 'typeorm';
import { ItemDatasetMetadataService } from './item-dataset-metadata.service';
import { ItemDatasetCellResolver, ItemDatasetColumn, ItemDatasetProfile } from './item-dataset-cell-resolver';

interface StoredFile {
  file_id: string;
  file_type: string;
  data: string;
}

const column = (id: string, itemOrder: number, alias = id): ItemDatasetColumn => ({
  key: `UNIT\u001F${alias}`,
  header: `UNIT_${itemOrder + 1}`,
  unitName: 'UNIT',
  unitId: 'UNIT',
  variableId: alias,
  sourceVariableId: id,
  itemId: String(itemOrder + 1),
  itemLabel: id,
  itemOrder,
  isDerived: id === 'D'
});

const createService = (files: StoredFile[]) => {
  const repository = {
    find: jest.fn().mockImplementation(async ({ where }: {
      where: { workspace_id: number; file_type: string; file_id?: FindOperator<string[]> };
    }) => files.filter(file => (
      file.file_type === where.file_type &&
      (!where.file_id || where.file_id.value.includes(file.file_id))
    )))
  };
  return new ItemDatasetMetadataService({} as never, repository as never, {} as never, {} as never, {} as never);
};

const definition = (ids: string[]) => JSON.stringify({
  pages: ids.map(id => ({ sections: [{ elements: [{ id }] }] }))
});

const profileEntries = [
  {
    id: 'mir' as const, label: 'invalid', code: -98, score: 0
  },
  {
    id: 'mci' as const, label: 'coding impossible', code: -97, score: null
  },
  {
    id: 'mbi_mbo' as const, label: 'omitted', code: -99, score: 0
  },
  {
    id: 'mnr' as const, label: 'not reached', code: -96, score: null
  },
  {
    id: 'mbd' as const, label: 'by design', code: -94, score: null
  }
];
const profile: ItemDatasetProfile = {
  byId: new Map(profileEntries.map(entry => [entry.id, entry])),
  byCode: new Map(profileEntries.map(entry => [entry.code, entry]))
};
const design = { units: new Map([['UNIT', { unitId: 'UNIT', order: 0, testletKey: 'T1' }]]) };

describe('ItemDatasetMetadataService variable positions', () => {
  it.each(['conventional resource', 'referenced resource', 'inline definition'])(
    'keeps trailing NR with %s even when natural names have a different order', async format => {
      const layout = definition(['Z', 'A']);
      const unitDefinition = format === 'inline definition' ?
        `<Definition player="player"><![CDATA[${layout}]]></Definition>` :
        `<DefinitionRef player="player">${format === 'referenced resource' ? 'resources/shared-layout.voud' : 'UNIT.VOUD'}</DefinitionRef>`;
      const files: StoredFile[] = [{
        file_id: 'UNIT.XML',
        file_type: 'Unit',
        data: `<Unit><Metadata><Id>UNIT</Id></Metadata>${unitDefinition}</Unit>`
      }, {
        // An explicit definition takes precedence over an unrelated conventional file.
        file_id: 'UNIT.VOUD',
        file_type: 'Resource',
        data: format === 'conventional resource' ? layout : definition(['A', 'Z'])
      }, {
        file_id: 'SHARED-LAYOUT.VOUD', file_type: 'Resource', data: layout
      }];
      const columns = [column('Z', 0), column('A', 1)];
      const variablePositions = await createService(files).getVariablePositions(7, columns);
      const cells = new ItemDatasetCellResolver().resolve(columns, design, new Map([
        [columns[0].key, { status: 5, code: 1, score: 1 }],
        [columns[1].key, { status: 1, code: null, score: null }]
      ]), profile, new Map(), { variablePositions });
      expect(cells.map(cell => cell.code)).toEqual([1, -96]);
    }
  );

  it('keeps conventional resource lookup when Unit XML metadata is unavailable', async () => {
    const positions = await createService([{
      file_id: 'UNIT.VOUD', file_type: 'Resource', data: definition(['Z', 'A'])
    }]).getVariablePositions(7, [column('Z', 0), column('A', 1)]);
    expect(positions.get('UNIT\u001FZ')).toBeLessThan(positions.get('UNIT\u001FA')!);
  });

  it.each(['shared-scheme.vocs', 'shared-scheme.xml', 'shared-scheme'])(
    'uses the referenced coding scheme %s for page overrides and Unit aliases', async reference => {
      const positions = await createService([{
        file_id: 'UNIT',
        file_type: 'Unit',
        data: `<Unit><Metadata><Id>UNIT</Id></Metadata>
        <Definition player="player"><![CDATA[${definition(['V1', 'V2'])}]]></Definition>
        <CodingSchemeRef>schemes/${reference}</CodingSchemeRef>
        <BaseVariables><Variable id="B1" alias="V1"/><Variable id="B2" alias="V2"/></BaseVariables>
      </Unit>`
      }, {
        file_id: reference.includes('.') ? reference.toUpperCase() : `${reference.toUpperCase()}.VOCS`,
        file_type: 'Resource',
        data: JSON.stringify({
          variableCodings: [
            { id: 'B1', sourceType: 'BASE', page: '2' },
            { id: 'B2', sourceType: 'BASE', page: '1' }
          ]
        })
      }]).getVariablePositions(7, [column('B1', 0, 'V1'), column('B2', 1, 'V2')]);
      expect(positions.get('UNIT\u001FV2')).toBeLessThan(positions.get('UNIT\u001FV1')!);
    }
  );

  it.each(['inline', 'resource'])('uses Unit page metadata with a non-JSON %s definition', async format => {
    const layout = '<task><prompt>Example</prompt></task>';
    const unitDefinition = format === 'inline' ?
      `<Definition player="text-player"><![CDATA[${layout}]]></Definition>` :
      '<DefinitionRef player="text-player">shared-layout.xml</DefinitionRef>';
    const columns = [column('Z', 0), column('A', 1)];
    const variablePositions = await createService([{
      file_id: 'UNIT',
      file_type: 'Unit',
      data: `<Unit><Metadata><Id>UNIT</Id><Label>XML layout</Label></Metadata>${unitDefinition}
        <BaseVariables>
          <Variable id="Z" alias="Z" type="string" page="0"/>
          <Variable id="A" alias="A" type="string" page="1"/>
        </BaseVariables>
      </Unit>`
    }, {
      file_id: 'SHARED-LAYOUT.XML', file_type: 'Resource', data: layout
    }]).getVariablePositions(7, columns);
    const cells = new ItemDatasetCellResolver().resolve(columns, design, new Map([
      [columns[0].key, { status: 5, code: 1, score: 1 }],
      [columns[1].key, { status: 1, code: null, score: null }]
    ]), profile, new Map(), { variablePositions });
    expect(cells.map(cell => cell.code)).toEqual([1, -96]);
  });

  it.each(['UNIT', 'schemes/unit', 'schemes/unit.vocs'])(
    'retains the derivation boundary for coding scheme reference %s', async reference => {
      const columns = [column('V1', 0), column('D', 1), column('V10', 2)];
      const variablePositions = await createService([{
        file_id: 'UNIT',
        file_type: 'Unit',
        data: `<Unit><Metadata><Id>UNIT</Id><Label>Derived item</Label></Metadata>
          <DefinitionRef player="player">UNIT.VOUD</DefinitionRef>
          <CodingSchemeRef schemer="schemer">${reference}</CodingSchemeRef>
          <BaseVariables><Variable id="V1" alias="V1" type="string"/><Variable id="V10" alias="V10" type="string"/></BaseVariables>
          <DerivedVariables><Variable id="D" alias="D" type="string"/></DerivedVariables>
        </Unit>`
      }, {
        file_id: 'UNIT.VOUD', file_type: 'Resource', data: definition(['V1', 'V10'])
      }, {
        file_id: 'UNIT.VOCS',
        file_type: 'Resource',
        data: JSON.stringify({
          variableCodings: [
            { id: 'V1', sourceType: 'BASE' }, { id: 'V10', sourceType: 'BASE' },
            { id: 'D', sourceType: 'COPY_VALUE', deriveSources: ['V1'] }
          ]
        })
      }]).getVariablePositions(7, columns);
      const cells = new ItemDatasetCellResolver().resolve(columns, design, new Map([
        [columns[0].key, { status: 5, code: 1, score: 1 }],
        [columns[1].key, { status: 5, code: 1, score: 1 }],
        [columns[2].key, { status: 1, code: null, score: null }]
      ]), profile, new Map([[columns[1].key, [columns[0].key]]]), { variablePositions });
      expect(cells.map(cell => cell.code)).toEqual([1, 1, -96]);
    }
  );

  it.each([false, true])('uses Unit aliases for derived sources without VOCS aliases (hidden source: %s)', async hiddenSource => {
    const files: StoredFile[] = [{
      // The metadata ID, rather than the upload filename, identifies the Unit.
      file_id: 'UPLOADED-UNIT.XML',
      file_type: 'Unit',
      data: `<Unit><Metadata><Id>unit</Id></Metadata>
        <DefinitionRef player="player">UNIT.VOUD</DefinitionRef>
        <BaseVariables><Variable id="B1" alias="V1"/><Variable id="B2" alias="V2"/></BaseVariables>
        <DerivedVariables><Variable id="D" alias="D"/></DerivedVariables>
      </Unit>`
    }, {
      file_id: 'UNIT.VOUD', file_type: 'Resource', data: definition(['V1', 'V2'])
    }, {
      file_id: 'UNIT.VOCS',
      file_type: 'Resource',
      data: JSON.stringify({
        variableCodings: [
          { id: 'B1', sourceType: 'BASE' }, { id: 'B2', sourceType: 'BASE' },
          { id: 'D', sourceType: 'COPY_VALUE', deriveSources: ['B1'] }
        ]
      })
    }];
    const source = column('B1', 0, 'V1');
    const derived = column('D', 1);
    const later = column('B2', 2, 'V2');
    const columns = hiddenSource ? [derived, later] : [source, derived, later];
    const variablePositions = await createService(files).getVariablePositions(7, columns);
    expect(variablePositions.get(source.key)).toBe(variablePositions.get('UNIT\u001FB1'));
    const cells = new ItemDatasetCellResolver().resolve(columns, design, new Map([
      [source.key, { status: 5, code: 1, score: 1 }],
      [derived.key, { status: 5, code: 1, score: 1 }],
      [later.key, { status: 1, code: null, score: null }]
    ]), profile, new Map([[derived.key, [source.key]]]), { variablePositions });
    expect(cells.map(cell => cell.code)).toEqual(hiddenSource ? [1, -96] : [1, 1, -96]);
  });
});
