import { DataSource, Repository } from 'typeorm';
import { PersonPersistenceService } from './person-persistence.service';
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
import { Person } from '../shared';

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

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...postgresConfig,
      entities: [
        Persons,
        BookletInfo,
        Booklet,
        Session,
        BookletLog,
        Unit,
        UnitLog,
        UnitLastState,
        ChunkEntity,
        ResponseEntity,
        UnitTag,
        UnitNote
      ],
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

  afterEach(async () => {
    for (const personId of cleanupPersonIds) {
      await personsRepository.delete({ id: personId });
    }

    for (const bookletInfoId of cleanupBookletInfoIds) {
      await bookletInfoRepository.delete({ id: bookletInfoId });
    }

    cleanupPersonIds = [];
    cleanupBookletInfoIds = [];
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('persists a merge upload with a new unit against the real Postgres schema', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workspaceId = 900000000 + Math.floor(Math.random() * 1000000);
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
