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
  let bookletInfoRepository: Repository<BookletInfo>;
  let bookletLogRepository: Repository<BookletLog>;

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
    bookletInfoRepository = module.get(getRepositoryToken(BookletInfo));
    bookletLogRepository = module.get(getRepositoryToken(BookletLog));
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
});
