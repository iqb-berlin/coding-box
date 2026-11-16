import { PassThrough } from 'node:stream';
import { createMock } from '@golevelup/ts-jest';
import { parseString } from 'fast-csv';
import { CacheService } from '../cache/cache.service';
import { Booklet } from './entities/booklet.entity';
import { BookletInfo } from './entities/bookletInfo.entity';
import { BookletLog } from './entities/bookletLog.entity';
import { ChunkEntity } from './entities/chunk.entity';
import FileUpload from './entities/file_upload.entity';
import Persons from './entities/persons.entity';
import { ResponseEntity } from './entities/response.entity';
import { Session } from './entities/session.entity';
import { Unit } from './entities/unit.entity';
import { UnitLastState } from './entities/unitLastState.entity';
import { UnitLog } from './entities/unitLog.entity';
import Workspace from './entities/workspace.entity';
import { KappaPostgresFixture } from './services/coding/kappa-query.postgres.test.factory';
import { Person } from './services/shared';
import { PersonPersistenceService } from './services/test-results/person-persistence.service';
import { TestResultsAnomaliesService } from './services/test-results/test-results-anomalies.service';
import { TestResultsExportService } from './services/test-results/test-results-export.service';
import { TestResultsReplayService } from './services/test-results/test-results-replay.service';
import { WorkspaceExclusionService } from './services/workspace/workspace-exclusion.service';

const describePostgres = process.env.KAPPA_QUERY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('Chunk and unit last-state identities in PostgreSQL', () => {
  const fixture = new KappaPostgresFixture();
  let legacyUnitId: number;
  let legacyStates: { id: number; key: string; value: string }[];
  beforeAll(async () => fixture.open(process.env.KAPPA_QUERY_TEST_DATABASE_URL!, {
    file: 'coding-box.changelog-chunk-state-identity.sql',
    seed: async db => {
      const [workspace] = await db.query("INSERT INTO workspace(name) VALUES ('Legacy identity') RETURNING id");
      const [person] = await db.query(`INSERT INTO persons(workspace_id,"group",login,code)
        VALUES($1,'legacy','legacy','legacy') RETURNING id`, [workspace.id]);
      const [info] = await db.query("INSERT INTO bookletinfo(name,size) VALUES('LEGACY',0) RETURNING id");
      const [booklet] = await db.query('INSERT INTO booklet(infoid,personid) VALUES($1,$2) RETURNING id', [info.id, person.id]);
      const [unit] = await db.query("INSERT INTO unit(bookletid,name) VALUES($1,'LEGACY') RETURNING id", [booklet.id]);
      legacyUnitId = unit.id;
      // Identical chunks are intentionally retained; the migration must not invent deduplication rules.
      await db.query("INSERT INTO chunk(unitid,key) VALUES($1,'same'),($1,'same')", [legacyUnitId]);
      legacyStates = await db.query(
        "INSERT INTO unitlaststate(unitid,key,value) VALUES($1,'a','A'),($1,'b','B') RETURNING id,key,value",
        [legacyUnitId]
      );
    }
  }), 60000);
  afterAll(async () => fixture.close());

  it('retains duplicate chunks and existing state IDs when migrating populated units', async () => {
    const unit = await fixture.db.getRepository(Unit).findOneOrFail({
      where: { id: legacyUnitId },
      relations: { chunks: true, unitLastStates: true }
    });

    expect(unit.chunks.map(chunk => chunk.key)).toEqual(['same', 'same']);
    expect(unit.unitLastStates).toHaveLength(2);
    expect(unit.unitLastStates).toEqual(expect.arrayContaining(legacyStates.map(state => expect.objectContaining(state))));
  });

  it('imports, reads, exports and replays every chunk and laststate row for one unit', async () => {
    const { db } = fixture;
    const repo = <T extends object>(target: { new(): T }) => db.getRepository(target);
    const workspace = await fixture.workspace('Multirow identity');
    const person = await repo(Persons).save({
      workspace_id: workspace.workspaceId, group: 'g', login: 'l', code: 'c', booklets: []
    });
    const persistence = new PersonPersistenceService(
      repo(Persons),
      repo(Booklet),
      repo(Unit),
      repo(UnitLastState),
      repo(BookletInfo),
      repo(ResponseEntity),
      repo(ChunkEntity),
      repo(BookletLog),
      repo(Session),
      repo(UnitLog)
    );
    const booklet = {
      id: 'MULTIROW',
      units: [{
        id: 'UNIT',
        alias: 'UNIT',
        laststate: [{ key: 'PAGE', value: 'p1' }, { key: 'STATUS', value: 'done' }],
        chunks: [
          {
            id: 'a', type: 'state', ts: 10, variables: ['V1']
          },
          {
            id: 'b', type: 'state', ts: 20, variables: ['V2']
          }
        ],
        subforms: [{
          id: '',
          responses: [
            { id: 'V1', status: 'VALUE_CHANGED', value: 'one' },
            { id: 'V2', status: 'VALUE_CHANGED', value: 'two' }
          ]
        }]
      }]
    } as Person['booklets'][number];
    await persistence.processBookletWithTransaction(booklet, person, 'merge');
    const unit = await repo(Unit).findOneByOrFail({ name: 'UNIT' });
    expect(await repo(ChunkEntity).find({ where: { unitid: unit.id } })).toHaveLength(2);
    expect(await repo(UnitLastState).find({ where: { unitid: unit.id } })).toHaveLength(2);
    // Reimport remains idempotent even though chunk ids change.
    await persistence.processBookletWithTransaction(booklet, person, 'merge');
    expect(await repo(ChunkEntity).countBy({ unitid: unit.id })).toBe(2);
    expect(await repo(UnitLastState).countBy({ unitid: unit.id })).toBe(2);

    const cache = createMock<CacheService>({
      get: jest.fn(async (key: string) => (key === 'test:v6' ? { responses: [{ id: 'old-incomplete-result' }] } : null)),
      generateUnitResponseCacheKey: () => 'test'
    });
    const exclusions = new WorkspaceExclusionService(repo(Workspace), repo(FileUpload), cache);
    const exporter = new TestResultsExportService(
      repo(Persons),
      repo(Unit),
      repo(Booklet),
      repo(ResponseEntity),
      repo(BookletLog),
      repo(Session),
      repo(UnitLog),
      repo(ChunkEntity),
      db,
      exclusions,
      createMock<TestResultsAnomaliesService>()
    );
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', data => chunks.push(Buffer.from(data)));
    await exporter.exportTestResultsToStream(workspace.workspaceId, stream);
    const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
      const output: Record<string, string>[] = [];
      parseString(Buffer.concat(chunks).toString('utf8'), { headers: true, delimiter: ';' })
        .on('data', row => output.push(row)).on('error', reject).on('end', () => resolve(output));
    });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].laststate)).toEqual({ PAGE: 'p1', STATUS: 'done' });
    expect(JSON.parse(rows[0].responses).map((chunk: { id: string }) => chunk.id).sort()).toEqual(['a', 'b']);
    const replay = new TestResultsReplayService(
      repo(Persons), repo(Unit), repo(Booklet), repo(ResponseEntity), repo(BookletInfo), repo(ChunkEntity), cache, exclusions
    );
    const result = await replay.findUnitResponse(workspace.workspaceId, 'l@c@g@MULTIROW', 'UNIT');
    expect(result.responses.map(chunk => chunk.id).sort()).toEqual(['a', 'b']);
  });
});
