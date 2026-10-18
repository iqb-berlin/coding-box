import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { UnitTag } from '../../entities/unitTag.entity';
import { UnitNote } from '../../entities/unitNote.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitTagService } from './unit-tag.service';
import { UnitNoteService } from './unit-note.service';

class MetadataDataSource extends DataSource {
  async buildTestMetadata() {
    await this.buildMetadatas();
  }
}

describe.each(['tag', 'note'] as const)('Unit %s workspace queries', kind => {
  it('compiles every ownership predicate into a PostgreSQL workspace condition', async () => {
    const source = new MetadataDataSource({
      type: 'postgres',
      entities: getMetadataArgsStorage().tables.map(table => table.target)
    });
    await source.buildTestMetadata();
    const unitRepository = source.getRepository(Unit);
    const repository = kind === 'tag' ? source.getRepository(UnitTag) : source.getRepository(UnitNote);
    const fixture = { id: 51, unitId: 21, [kind]: 'Original' };
    const unitFind = jest.spyOn(unitRepository, 'findOne').mockResolvedValue({ id: 21 } as Unit);
    const findOne = jest.spyOn(repository, 'findOne').mockResolvedValue(fixture as never);
    const find = jest.spyOn(repository, 'find').mockResolvedValue([fixture] as never);
    jest.spyOn(repository, 'save').mockImplementation(async value => value as never);
    jest.spyOn(repository, 'delete').mockResolvedValue({ affected: 1, raw: [] });
    const service = kind === 'tag' ?
      new UnitTagService(repository as never, unitRepository) :
      new UnitNoteService(repository as never, unitRepository);

    await service.create(47, { unitId: 21, [kind]: 'New' } as never);
    await service.findAllByUnitId(47, 21);
    await service.findAllByUnitIds(47, [21, 22]);
    await service.findOne(47, 51);
    await service.update(47, 51, { [kind]: 'Changed' } as never);
    await service.remove(47, 51);

    const queries = [
      ...unitFind.mock.calls.map(([options]) => unitRepository.createQueryBuilder('unit').setFindOptions(options)),
      ...findOne.mock.calls.map(([options]) => repository.createQueryBuilder('annotation').setFindOptions(options)),
      ...find.mock.calls.map(([options]) => repository.createQueryBuilder('annotation').setFindOptions(options))
    ];
    expect(queries).toHaveLength(7);
    for (const query of queries) {
      const [sql, parameters] = query.getQueryAndParameters();
      expect(sql).toContain('JOIN "booklet"');
      expect(sql).toContain('JOIN "persons"');
      expect(sql).toMatch(/"workspace_id" = \$\d+/);
      expect(parameters).toContain(47);
    }
  });
});
