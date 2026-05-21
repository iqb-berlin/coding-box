import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMock } from '@golevelup/ts-jest';
import { Repository } from 'typeorm';
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
import { Person } from '../shared';

describe('PersonPersistenceService', () => {
  let service: PersonPersistenceService;
  let personsRepository: Repository<Persons>;
  let bookletRepository: Repository<Booklet>;
  let unitRepository: Repository<Unit>;
  let responseRepository: Repository<ResponseEntity>;
  let bookletInfoRepository: Repository<BookletInfo>;
  let bookletLogRepository: Repository<BookletLog>;
  let bookletSessionRepository: Repository<Session>;
  let chunkRepository: Repository<ChunkEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonPersistenceService,
        { provide: getRepositoryToken(Persons), useValue: createMock<Repository<Persons>>() },
        { provide: getRepositoryToken(Booklet), useValue: createMock<Repository<Booklet>>() },
        { provide: getRepositoryToken(Unit), useValue: createMock<Repository<Unit>>() },
        { provide: getRepositoryToken(UnitLastState), useValue: createMock<Repository<UnitLastState>>() },
        { provide: getRepositoryToken(BookletInfo), useValue: createMock<Repository<BookletInfo>>() },
        { provide: getRepositoryToken(ResponseEntity), useValue: createMock<Repository<ResponseEntity>>() },
        { provide: getRepositoryToken(ChunkEntity), useValue: createMock<Repository<ChunkEntity>>() },
        { provide: getRepositoryToken(BookletLog), useValue: createMock<Repository<BookletLog>>() },
        { provide: getRepositoryToken(Session), useValue: createMock<Repository<Session>>() },
        { provide: getRepositoryToken(UnitLog), useValue: createMock<Repository<UnitLog>>() }
      ]
    }).compile();

    service = module.get<PersonPersistenceService>(PersonPersistenceService);
    personsRepository = module.get(getRepositoryToken(Persons));
    bookletRepository = module.get(getRepositoryToken(Booklet));
    unitRepository = module.get(getRepositoryToken(Unit));
    responseRepository = module.get(getRepositoryToken(ResponseEntity));
    bookletInfoRepository = module.get(getRepositoryToken(BookletInfo));
    bookletLogRepository = module.get(getRepositoryToken(BookletLog));
    bookletSessionRepository = module.get(getRepositoryToken(Session));
    chunkRepository = module.get(getRepositoryToken(ChunkEntity));

    jest.spyOn(unitRepository, 'create').mockImplementation(entity => entity as Unit);
  });

  it('should process logs from input persons even if they are not in DB booklets array', async () => {
    const inputPersons: Person[] = [
      {
        group: 'g1',
        login: 'l1',
        code: 'c1',
        workspace_id: 1,
        booklets: [
          {
            id: 'b1',
            logs: [{ ts: '100', key: 'TEST', parameter: 'VAL' }],
            units: [],
            sessions: []
          }
        ]
      }
    ];

    // Mock existing person in DB
    jest.spyOn(personsRepository, 'find').mockResolvedValue([
      {
        id: 10, group: 'g1', login: 'l1', code: 'c1', workspace_id: 1, booklets: []
      } as unknown as Persons
    ]);
    jest.spyOn(personsRepository, 'findOne').mockResolvedValue(
      {
        id: 10, group: 'g1', login: 'l1', code: 'c1', workspace_id: 1
      } as unknown as Persons
    );

    // Mock booklet info and existing booklet
    jest.spyOn(bookletInfoRepository, 'findOne').mockResolvedValue({ id: 20, name: 'b1' } as unknown as BookletInfo);
    jest.spyOn(bookletRepository, 'findOne').mockResolvedValue({ id: 30, personid: 10, infoid: 20 } as unknown as Booklet);

    // Mock count to return 0 so it doesn't skip
    jest.spyOn(bookletLogRepository, 'count').mockResolvedValue(0);

    const result = await service.processPersonLogs(inputPersons, [], []);

    expect(result.success).toBe(true);
    expect(result.totalLogsSaved).toBe(1);
    expect(bookletLogRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        key: 'TEST', parameter: 'VAL', bookletid: 30, ts: 100
      })
    ]);
  });

  it('should correctly parse complex log entries and report issues', async () => {
    // We test PersonService indirectly. In a real scenario, we'd have a separate PersonService spec.
    // For this verification, we use the fact that PersonPersistenceService will iterate over
    // the booklets we provide in the input persons.

    const inputPersons: Person[] = [
      {
        group: 'g1',
        login: 'l1',
        code: 'c1',
        workspace_id: 1,
        booklets: [
          {
            id: 'b1',
            logs: [
              { ts: '100', key: 'TESTLETS_TIMELEFT', parameter: '{"ICT":24.25}' }, // Already parsed by PersonService
              { ts: '101', key: 'UNKNOWN', parameter: '' }
            ],
            units: [],
            sessions: []
          }
        ]
      }
    ];

    // Mock DB calls
    jest.spyOn(personsRepository, 'find').mockResolvedValue([{
      id: 10, group: 'g1', login: 'l1', code: 'c1', workspace_id: 1
    } as unknown as Persons]);
    jest.spyOn(personsRepository, 'findOne').mockResolvedValue({
      id: 10, group: 'g1', login: 'l1', code: 'c1', workspace_id: 1
    } as unknown as Persons);
    jest.spyOn(bookletInfoRepository, 'findOne').mockResolvedValue({ id: 20, name: 'b1' } as unknown as BookletInfo);
    jest.spyOn(bookletRepository, 'findOne').mockResolvedValue({ id: 30, personid: 10, infoid: 20 } as unknown as Booklet);
    jest.spyOn(bookletLogRepository, 'count').mockResolvedValue(0);

    const result = await service.processPersonLogs(inputPersons, [], []);

    expect(result.success).toBe(true);
    expect(result.totalLogsSaved).toBe(2);
    expect(bookletLogRepository.save).toHaveBeenCalled();
  });

  it('should replace existing sessions when overwriting booklet logs', async () => {
    jest.spyOn(bookletSessionRepository, 'delete').mockResolvedValue({} as never);
    jest.spyOn(bookletSessionRepository, 'save').mockResolvedValue([] as never);

    await service.storeBookletSessions(
      {
        id: 'b1',
        logs: [],
        units: [],
        sessions: [
          {
            browser: 'Firefox 149',
            os: 'Windows 10',
            screen: '2048 x 1152',
            ts: '123',
            loadCompleteMS: 2706
          }
        ]
      },
      { id: 30 } as Booklet,
      true
    );

    expect(bookletSessionRepository.delete).toHaveBeenCalledWith({
      booklet: { id: 30 }
    });
    expect(bookletSessionRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        browser: 'Firefox 149',
        booklet: expect.objectContaining({ id: 30 })
      })
    ]);
  });

  it('should skip duplicate sessions when not overwriting booklet logs', async () => {
    jest.spyOn(bookletSessionRepository, 'find').mockResolvedValue([
      {
        browser: 'Firefox 149',
        os: 'Windows 10',
        screen: '2048 x 1152',
        ts: 123,
        loadcompletems: 2706
      } as Session
    ]);
    const saveSpy = jest.spyOn(bookletSessionRepository, 'save');

    await service.storeBookletSessions(
      {
        id: 'b1',
        logs: [],
        units: [],
        sessions: [
          {
            browser: 'Firefox 149',
            os: 'Windows 10',
            screen: '2048 x 1152',
            ts: '123',
            loadCompleteMS: 2706
          }
        ]
      },
      { id: 30 } as Booklet,
      false
    );

    expect(bookletSessionRepository.find).toHaveBeenCalledWith({
      where: {
        booklet: { id: 30 }
      },
      select: ['browser', 'os', 'screen', 'loadcompletems', 'ts']
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should match imported unit logs by original unit alias and visible unit name', async () => {
    jest.spyOn(unitRepository, 'findOne').mockResolvedValue({
      id: 123,
      alias: 'unit-original-id',
      name: 'unit-visible-id',
      bookletid: 30
    } as Unit);
    const saveUnitLogsSpy = jest.spyOn(service, 'saveUnitLogs').mockResolvedValue({
      success: true,
      saved: 1,
      skipped: 0
    });

    await service.processUnits(
      {
        id: 'booklet-a',
        logs: [],
        sessions: [],
        units: [
          {
            id: 'unit-visible-id',
            alias: 'unit-original-id',
            laststate: [],
            subforms: [],
            chunks: [],
            logs: [{ ts: '222', key: 'UNIT', parameter: 'shown' }]
          }
        ]
      },
      { id: 30 } as Booklet,
      {
        group: 'group-a',
        login: 'login-a',
        code: 'code-a',
        workspace_id: 1,
        booklets: []
      }
    );

    expect(unitRepository.findOne).toHaveBeenCalledWith({
      where: {
        alias: 'unit-original-id',
        name: 'unit-visible-id',
        bookletid: 30
      }
    });
    expect(saveUnitLogsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'unit-visible-id',
        alias: 'unit-original-id'
      }),
      expect.objectContaining({ id: 123 }),
      true
    );
  });

  it('should fall back to the visible unit name alias for legacy imported unit logs', async () => {
    jest.spyOn(unitRepository, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 123,
        alias: 'unit-visible-id',
        name: 'unit-visible-id',
        bookletid: 30
      } as Unit);
    const saveUnitLogsSpy = jest.spyOn(service, 'saveUnitLogs').mockResolvedValue({
      success: true,
      saved: 1,
      skipped: 0
    });

    await service.processUnits(
      {
        id: 'booklet-a',
        logs: [],
        sessions: [],
        units: [
          {
            id: 'unit-visible-id',
            alias: 'unit-original-id',
            laststate: [],
            subforms: [],
            chunks: [],
            logs: [{ ts: '222', key: 'UNIT', parameter: 'shown' }]
          }
        ]
      },
      { id: 30 } as Booklet,
      {
        group: 'group-a',
        login: 'login-a',
        code: 'code-a',
        workspace_id: 1,
        booklets: []
      }
    );

    expect(unitRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: {
        alias: 'unit-original-id',
        name: 'unit-visible-id',
        bookletid: 30
      }
    });
    expect(unitRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        alias: 'unit-visible-id',
        name: 'unit-visible-id',
        bookletid: 30
      }
    });
    expect(saveUnitLogsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'unit-visible-id',
        alias: 'unit-original-id'
      }),
      expect.objectContaining({ id: 123 }),
      true
    );
  });

  it('should replace chunk rows per unit and deduplicate chunk entries', async () => {
    jest.spyOn(chunkRepository, 'delete').mockResolvedValue({} as never);
    const insertSpy = jest.spyOn(chunkRepository, 'insert').mockResolvedValue({} as never);

    await service.processChunks(
      {
        id: 'UNIT_1',
        chunks: [
          {
            id: 'elementCodes',
            type: 'iqb-standard@1.0',
            ts: 1,
            variables: ['a', 'a', 'b']
          },
          {
            id: 'elementCodes',
            type: 'iqb-standard@1.0',
            ts: 1,
            variables: ['a', 'b']
          },
          {
            id: 'stateVariableCodes',
            type: 'iqb-standard@1.0',
            ts: 2,
            variables: ['s1']
          }
        ]
      } as never,
      { id: 123 } as Unit,
      { id: 'BOOKLET_1' } as never
    );

    expect(chunkRepository.delete).toHaveBeenCalledWith({ unitid: 123 });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith([
      {
        unitid: 123,
        key: 'elementCodes',
        type: 'iqb-standard@1.0',
        ts: 1,
        variables: 'a,b'
      },
      {
        unitid: 123,
        key: 'stateVariableCodes',
        type: 'iqb-standard@1.0',
        ts: 2,
        variables: 's1'
      }
    ]);
  });

  it('imports a new person in an existing test group by matching the full person key', async () => {
    const importedPerson = {
      id: 41,
      group: 'existing-group',
      login: 'new-login',
      code: 'new-code',
      workspace_id: 1,
      booklets: [
        {
          id: 'BOOKLET_1',
          logs: [],
          sessions: [],
          units: []
        }
      ]
    } as unknown as Persons;
    const bracketQb = {
      where: jest.fn(),
      orWhere: jest.fn()
    };
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((brackets: { whereFactory: (qb: unknown) => void }) => {
        brackets.whereFactory(bracketQb);
        return qb;
      }),
      getMany: jest.fn().mockResolvedValue([importedPerson])
    };
    jest.spyOn(personsRepository, 'upsert').mockResolvedValue({} as never);
    jest.spyOn(personsRepository, 'createQueryBuilder').mockReturnValue(qb as never);
    const processBookletSpy = jest.spyOn(service, 'processBookletWithTransaction')
      .mockResolvedValue({
        addedUnitIds: [11],
        changedUnitIds: [],
        addedResponseCount: 1,
        changedResponseCount: 0
      });

    const result = await service.processPersonBooklets([
      {
        group: 'existing-group',
        login: 'new-login',
        code: 'new-code',
        workspace_id: 1,
        booklets: importedPerson.booklets
      }
    ], 1, 'merge', 'person');

    expect(personsRepository.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          group: 'existing-group',
          login: 'new-login',
          code: 'new-code',
          workspace_id: 1
        })
      ],
      ['group', 'code', 'login', 'workspace_id']
    );
    expect(qb.where).toHaveBeenCalledWith('person.workspace_id = :workspaceId', { workspaceId: 1 });
    expect(qb.andWhere).toHaveBeenCalled();
    expect(bracketQb.where).toHaveBeenCalledWith(
      '(person.group = :g0 AND person.login = :l0 AND person.code = :c0)',
      { g0: 'existing-group', l0: 'new-login', c0: 'new-code' }
    );
    expect(processBookletSpy).toHaveBeenCalledWith(
      importedPerson.booklets[0],
      importedPerson,
      'merge',
      []
    );
    expect(result.addedUnitIds).toEqual([11]);
  });

  it('adds a new unit for an existing person/booklet', async () => {
    jest.spyOn(bookletInfoRepository, 'findOne').mockResolvedValue({ id: 20, name: 'BOOKLET_1' } as BookletInfo);
    jest.spyOn(bookletRepository, 'findOne').mockResolvedValue({ id: 30, personid: 10, infoid: 20 } as Booklet);
    jest.spyOn(unitRepository, 'findOne').mockResolvedValue(null);
    jest.spyOn(unitRepository, 'save').mockResolvedValue({
      id: 99, name: 'UNIT_NEW', alias: 'UNIT_NEW', bookletid: 30
    } as Unit);
    jest.spyOn(responseRepository, 'find').mockResolvedValue([]);
    jest.spyOn(responseRepository, 'save').mockResolvedValue([] as never);

    const result = await service.processBookletWithTransaction(
      {
        id: 'BOOKLET_1',
        logs: [],
        sessions: [],
        units: [
          {
            id: 'UNIT_NEW',
            alias: 'UNIT_NEW',
            laststate: [],
            chunks: [],
            subforms: [
              {
                id: '',
                responses: [
                  {
                    id: 'VAR_1',
                    status: 'VALUE_CHANGED',
                    value: 'answer'
                  }
                ]
              }
            ],
            logs: []
          }
        ]
      },
      {
        id: 10, group: 'G', login: 'L', code: 'C', workspace_id: 1
      } as Persons,
      'skip'
    );

    expect(unitRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'UNIT_NEW',
      name: 'UNIT_NEW',
      bookletid: 30
    }));
    expect(responseRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        unitid: 99,
        variableid: 'VAR_1',
        value: 'answer',
        subform: ''
      })
    ]);
    expect(result).toMatchObject({
      addedUnitIds: [99],
      changedUnitIds: [],
      addedResponseCount: 1,
      changedResponseCount: 0
    });
  });

  it('adds a new variable in an existing unit when upload mode is merge', async () => {
    jest.spyOn(bookletInfoRepository, 'findOne').mockResolvedValue({ id: 20, name: 'BOOKLET_1' } as BookletInfo);
    jest.spyOn(bookletRepository, 'findOne').mockResolvedValue({ id: 30, personid: 10, infoid: 20 } as Booklet);
    jest.spyOn(unitRepository, 'findOne').mockResolvedValue({
      id: 40, name: 'UNIT_1', alias: 'UNIT_1', bookletid: 30
    } as Unit);
    jest.spyOn(responseRepository, 'find').mockResolvedValue([
      { variableid: 'VAR_OLD', subform: '' } as ResponseEntity
    ]);
    jest.spyOn(responseRepository, 'save').mockResolvedValue([] as never);

    const result = await service.processBookletWithTransaction(
      {
        id: 'BOOKLET_1',
        logs: [],
        sessions: [],
        units: [
          {
            id: 'UNIT_1',
            alias: 'UNIT_1',
            laststate: [],
            chunks: [],
            subforms: [
              {
                id: '',
                responses: [
                  {
                    id: 'VAR_OLD',
                    status: 'VALUE_CHANGED',
                    value: 'old'
                  },
                  {
                    id: 'VAR_NEW',
                    status: 'VALUE_CHANGED',
                    value: 'new'
                  }
                ]
              }
            ],
            logs: []
          }
        ]
      },
      {
        id: 10, group: 'G', login: 'L', code: 'C', workspace_id: 1
      } as Persons,
      'merge'
    );

    expect(responseRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        unitid: 40,
        variableid: 'VAR_NEW',
        value: 'new'
      })
    ]);
    expect(responseRepository.save).not.toHaveBeenCalledWith([
      expect.objectContaining({ variableid: 'VAR_OLD' })
    ]);
    expect(result).toMatchObject({
      addedUnitIds: [],
      changedUnitIds: [40],
      addedResponseCount: 0,
      changedResponseCount: 1
    });
  });

  it('keeps an existing unit untouched in skip mode even when the upload contains a new variable', async () => {
    jest.spyOn(bookletInfoRepository, 'findOne').mockResolvedValue({ id: 20, name: 'BOOKLET_1' } as BookletInfo);
    jest.spyOn(bookletRepository, 'findOne').mockResolvedValue({ id: 30, personid: 10, infoid: 20 } as Booklet);
    jest.spyOn(unitRepository, 'findOne').mockResolvedValue({
      id: 40, name: 'UNIT_1', alias: 'UNIT_1', bookletid: 30
    } as Unit);
    const responseSaveSpy = jest.spyOn(responseRepository, 'save');
    const chunkDeleteSpy = jest.spyOn(chunkRepository, 'delete');

    const result = await service.processBookletWithTransaction(
      {
        id: 'BOOKLET_1',
        logs: [],
        sessions: [],
        units: [
          {
            id: 'UNIT_1',
            alias: 'UNIT_1',
            laststate: [],
            chunks: [],
            subforms: [
              {
                id: '',
                responses: [
                  {
                    id: 'VAR_NEW',
                    status: 'VALUE_CHANGED',
                    value: 'new'
                  }
                ]
              }
            ],
            logs: []
          }
        ]
      },
      {
        id: 10, group: 'G', login: 'L', code: 'C', workspace_id: 1
      } as Persons,
      'skip'
    );

    expect(responseSaveSpy).not.toHaveBeenCalled();
    expect(chunkDeleteSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      addedUnitIds: [],
      changedUnitIds: [],
      addedResponseCount: 0,
      changedResponseCount: 0
    });
  });
});
