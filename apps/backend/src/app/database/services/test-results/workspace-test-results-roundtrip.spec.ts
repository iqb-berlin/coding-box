import { PassThrough } from 'stream';
import { Job } from 'bull';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMock } from '@golevelup/ts-jest';
import { DataSource, Repository } from 'typeorm';
import { WorkspaceTestResultsService } from './workspace-test-results.service';
import { UploadResultsService } from './upload-results.service';
import { PersonService } from './person.service';
import { PersonQueryService } from './person-query.service';
import { PersonPersistenceService } from './person-persistence.service';
import { ResponseManagementService } from './response-management.service';
import Persons from '../../entities/persons.entity';
import { Unit } from '../../entities/unit.entity';
import { Booklet } from '../../entities/booklet.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { Session } from '../../entities/session.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import { UnitLastState } from '../../entities/unitLastState.entity';
import { UnitTagService } from '../workspace/unit-tag.service';
import { JournalService, Person } from '../shared';
import { CacheService } from '../../../cache/cache.service';
import { CodingListService } from '../coding/coding-list.service';
import { CodingValidationService } from '../coding/coding-validation.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import {
  JobQueueService,
  TestResultsUploadJobData
} from '../../../job-queue/job-queue.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';

type QueryBuilderMock<T = unknown> = {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  innerJoin: jest.Mock;
  orderBy: jest.Mock;
  take: jest.Mock;
  getCount: jest.Mock<Promise<number>>;
  getMany: jest.Mock<Promise<T[]>>;
  getRawMany: jest.Mock<Promise<T[]>>;
};

const queryBuilder = <T = unknown>(
  overrides: Partial<QueryBuilderMock<T>> = {}
): QueryBuilderMock<T> => {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    innerJoin: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([])
  } as QueryBuilderMock<T>;

  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.innerJoin.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);

  return Object.assign(qb, overrides);
};

const collectStream = async (
  writeToStream: (stream: PassThrough) => Promise<void>
): Promise<string> => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
  await writeToStream(stream);
  return Buffer.concat(chunks).toString('utf8');
};

