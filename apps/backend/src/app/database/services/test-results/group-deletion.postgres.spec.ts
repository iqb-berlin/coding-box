import { DataSource, Repository } from 'typeorm';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { UnitTag } from '../../entities/unitTag.entity';
import { UnitNote } from '../../entities/unitNote.entity';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Page-independent deletion with PostgreSQL', () => {
  const schema = `group_deletion_${process.pid}_${Date.now()}`;
  let db: DataSource;
  let service: WorkspaceTestResultsService;
  let persons: Repository<Persons>;

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      entities: [Persons, Booklet, BookletInfo, Unit, ResponseEntity, UnitLastState,
        BookletLog, Session, UnitLog, ChunkEntity, UnitTag, UnitNote],
      synchronize: false
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`CREATE TABLE "${schema}".persons (
      id SERIAL PRIMARY KEY, code VARCHAR NOT NULL, login VARCHAR NOT NULL,
      "group" VARCHAR NOT NULL, workspace_id INTEGER NOT NULL, consider BOOLEAN NOT NULL)`);
    await db.query(`CREATE TABLE "${schema}".booklet (id INTEGER, personid INTEGER, infoid INTEGER)`);
    await db.query(`CREATE TABLE "${schema}".bookletinfo (id INTEGER, name VARCHAR)`);
    await db.query(`CREATE TABLE "${schema}".unit (id INTEGER, bookletid INTEGER, name VARCHAR, alias VARCHAR)`);
    await db.query(`CREATE TABLE "${schema}".response (id INTEGER, unitid INTEGER, is_autocoder_generated BOOLEAN)`);
    // G1 spans pages 1 and 2, G2 spans pages 2 and 3. Each group has one
    // person matching the code filter, so expansion must include non-matches.
    await db.query(`INSERT INTO "${schema}".persons (code, login, "group", workspace_id, consider)
      SELECT CASE WHEN n IN (1, 66) THEN 'needle' ELSE 'P' || n END,
        CASE WHEN n = 130 THEN 'login-match' ELSE 'login' END,
        CASE WHEN n <= 65 THEN 'G1' ELSE 'G2' END, 1, true
      FROM generate_series(1, 130) n`);
    await db.query(`INSERT INTO "${schema}".persons (code, login, "group", workspace_id, consider) VALUES
      ('foreign', 'login', 'G1', 2, true), ('foreign-only', 'login', 'G3', 2, true),
      ('excluded', 'login', 'G1', 1, false), ('needle', 'login', '', 1, true),
      ('no-group', 'login', '   ', 1, true)`);
    persons = db.getRepository(Persons);
    service = new WorkspaceTestResultsService(
      persons, db.getRepository(Unit), db.getRepository(Booklet), db.getRepository(ResponseEntity), db.getRepository(BookletInfo), db.getRepository(BookletLog), db.getRepository(Session), db.getRepository(UnitLog), db.getRepository(ChunkEntity), db, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }) } as never
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      try { await db.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await db.destroy(); }
    }
  });

  it.each([50, 100, 500])('previews all matching groups independently of a page size of %s', async pageSize => {
    const page = await persons.createQueryBuilder('person').select(['person.id'])
      .where('person.workspace_id = 1 AND person.consider = true').orderBy('person.id')
      .skip(0)
      .take(pageSize)
      .getMany();
    expect(page).toHaveLength(Math.min(pageSize, 132));
    const preview = await service.previewDeleteTestResults(1, { scope: 'filteredGroups', searchText: 'needle' });
    expect(preview.persons).toBe(130);
    expect(preview.groups.sort()).toEqual(['G1', 'G2']);
    expect(preview.label).toContain('einschließlich aller Gruppenmitglieder');
  });

  it('matches login and group fields and never expands into a foreign workspace', async () => {
    for (const searchText of ['login-match', 'G2']) {
      const preview = await service.previewDeleteTestResults(1, { scope: 'filteredGroups', searchText });
      expect(preview).toMatchObject({ persons: 65, groups: ['G2'] });
    }
    const selected = await service.previewDeleteTestResults(1, { scope: 'groups', groups: ['G1', 'G1'] });
    expect(selected).toMatchObject({ persons: 65, groups: ['G1'] });
    const foreign = await service.previewDeleteTestResults(1, { scope: 'filteredGroups', searchText: 'foreign-only' });
    expect(foreign).toMatchObject({ persons: 0, groups: [] });
  });

  it('keeps filtered person deletion limited to all matching persons over every page', async () => {
    const preview = await service.previewDeleteTestResults(1, { scope: 'filteredPersons', searchText: 'login' });
    expect(preview.persons).toBe(132);
    const exact = await service.previewDeleteTestResults(1, { scope: 'filteredPersons', searchText: 'needle' });
    expect(exact.persons).toBe(3);
  });

  it('handles an empty filter and no matches without targeting unnamed groups', async () => {
    const all = await service.previewDeleteTestResults(1, { scope: 'filteredGroups', searchText: '   ' });
    expect(all).toMatchObject({ persons: 130, groups: expect.arrayContaining(['G1', 'G2']) });
    const empty = await service.previewDeleteTestResults(1, { scope: 'filteredGroups', searchText: 'absent' });
    expect(empty).toMatchObject({ persons: 0, groups: [] });
  });
});
