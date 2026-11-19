import { DataSource, EntitySubscriberInterface, Repository } from 'typeorm';
import { PersonPersistenceService } from './person-persistence.service';
import Persons from '../../entities/persons.entity';
import Workspace from '../../entities/workspace.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { Session } from '../../entities/session.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { Person } from '../shared';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

// Opt-in: set POSTGRES_INTEGRATION_TESTS=true and POSTGRES_* if the local
// development defaults below do not match the target database.
const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ?
  describe :
  describe.skip;

const postgresConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  username: process.env.POSTGRES_USER || 'root',
  password: process.env.POSTGRES_PASSWORD || 'root-password',
  database: process.env.POSTGRES_DB || 'coding-box'
};

describePostgres('PersonPersistenceService Postgres integration', () => {
  let dataSource: DataSource;
  let service: PersonPersistenceService;
  let personsRepository: Repository<Persons>;
  let bookletInfoRepository: Repository<BookletInfo>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let cleanupPersonIds: number[] = [];
  let cleanupBookletInfoIds: number[] = [];
  let cleanupWorkspaceIds: number[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...postgresConfig,
      entities: [`${__dirname}/../../entities/*.entity.ts`],
      synchronize: false
    });

    await dataSource.initialize();

    personsRepository = dataSource.getRepository(Persons);
    bookletRepository = dataSource.getRepository(Booklet);
    unitRepository = dataSource.getRepository(Unit);
    responseRepository = dataSource.getRepository(ResponseEntity);
    bookletInfoRepository = dataSource.getRepository(BookletInfo);

    service = new PersonPersistenceService(
      personsRepository,
      bookletRepository,
      unitRepository,
      dataSource.getRepository(UnitLastState),
      bookletInfoRepository,
      responseRepository,
      dataSource.getRepository(ChunkEntity),
      dataSource.getRepository(BookletLog),
      dataSource.getRepository(Session),
      dataSource.getRepository(UnitLog)
    );
  }, 30000);

  it('rolls back a failed new unit and imports it successfully on a skip retry', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workspaceId = (await dataSource.getRepository(Workspace).save({ name: `rollback-${suffix}` })).id;
    cleanupWorkspaceIds.push(workspaceId);
    const person = await personsRepository.save({
      workspace_id: workspaceId,
      group: `rollback-${suffix}`,
      login: 'test',
      code: 'test',
      booklets: []
    } as Persons);
    cleanupPersonIds.push(person.id);
    const info = await bookletInfoRepository.save({ name: `rollback-${suffix}`, size: 0 } as BookletInfo);
    cleanupBookletInfoIds.push(info.id);
    const booklet = {
      id: info.name,
      logs: [],
      sessions: [],
      units: [{
        id: 'FAILED_UNIT',
        alias: 'FAILED_UNIT',
        laststate: [],
        chunks: [],
        logs: [],
        subforms: [{ id: '', responses: [{ id: 'VAR', status: 'VALUE_CHANGED', value: 'answer' }] }]
      }]
    } as Person['booklets'][number];
    const issues: TestResultsUploadIssueDto[] = [];
    const failResponses = jest.spyOn(service, 'saveSubformResponsesForUnit').mockImplementationOnce(async () => {
      throw new Error('simulated response write failure');
    });
    const failed = await service.processBookletWithTransaction(booklet, person, 'skip', issues);
    failResponses.mockRestore();

    const savedBooklet = await bookletRepository.findOneOrFail({ where: { personid: person.id, infoid: info.id } });
    expect(await unitRepository.count({ where: { bookletid: savedBooklet.id } })).toBe(0);
    expect(failed.addedUnitIds).toEqual([]);
    expect(issues).toEqual([expect.objectContaining({ level: 'error' })]);

    const retried = await service.processBookletWithTransaction(booklet, person, 'skip');
    const savedUnit = await unitRepository.findOneOrFail({ where: { bookletid: savedBooklet.id, name: 'FAILED_UNIT' } });
    expect(retried.addedUnitIds).toEqual([savedUnit.id]);
    expect(await responseRepository.find({ where: { unitid: savedUnit.id } })).toEqual([
      expect.objectContaining({ variableid: 'VAR', value: 'answer' })
    ]);
  }, 30000);

  afterEach(async () => {
    for (const personId of cleanupPersonIds) {
      await personsRepository.delete({ id: personId });
    }

    for (const bookletInfoId of cleanupBookletInfoIds) {
      await bookletInfoRepository.delete({ id: bookletInfoId });
    }

    for (const workspaceId of cleanupWorkspaceIds) {
      await dataSource.getRepository(Workspace).delete({ id: workspaceId });
    }

    cleanupPersonIds = [];
    cleanupBookletInfoIds = [];
    cleanupWorkspaceIds = [];
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it.each([false, true])('commits both cross-prefix replacements across subforms (audited=%s)', async audited => {
    const workspaceId = (await dataSource.getRepository(Workspace).save({ name: 'parallel replace' })).id;
    cleanupWorkspaceIds.push(workspaceId);
    const info = await bookletInfoRepository.save({ name: `replace-${workspaceId}`, size: 0 });
    cleanupBookletInfoIds.push(info.id);
    const person = (code: string, values: string[]): Person => ({
      workspace_id: workspaceId,
      group: 'replace',
      login: code,
      code,
      booklets: [{
        id: info.name,
        logs: [],
        sessions: [],
        units: [{
          id: code,
          alias: code,
          laststate: [],
          chunks: [],
          logs: [],
          subforms: values.map((value, index) => ({
            id: String(index), responses: [{ id: 'V', value, status: 'VALUE_CHANGED' }]
          }))
        }]
      }]
    });
    await service.processPersonBooklets([person('left', ['P', 'Q']), person('right', ['Q', 'P'])], workspaceId);
    // Both transactions must hold the dictionary lock for their first subform
    // before either removes the other prefix in its second subform.
    let resume!: () => void;
    const bothInserted = new Promise<void>(resolve => { resume = resolve; });
    let firstSubformWrites = 0;
    const barrier: EntitySubscriberInterface<ResponseEntity> = {
      listenTo: () => ResponseEntity,
      afterInsert: async event => {
        if (event.entity.subform !== '0') return;
        firstSubformWrites += 1;
        if (firstSubformWrites === 2) resume();
        await bothInserted;
      }
    };
    dataSource.subscribers.push(barrier);
    const timeout = setTimeout(resume, 5000);
    try {
      const issues: TestResultsUploadIssueDto[] = [];
      const replace = (code: string) => service.processPersonBooklets(
        [person(code, [`${code}-1`, `${code}-2`])], workspaceId, 'replace', 'person', issues, audited ? { workspaceId, source: 'upload', correlationId: code } : undefined
      );
      const results = await Promise.allSettled([replace('left'), replace('right')]);
      expect(results).toEqual(Array(2).fill({
        status: 'fulfilled', value: expect.objectContaining({ savedResponseCount: 2, deletedResponseCount: 2 })
      }));
      expect(issues).toEqual([]);
      expect(firstSubformWrites).toBe(3);
      const values = await dataSource.query(`
        SELECT value_prefix FROM flat_response_value_search_value WHERE workspace_id = $1 ORDER BY value_prefix
      `, [workspaceId]);
      expect(values.map((row: { value_prefix: string }) => row.value_prefix)).toEqual(['left-1', 'left-2', 'right-1', 'right-2']);
      const links = await dataSource.query(`
        SELECT u.unit_name AS unit, r.subform, r.value, v.value_prefix AS prefix
        FROM flat_response_value_search_link l JOIN response r ON r.id = l.id
        JOIN flat_response_value_search_value v ON v.id = l.value_id
        JOIN flat_response_unit_data u ON u.unit_id = r.unitid
        WHERE l.workspace_id = $1 ORDER BY u.unit_name, r.subform
      `, [workspaceId]);
      expect(links).toEqual(['left', 'right'].flatMap(unit => ['0', '1'].map((subform, index) => ({
        unit, subform, value: `${unit}-${index + 1}`, prefix: `${unit}-${index + 1}`
      }))));
      const journal = await dataSource.query(`
        SELECT correlation_id FROM journal_entries WHERE workspace_id = $1 AND event_type = 'TEST_RESULTS_IMPORTED'
        ORDER BY correlation_id
      `, [workspaceId]);
      expect(journal).toEqual(audited ? [{ correlation_id: 'left' }, { correlation_id: 'right' }] : []);
    } finally {
      clearTimeout(timeout);
      dataSource.subscribers.splice(dataSource.subscribers.indexOf(barrier), 1);
    }
  }, 30000);

  it('persists a merge upload with a new unit against the real Postgres schema', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workspaceId = (await dataSource.getRepository(Workspace).save({ name: `merge-${suffix}` })).id;
    cleanupWorkspaceIds.push(workspaceId);
    const bookletName = `booklet-merge-${suffix}`;
    const group = `group-${suffix}`;
    const login = `login-${suffix}`;
    const code = `code-${suffix}`;

    const person = await personsRepository.save({
      workspace_id: workspaceId,
      group,
      login,
      code,
      booklets: []
    } as Persons);
    cleanupPersonIds.push(person.id);

    const bookletInfo = await bookletInfoRepository.save({
      name: bookletName,
      size: 0
    } as BookletInfo);
    cleanupBookletInfoIds.push(bookletInfo.id);

    const booklet = await bookletRepository.save({
      personid: person.id,
      infoid: bookletInfo.id,
      firstts: 1,
      lastts: 1
    } as Booklet);
    const existingUnit = await unitRepository.save({
      bookletid: booklet.id,
      name: 'UNIT_EXISTING',
      alias: 'UNIT_EXISTING'
    } as Unit);
    const existingResponse = await responseRepository.save({
      unitid: existingUnit.id,
      variableid: 'VAR_EXISTING',
      status: 3,
      value: 'existing-answer',
      subform: ''
    } as ResponseEntity);

    const importedPerson: Person = {
      workspace_id: workspaceId,
      group,
      login,
      code,
      booklets: [
        {
          id: bookletName,
          logs: [],
          sessions: [],
          units: [
            {
              id: 'UNIT_NEW',
              alias: 'UNIT_NEW_ORIGINAL',
              laststate: [{ key: 'unitState', value: 'new' }],
              chunks: [
                {
                  id: 'chunk-1',
                  type: 'state',
                  ts: 123,
                  variables: ['VAR_NEW']
                }
              ],
              subforms: [
                {
                  id: '',
                  responses: [
                    {
                      id: 'VAR_NEW',
                      status: 'VALUE_CHANGED',
                      value: 'new-answer'
                    }
                  ]
                }
              ],
              logs: []
            }
          ]
        }
      ]
    };

    const result = await service.processPersonBooklets(
      [importedPerson],
      workspaceId,
      'merge',
      'person'
    );

    const units = await unitRepository.find({
      where: { bookletid: booklet.id },
      order: { id: 'ASC' }
    });
    const newUnit = units.find(unit => unit.name === 'UNIT_NEW');
    const unchangedResponse = await responseRepository.findOneOrFail({
      where: { id: existingResponse.id }
    });
    const newResponses = await responseRepository.find({
      where: { unitid: newUnit?.id },
      order: { id: 'ASC' }
    });

    expect(newUnit).toMatchObject({
      bookletid: booklet.id,
      name: 'UNIT_NEW',
      alias: 'UNIT_NEW_ORIGINAL'
    });
    expect(unchangedResponse).toMatchObject({
      unitid: existingUnit.id,
      variableid: 'VAR_EXISTING',
      value: 'existing-answer'
    });
    expect(newResponses).toEqual([
      expect.objectContaining({
        unitid: newUnit?.id,
        variableid: 'VAR_NEW',
        status: 3,
        value: 'new-answer',
        subform: ''
      })
    ]);
    expect(result).toMatchObject({
      addedUnitIds: [newUnit?.id],
      changedUnitIds: [],
      skippedExistingUnitIds: [],
      addedResponseCount: 1,
      changedResponseCount: 0,
      savedResponseCount: 1,
      deletedResponseCount: 0,
      skippedExistingResponseCount: 0
    });
  }, 30000);
});
