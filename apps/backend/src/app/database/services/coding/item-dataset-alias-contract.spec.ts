import type { FindOperator } from 'typeorm';
import { WorkspaceFileMetadataService } from '../workspace/workspace-file-metadata.service';
import { ItemDatasetMetadataService } from './item-dataset-metadata.service';
import { ItemDatasetCellResolver, ItemDatasetColumn, ItemDatasetProfile } from './item-dataset-cell-resolver';

describe('item dataset aliases across workspace metadata and variable positions', () => {
  it.each(['HIDDEN', 'OLD'])('uses the source aliases returned by WorkspaceFileMetadataService with Unit alias %s', async unitAlias => {
    const files = [{
      file_id: 'UNIT',
      file_type: 'Unit',
      data: `<Unit><Metadata><Id>UNIT</Id><Label>Alias update</Label></Metadata>
        <DefinitionRef player="player">UNIT.VOUD</DefinitionRef>
        <CodingSchemeRef schemer="schemer">UNIT.VOCS</CodingSchemeRef>
        <BaseVariables><Variable id="V1" alias="V1" type="string"/><Variable id="V2" alias="V2" type="string"/></BaseVariables>
        <DerivedVariables><Variable id="D1" alias="${unitAlias}" type="string"/><Variable id="D2" alias="D2" type="string"/></DerivedVariables>
      </Unit>`
    }, {
      file_id: 'UNIT.VOUD',
      file_type: 'Resource',
      data: JSON.stringify({
        pages: [
          { sections: [{ elements: [{ id: 'V1' }] }] }, { sections: [{ elements: [{ id: 'V2' }] }] }
        ]
      })
    }, {
      file_id: 'UNIT.VOCS',
      file_type: 'Resource',
      data: JSON.stringify({
        version: '3.2',
        variableCodings: [
          {
            id: 'V1', alias: 'V1', sourceType: 'BASE', codes: []
          },
          {
            id: 'V2', alias: 'V2', sourceType: 'BASE', codes: []
          },
          {
            id: 'D1', alias: 'HIDDEN', sourceType: 'COPY_VALUE', deriveSources: ['V1'], codes: []
          },
          {
            id: 'D2', alias: 'D2', sourceType: 'COPY_VALUE', deriveSources: ['D1'], codes: []
          }
        ]
      })
    }];
    const repository = {
      find: jest.fn().mockImplementation(async ({ where }: {
        where: { file_type: string; file_id?: FindOperator<string[] | string> };
      }) => files.filter(file => file.file_type === where.file_type &&
        (!where.file_id || (where.file_id.type === 'like' ? file.file_id.endsWith('.VOCS') :
          (where.file_id.value as string[]).includes(file.file_id)))))
    };
    const cache = new Map<string, unknown>();
    const cacheService = {
      get: async (key: string) => cache.get(key) ?? null,
      set: async (key: string, value: unknown) => { cache.set(key, value); return true; },
      delete: async (key: string) => { cache.delete(key); return true; }
    };
    const reader = new WorkspaceFileMetadataService(repository as never, cacheService as never, undefined as never);
    const [details] = await reader.getUnitVariableDetails(7);
    const columns: ItemDatasetColumn[] = ['V1', 'D2', 'V2'].map((id, itemOrder) => {
      const variable = details.variables.find(entry => entry.id === id)!;
      return {
        key: `UNIT\u001F${variable.alias}`,
        header: `UNIT_${itemOrder}`,
        unitName: 'UNIT',
        unitId: 'UNIT',
        variableId: variable.alias!,
        sourceVariableId: variable.id,
        itemId: String(itemOrder),
        itemLabel: id,
        itemOrder,
        isDerived: variable.isDerived === true
      };
    });
    const metadata = new ItemDatasetMetadataService({} as never, repository as never, reader, {} as never, {} as never);
    const sources = await metadata.getDerivedSources(7);
    expect(sources.get('UNIT\u001FD2')).toEqual(['UNIT\u001FHIDDEN']);
    expect((await reader.getUnitVariableMap(7)).get('UNIT')?.has('HIDDEN')).toBe(true);
    const entries = [
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
      byId: new Map(entries.map(entry => [entry.id, entry])), byCode: new Map(entries.map(entry => [entry.code, entry]))
    };
    const values = new Map([
      ['UNIT\u001FV1', { status: 5, code: 1, score: 1 }],
      ['UNIT\u001FHIDDEN', { status: 5, code: 1, score: 1 }],
      ['UNIT\u001FD2', { status: 5, code: 1, score: 1 }],
      ['UNIT\u001FV2', { status: 1, code: null, score: null }]
    ]);
    const design = { units: new Map([['UNIT', { unitId: 'UNIT', order: 0, testletKey: 'T1' }]]) };
    const resolver = new ItemDatasetCellResolver();
    const { positions: variablePositions } = await metadata.getVariableOrder(7, columns);
    expect(variablePositions.get('UNIT\u001FHIDDEN')).toBe(variablePositions.get(`UNIT\u001F${unitAlias}`));
    expect(resolver.resolve(columns, design, values, profile, sources, { variablePositions }).map(cell => cell.code))
      .toEqual([1, 1, -96]);
  });
});