const tempCsvFile = (content: string, prefix: string): FileIo => {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.csv`
  );
  fs.writeFileSync(filePath, content);
  return {
    buffer: Buffer.from(content),
    originalname: path.basename(filePath),
    mimetype: 'text/csv',
    size: content.length,
    fieldname: 'files',
    encoding: 'utf-8',
    path: filePath
  };
};

describe('test results export/import roundtrip', () => {
  const workspaceId = 1;
  let capturedResponsePersons: Person[] = [];
  let capturedLogPersons: Person[] = [];

  const createWorkspaceService = (): WorkspaceTestResultsService => {
    const sourcePerson = { group: 'group-a', login: 'login-a', code: 'code-a' };
    const sourceBookletInfo = { name: 'booklet-a' };
    const sourceBooklet = {
      id: 20,
      person: sourcePerson,
      bookletinfo: sourceBookletInfo
    };
    const sourceUnit = {
      id: 30,
      name: 'unit-visible-id',
      alias: 'unit-original-id',
      booklet: sourceBooklet
    };
    const sourceResponse = {
      id: 40,
      unitid: 30,
      variableid: 'var-a',
      status: 3,
      value: JSON.stringify(['answer-a']),
      subform: 'subform-a',
      code_v1: 99,
      score_v1: 1,
      status_v1: 5
    };
    const sourceChunk = {
      unitid: 30,
      key: 'chunk-a',
      variables: 'var-a',
      ts: 123456,
      type: 'state'
    };
    const sourceLastState = {
      unitid: 30,
      key: 'unitState',
      value: 'done'
    };
    const sourceBookletLog = {
      id: 50,
      ts: 111,
      key: 'BOOKLET',
      parameter: 'started',
      groupname: 'group-a',
      loginname: 'login-a',
      code: 'code-a',
      bookletname: 'booklet-a'
    };
    const sourceUnitLog = {
      id: 60,
      ts: 222,
      key: 'UNIT',
      parameter: 'shown',
      unitname: 'unit-visible-id',
      originalUnitId: 'unit-original-id',
      groupname: 'group-a',
      loginname: 'login-a',
      code: 'code-a',
      bookletname: 'booklet-a'
    };

    let unitBatch = 0;
    let bookletLogBatch = 0;
    let unitLogBatch = 0;

    const unitRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder<Unit>({
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockImplementation(async () => {
          const result = unitBatch === 0 ? [sourceUnit as unknown as Unit] : [];
          unitBatch += 1;
          return result;
        })
      }))
    } as unknown as Repository<Unit>;

    const responseRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder<ResponseEntity>({
        getMany: jest.fn().mockResolvedValue([
          sourceResponse as unknown as ResponseEntity
        ])
      }))
    } as unknown as Repository<ResponseEntity>;

    const chunkRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder<ChunkEntity>({
        getMany: jest.fn().mockResolvedValue([
          sourceChunk as unknown as ChunkEntity
        ])
      }))
    } as unknown as Repository<ChunkEntity>;

    const bookletLogRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder<typeof sourceBookletLog>({
        getCount: jest.fn().mockResolvedValue(1),
        getRawMany: jest.fn().mockImplementation(async () => {
          const result = bookletLogBatch === 0 ? [sourceBookletLog] : [];
          bookletLogBatch += 1;
          return result;
        })
      }))
    } as unknown as Repository<BookletLog>;

    const unitLogRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder<typeof sourceUnitLog>({
        getCount: jest.fn().mockResolvedValue(1),
        getRawMany: jest.fn().mockImplementation(async () => {
          const result = unitLogBatch === 0 ? [sourceUnitLog] : [];
          unitLogBatch += 1;
          return result;
        })
      }))
    } as unknown as Repository<UnitLog>;

    const dataSource = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder<UnitLastState>({
          getMany: jest.fn().mockResolvedValue([
            sourceLastState as unknown as UnitLastState
          ])
        }))
      }))
    } as unknown as DataSource;

    return new WorkspaceTestResultsService(
      createMock<Repository<Persons>>(),
      unitRepository,
      createMock<Repository<Booklet>>(),
      responseRepository,
      createMock<Repository<BookletInfo>>(),
      bookletLogRepository,
      createMock<Repository<Session>>(),
      unitLogRepository,
      chunkRepository,
      dataSource,
      createMock<UnitTagService>(),
      createMock<JournalService>(),
      createMock<CacheService>(),
      createMock<CodingListService>(),
      createMock<CodingValidationService>(),
      createMock<ResponseManagementService>(),
      createMock<WorkspaceCoreService>(),
      createMock<WorkspaceExclusionService>()
    );
  };

  const createUploadService = (): UploadResultsService => {
    const queryService = createMock<PersonQueryService>({
      getWorkspaceUploadStats: jest.fn().mockResolvedValue({
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0
      })
    });
    const persistenceService = createMock<PersonPersistenceService>({
      processPersonBooklets: jest.fn().mockImplementation(async persons => {
        capturedResponsePersons = persons;
      }),
      processPersonLogs: jest.fn().mockImplementation(async persons => {
        capturedLogPersons = persons;
        return {
          success: true,
          totalBooklets: 1,
          totalLogsSaved: 2,
          totalLogsSkipped: 0
        };
      })
    });

    return new UploadResultsService(
      new PersonService(queryService, persistenceService),
      createMock<JobQueueService>()
    );
  };

  const processCsv = async (
    service: UploadResultsService,
    fileContent: string,
    resultType: 'responses' | 'logs'
  ): Promise<void> => {
    const file = tempCsvFile(fileContent, `roundtrip-${resultType}`);
    await service.processUpload(createMock<Job<TestResultsUploadJobData>>({
      id: `roundtrip-${resultType}`,
      progress: jest.fn().mockResolvedValue(undefined),
      data: {
        workspaceId,
        file,
        resultType,
        overwriteExisting: true,
        personMatchMode: 'strict',
        overwriteMode: 'replace',
        scope: 'person'
      }
    }));
  };

  it('keeps originalUnitId when exported test results and logs are imported again', async () => {
    const exportService = createWorkspaceService();
    const uploadService = createUploadService();

    const responsesCsv = await collectStream(stream => (
      exportService.exportTestResultsToStream(workspaceId, stream)
    ));
    await processCsv(uploadService, responsesCsv, 'responses');

    const responseUnit = capturedResponsePersons[0].booklets[0].units[0];
    expect(responseUnit.id).toBe('unit-visible-id');
    expect(responseUnit.alias).toBe('unit-original-id');
    expect(responseUnit.subforms[0].responses[0]).toMatchObject({
      id: 'var-a',
      value: ['answer-a'],
      status: 'VALUE_CHANGED'
    });
    expect(responseUnit.laststate).toEqual([
      { key: 'unitState', value: 'done' }
    ]);
    expect(responseUnit.chunks).toEqual([
      {
        id: 'chunk-a',
        type: 'state',
        ts: 123456,
        variables: ['var-a']
      }
    ]);

    const logsCsv = await collectStream(stream => (
      exportService.exportTestLogsToStream(workspaceId, stream)
    ));
    await processCsv(uploadService, logsCsv, 'logs');

    const logBooklet = capturedLogPersons[0].booklets[0];
    const logUnit = logBooklet.units[0];
    expect(logBooklet.logs[0]).toMatchObject({
      key: 'BOOKLET',
      parameter: 'started',
      ts: '111'
    });
    expect(logUnit.id).toBe('unit-visible-id');
    expect(logUnit.alias).toBe('unit-original-id');
    expect(logUnit.logs[0]).toMatchObject({
      key: 'UNIT',
      parameter: 'shown',
      ts: '222'
    });
  });
});
