import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  SelectQueryBuilder,
  FindManyOptions,
  DeleteResult
} from 'typeorm';
import { WorkspaceResponseValidationService } from '../app/database/services/validation/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from '../app/database/services/validation/workspace-test-files-validation.service';
import { CodingValidationService } from '../app/database/services/coding/coding-validation.service';
import { WorkspaceFilesService } from '../app/database/services/workspace/workspace-files.service';
import { WorkspaceCoreService } from '../app/database/services/workspace/workspace-core.service';
import { WorkspaceXmlSchemaValidationService } from '../app/database/services/workspace/workspace-xml-schema-validation.service';
import { CacheService } from '../app/cache/cache.service';
import FileUpload from '../app/database/entities/file_upload.entity';
import Persons from '../app/database/entities/persons.entity';
import { Booklet } from '../app/database/entities/booklet.entity';
import { Unit } from '../app/database/entities/unit.entity';
import { ResponseEntity } from '../app/database/entities/response.entity';
import { CodingJobUnit } from '../app/database/entities/coding-job-unit.entity';

describe('Validation Workflow Integration', () => {
  let moduleRef: TestingModule;

  // Services
  let responseValidationService: WorkspaceResponseValidationService;
  let filesValidationService: WorkspaceTestFilesValidationService;
  let codingValidationService: CodingValidationService;

  // Repository mocks
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let unitRepository: jest.Mocked<Repository<Unit>>;
  let personsRepository: jest.Mocked<Repository<Persons>>;
  let bookletRepository: jest.Mocked<Repository<Booklet>>;
  let fileUploadRepository: jest.Mocked<Repository<FileUpload>>;
  let codingJobUnitRepository: jest.Mocked<Repository<CodingJobUnit>>;

  // Service mocks
  let workspaceFilesService: jest.Mocked<WorkspaceFilesService>;
  let workspaceCoreService: jest.Mocked<WorkspaceCoreService>;
  let xmlSchemaValidationService: jest.Mocked<WorkspaceXmlSchemaValidationService>;
  let cacheService: jest.Mocked<CacheService>;

  const WORKSPACE_ID = 1;

  // Helper to check if a query is for TestTakers (handles both string and In() operator)
  const isTestTakersQuery = (where: unknown): boolean => {
    if (!where || typeof where !== 'object') return false;
    const w = where as { file_type?: string | object | string[] };
    if (w.file_type === 'TestTakers') return true;
    if (w.file_type === 'Testtakers') return true;
    // Handle In() operator - array with TestTakers/Testtakers
    if (Array.isArray(w.file_type)) {
      return w.file_type.some(
        (ft: string) => ft?.toLowerCase() === 'testtakers'
      );
    }
    // Handle TypeORM In() object structure
    if (typeof w.file_type === 'object' && w.file_type !== null) {
      // eslint-disable-next-line no-underscore-dangle
      const ftObj = w.file_type as { _type?: string; _value?: unknown };
      // eslint-disable-next-line no-underscore-dangle
      if (ftObj._type === 'in' && Array.isArray(ftObj._value)) {
        // eslint-disable-next-line no-underscore-dangle
        return ftObj._value.some(
          (v: string) => typeof v === 'string' && v.toLowerCase() === 'testtakers'
        );
      }
    }
    return false;
  };

  // Helper: Create mock query builder
  const createMockQueryBuilder = <T>(returnValue?: T) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(1),
    getMany: jest.fn().mockResolvedValue(returnValue || []),
    getRawMany: jest.fn().mockResolvedValue(returnValue || [])
  }) as unknown as jest.Mocked<SelectQueryBuilder<T>>;

  // Helper: Create unit XML with variables
  const createUnitXml = (
    unitId: string,
    variables: Array<{
      id?: string;
      alias?: string;
      type?: string;
      multiple?: boolean;
    }> = []
  ): string => {
    const varsXml = variables
      .map(v => {
        const attrs = [
          v.id ? `id="${v.id}"` : '',
          v.alias ? `alias="${v.alias}"` : '',
          v.type ? `type="${v.type}"` : '',
          v.multiple !== undefined ? `multiple="${v.multiple}"` : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `<Variable ${attrs} />`;
      })
      .join('');

    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Unit>' +
      `<Metadata><Id>${unitId}</Id></Metadata>` +
      `<BaseVariables>${varsXml}</BaseVariables>` +
      '<DefinitionRef player="PLAYER-1.0">definition.html</DefinitionRef>' +
      '</Unit>'
    );
  };

  // Helper: Create test taker XML
  const createTestTakerXml = (
    groupId: string,
    logins: Array<{ name: string; mode: string; booklet: string }>
  ): string => {
    const loginsXml = logins
      .map(
        l => `<Login mode="${l.mode}" name="${l.name}"><Booklet>${l.booklet}</Booklet></Login>`
      )
      .join('');
    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      `<TestTakers><Group id="${groupId}">${loginsXml}</Group></TestTakers>`
    );
  };

  // Helper: Create booklet XML
  const createBookletXml = (unitIds: string[]): string => {
    const unitsXml = unitIds.map(id => `<Unit id="${id}" />`).join('');
    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      `<Booklet><Units>${unitsXml}</Units></Booklet>`
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup service mocks
    workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(
        new Map([
          ['UNIT1', new Set(['var1', 'var2'])],
          ['UNIT2', new Set(['var3', 'var4'])]
        ])
      ),
      getTestFile: jest.fn().mockResolvedValue({
        file_id: 'UNIT1',
        data: createUnitXml('UNIT1', [
          { id: 'V1', alias: 'var1', type: 'string' },
          { id: 'V2', alias: 'var2', type: 'integer' }
        ]),
        filename: 'UNIT1.xml'
      })
    } as unknown as jest.Mocked<WorkspaceFilesService>;

    workspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<WorkspaceCoreService>;

    xmlSchemaValidationService = {
      validateAllXmlSchemas: jest.fn().mockResolvedValue(new Map())
    } as unknown as jest.Mocked<WorkspaceXmlSchemaValidationService>;

    cacheService = {
      generateValidationCacheKey: jest.fn().mockReturnValue('test-cache-key'),
      getPaginatedValidationResults: jest.fn().mockResolvedValue(null),
      storeValidationResults: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<CacheService>;

    // Setup repository mocks
    const createMockRepository = <T>() => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => createMockQueryBuilder<T>()),
      save: jest
        .fn()
        .mockImplementation(entities => Promise.resolve(entities)),
      update: jest
        .fn()
        .mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest.fn().mockResolvedValue([{ count: '5' }]),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue({
            connect: jest.fn().mockResolvedValue(undefined),
            startTransaction: jest.fn().mockResolvedValue(undefined),
            commitTransaction: jest.fn().mockResolvedValue(undefined),
            rollbackTransaction: jest.fn().mockResolvedValue(undefined),
            release: jest.fn().mockResolvedValue(undefined),
            manager: {
              getRepository: jest.fn().mockReturnValue({
                createQueryBuilder: jest
                  .fn()
                  .mockReturnValue(createMockQueryBuilder())
              })
            }
          })
        }
      }
    }) as unknown as jest.Mocked<Repository<T>>;

    responseRepository = createMockRepository<ResponseEntity>();
    unitRepository = createMockRepository<Unit>();
    personsRepository = createMockRepository<Persons>();
    bookletRepository = createMockRepository<Booklet>();
    fileUploadRepository = createMockRepository<FileUpload>();
    codingJobUnitRepository = createMockRepository<CodingJobUnit>();

    moduleRef = await Test.createTestingModule({
      providers: [
        WorkspaceResponseValidationService,
        WorkspaceTestFilesValidationService,
        CodingValidationService,
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn().mockResolvedValue(undefined),
              startTransaction: jest.fn().mockResolvedValue(undefined),
              commitTransaction: jest.fn().mockResolvedValue(undefined),
              rollbackTransaction: jest.fn().mockResolvedValue(undefined),
              release: jest.fn().mockResolvedValue(undefined),
              manager: {
                getRepository: jest.fn().mockReturnValue({
                  createQueryBuilder: jest
                    .fn()
                    .mockReturnValue(createMockQueryBuilder())
                })
              }
            })
          }
        },
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: responseRepository
        },
        {
          provide: getRepositoryToken(Unit),
          useValue: unitRepository
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: personsRepository
        },
        {
          provide: getRepositoryToken(Booklet),
          useValue: bookletRepository
        },
        {
          provide: getRepositoryToken(FileUpload),
          useValue: fileUploadRepository
        },
        {
          provide: getRepositoryToken(CodingJobUnit),
          useValue: codingJobUnitRepository
        },
        {
          provide: WorkspaceFilesService,
          useValue: workspaceFilesService
        },
        {
          provide: WorkspaceCoreService,
          useValue: workspaceCoreService
        },
        {
          provide: WorkspaceXmlSchemaValidationService,
          useValue: xmlSchemaValidationService
        },
        {
          provide: CacheService,
          useValue: cacheService
        }
      ]
    }).compile();

    responseValidationService =
      moduleRef.get<WorkspaceResponseValidationService>(
        WorkspaceResponseValidationService
      );
    filesValidationService = moduleRef.get<WorkspaceTestFilesValidationService>(
      WorkspaceTestFilesValidationService
    );
    codingValidationService = moduleRef.get<CodingValidationService>(
      CodingValidationService
    );
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('Response Validation Workflow', () => {
    it('should validate variable existence against unit definitions', async () => {
      // Setup test data
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);
      const bookletContent = createBookletXml(['UNIT1']);
      const unitContent = createUnitXml('UNIT1', [
        { id: 'V1', alias: 'valid_var', type: 'string' }
      ]);

      // Mock file uploads
      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          if (args.skip && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string };
          if (where.file_type === 'TestTakers') {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          if (where.file_type === 'Booklet') {
            return Promise.resolve([
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: bookletContent,
                file_type: 'Booklet'
              }
            ]);
          }
          if (where.file_type === 'Unit') {
            return Promise.resolve([
              {
                id: 3,
                file_id: 'UNIT1',
                data: unitContent,
                file_type: 'Unit'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      // Mock persons and units
      personsRepository.find.mockResolvedValue([
        {
          id: 1,
          workspace_id: WORKSPACE_ID,
          consider: true,
          login: 'user1'
        }
      ] as unknown as Persons[]);

      unitRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([
          { id: 10, name: 'UNIT1', alias: 'UNIT1' }
        ]) as unknown as SelectQueryBuilder<Unit>
      );

      // Mock response with invalid variable
      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'invalid_variable',
          value: 'test',
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const result = await responseValidationService.validateVariables(
        WORKSPACE_ID,
        1,
        10
      );

      expect(result.total).toBe(1);
      expect(result.data[0].errorReason).toBe('Variable not defined in unit');
    });

    it('should accept valid variable references', async () => {
      const unitContent = createUnitXml('UNIT1', [
        { id: 'V1', alias: 'valid_var', type: 'string' }
      ]);

      fileUploadRepository.find.mockResolvedValue([
        {
          id: 1,
          file_id: 'UNIT1',
          data: unitContent,
          file_type: 'Unit'
        }
      ] as unknown as FileUpload[]);

      personsRepository.find.mockResolvedValue([
        { id: 1, workspace_id: WORKSPACE_ID, consider: true }
      ] as unknown as Persons[]);

      unitRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([
          { id: 10, name: 'UNIT1' }
        ]) as unknown as SelectQueryBuilder<Unit>
      );

      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'valid_var',
          value: 'test',
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const result = await responseValidationService.validateVariables(
        WORKSPACE_ID,
        1,
        10
      );

      expect(result.total).toBe(0);
    });

    it('should validate variable types', async () => {
      const unitContent = createUnitXml('UNIT1', [
        { id: 'V1', alias: 'int_var', type: 'integer' }
      ]);

      fileUploadRepository.find.mockResolvedValue([
        {
          id: 1,
          file_id: 'UNIT1',
          data: unitContent,
          file_type: 'Unit'
        }
      ] as unknown as FileUpload[]);

      personsRepository.find.mockResolvedValue([
        { id: 1, workspace_id: WORKSPACE_ID, consider: true }
      ] as unknown as Persons[]);

      unitRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([
          { id: 10, name: 'UNIT1' }
        ]) as unknown as SelectQueryBuilder<Unit>
      );

      // Invalid integer value
      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'int_var',
          value: 'not-a-number',
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const result = await responseValidationService.validateVariableTypes(
        WORKSPACE_ID,
        1,
        10
      );

      expect(result.total).toBe(1);
      expect(result.data[0].errorReason).toContain('integer');
    });

    it('should detect duplicate responses', async () => {
      personsRepository.find.mockResolvedValue([
        {
          id: 1,
          workspace_id: WORKSPACE_ID,
          consider: true,
          login: 'user1'
        }
      ] as unknown as Persons[]);

      bookletRepository.find.mockResolvedValue([
        { id: 20, personid: 1, bookletinfo: { name: 'BOOKLET1' } }
      ] as unknown as Booklet[]);

      unitRepository.find.mockResolvedValue([
        { id: 10, name: 'UNIT1', bookletid: 20 }
      ] as unknown as Unit[]);

      // Duplicate responses for same unit/variable
      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'VAR1',
          value: 'x',
          status: 1
        },
        {
          id: 101,
          unitid: 10,
          variableid: 'VAR1',
          value: 'y',
          status: 2
        }
      ] as unknown as ResponseEntity[]);

      const result = await responseValidationService.validateDuplicateResponses(
        WORKSPACE_ID,
        1,
        10
      );

      expect(result.total).toBe(1);
      expect(result.data[0].duplicates.length).toBe(2);
    });

    it('should validate response status codes', async () => {
      personsRepository.find.mockResolvedValue([
        {
          id: 1,
          workspace_id: WORKSPACE_ID,
          consider: true,
          login: 'user1'
        }
      ] as unknown as Persons[]);

      const mockQueryBuilder = createMockQueryBuilder([
        { id: 10, name: 'UNIT1' }
      ]);
      unitRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Unit>
      );

      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'VAR1',
          value: 'x',
          status: 999, // Invalid status
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const result = await responseValidationService.validateResponseStatus(
        WORKSPACE_ID,
        1,
        10
      );

      expect(result.total).toBe(1);
      expect(result.data[0].errorReason).toContain('Invalid response status');
    });

    it('should delete invalid responses', async () => {
      // Setup mocks required by deleteInvalidResponses
      personsRepository.find.mockResolvedValue([
        {
          id: 1,
          workspace_id: WORKSPACE_ID,
          consider: true,
          login: 'user1'
        }
      ] as unknown as Persons[]);

      const mockQueryBuilder = createMockQueryBuilder([
        { id: 10, name: 'UNIT1' }
      ]);
      unitRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<Unit>
      );

      responseRepository.delete.mockResolvedValue({
        affected: 3
      } as DeleteResult);

      const result = await responseValidationService.deleteInvalidResponses(
        WORKSPACE_ID,
        [100, 101, 102]
      );

      expect(result).toBe(3);
      expect(responseRepository.delete).toHaveBeenCalledWith({
        id: expect.any(Object),
        unitid: expect.any(Object)
      });
    });
  });

  describe('File Validation Workflow', () => {
    it('should detect missing booklets referenced by test takers', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'MISSING_BOOKLET' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') return Promise.resolve([]);
          if (isTestTakersQuery(where)) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(result.validationResults[0].booklets.complete).toBe(false);
      expect(result.validationResults[0].booklets.missing).toContain(
        'MISSING_BOOKLET'
      );
    });

    it('should detect missing units referenced by booklets', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);
      const bookletContent = createBookletXml(['MISSING_UNIT']);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') {
            return Promise.resolve([
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: bookletContent,
                file_type: 'Booklet'
              }
            ]);
          }
          if (isTestTakersQuery(where)) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          if (where.file_type === 'Unit') return Promise.resolve([]);
          return Promise.resolve([]);
        }
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(result.validationResults[0].units.missing).toContain(
        'MISSING_UNIT'
      );
    });

    it('should detect units without player references', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);
      const bookletContent = createBookletXml(['UNIT1']);
      // Unit without DefinitionRef
      const unitContent =
        '<?xml version="1.0"?>' +
        '<Unit><Metadata><Id>UNIT1</Id></Metadata></Unit>';

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string };
          const files: Record<string, unknown> = {
            Booklet: [
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: bookletContent,
                file_type: 'Booklet'
              }
            ],
            Unit: [
              {
                id: 3,
                file_id: 'UNIT1',
                data: unitContent,
                file_type: 'Unit'
              }
            ],
            TestTakers: [
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]
          };
          if (isTestTakersQuery(where)) {
            return Promise.resolve(files.TestTakers as FileUpload[]);
          }
          return Promise.resolve(
            (files[where.file_type as string] || []) as FileUpload[]
          );
        }
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(result.validationResults[0].units.unitsWithoutPlayer).toContain(
        'UNIT1'
      );
    });

    it('should detect missing coding scheme references', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);
      const bookletContent = createBookletXml(['UNIT1']);
      const unitContent =
        '<?xml version="1.0"?>' +
        '<Unit>' +
        '<Metadata><Id>UNIT1</Id></Metadata>' +
        '<CodingSchemeRef>missing-scheme.vocs</CodingSchemeRef>' +
        '<DefinitionRef player="PLAYER-1.0">def.html</DefinitionRef>' +
        '</Unit>';

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string };
          const files: Record<string, unknown> = {
            Booklet: [
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: bookletContent,
                file_type: 'Booklet'
              }
            ],
            Unit: [
              {
                id: 3,
                file_id: 'UNIT1',
                data: unitContent,
                file_type: 'Unit'
              }
            ],
            TestTakers: [
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]
          };
          if (isTestTakersQuery(where)) {
            return Promise.resolve(files.TestTakers as FileUpload[]);
          }
          return Promise.resolve(
            (files[where.file_type as string] || []) as FileUpload[]
          );
        }
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(result.validationResults[0].schemes.missing).toContain(
        'MISSING-SCHEME.VOCS'
      );
    });

    it('should detect duplicate test taker logins', async () => {
      const testTakerContent1 = createTestTakerXml('G1', [
        { name: 'duplicate_user', mode: 'monitor-group', booklet: 'BOOKLET1' }
      ]);
      const testTakerContent2 = createTestTakerXml('G2', [
        { name: 'duplicate_user', mode: 'monitor-group', booklet: 'BOOKLET1' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          if (args.skip && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') return Promise.resolve([]);
          if (
            where.file_type === 'TestTakers' ||
            typeof where.file_type === 'object'
          ) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent1,
                file_type: 'TestTakers'
              },
              {
                id: 2,
                file_id: 'TESTTAKER2',
                data: testTakerContent2,
                file_type: 'TestTakers'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      // Mock personsRepository to return the duplicate user with consider=true
      personsRepository.find.mockResolvedValue([
        { login: 'duplicate_user', consider: true }
      ] as unknown as Persons[]);

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(
        result.duplicateTestTakers?.some(d => d.login === 'duplicate_user')
      ).toBe(true);
    });

    it('should report unused test files', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          if (args.skip && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') {
            return Promise.resolve([
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: createBookletXml([]),
                file_type: 'Booklet'
              }
            ]);
          }
          if (isTestTakersQuery(where)) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          if (!where.file_type) {
            // Return all files including unused
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              },
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: createBookletXml([]),
                file_type: 'Booklet'
              },
              {
                id: 3,
                file_id: 'UNUSED_FILE',
                filename: 'unused.xml',
                file_type: 'Resource'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(
        result.unusedTestFiles?.some(f => f.fileId === 'UNUSED_FILE')
      ).toBe(true);
    });

    it('should include XML schema validation results', async () => {
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          if (args.skip && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') return Promise.resolve([]);
          if (isTestTakersQuery(where)) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      xmlSchemaValidationService.validateAllXmlSchemas.mockResolvedValue(
        new Map([
          [
            'TestTakers:TESTTAKER1',
            { schemaValid: false, errors: ['Invalid XML structure'] }
          ]
        ])
      );

      const result =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);

      expect(result.validationResults[0].testTakerSchemaValid).toBe(false);
      expect(result.validationResults[0].testTakerSchemaErrors).toContain(
        'Invalid XML structure'
      );
    });
  });

  describe('Completeness Checking Workflow', () => {
    it('should validate coding completeness with expected combinations', async () => {
      const expectedCombinations = [
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'var1'
        },
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'var2'
        }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getCount.mockResolvedValue(1);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      cacheService.getPaginatedValidationResults.mockResolvedValue(null);
      cacheService.storeValidationResults.mockResolvedValue(true);

      const result = await codingValidationService.validateCodingCompleteness(
        WORKSPACE_ID,
        expectedCombinations,
        1,
        50
      );

      expect(result.results).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should identify missing responses', async () => {
      const expectedCombinations = [
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'missing_var'
        }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getCount.mockResolvedValue(0); // Response not found
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      cacheService.getPaginatedValidationResults.mockResolvedValue(null);
      cacheService.storeValidationResults.mockResolvedValue(true);

      const result = await codingValidationService.validateCodingCompleteness(
        WORKSPACE_ID,
        expectedCombinations,
        1,
        50
      );

      expect(result.results[0].status).toBe('MISSING');
      expect(result.missing).toBe(1);
    });

    it('should get incomplete coding variables', async () => {
      const rawResults = [
        { unitName: 'UNIT1', variableId: 'var1', responseCount: '5' },
        { unitName: 'UNIT2', variableId: 'var2', responseCount: '3' }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.get.mockResolvedValue(null);
      workspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([
          ['UNIT1', new Set(['var1'])],
          ['UNIT2', new Set(['var2'])]
        ])
      );
      cacheService.set.mockResolvedValue(true);

      const result =
        await codingValidationService.getCodingIncompleteVariables(
          WORKSPACE_ID
        );

      expect(result).toHaveLength(2);
      expect(result[0].unitName).toBe('UNIT1');
      expect(result[0].variableId).toBe('var1');
    });

    it('should filter incomplete variables by unit name', async () => {
      const rawResults = [
        { unitName: 'SPECIFIC_UNIT', variableId: 'var1', responseCount: '5' }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getRawMany.mockResolvedValue(rawResults);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      workspaceFilesService.getUnitVariableMap.mockResolvedValue(
        new Map([['SPECIFIC_UNIT', new Set(['var1'])]])
      );
      cacheService.get.mockResolvedValue(null);
      cacheService.set.mockResolvedValue(true);

      const result = await codingValidationService.getCodingIncompleteVariables(
        WORKSPACE_ID,
        'SPECIFIC_UNIT'
      );

      expect(result).toHaveLength(1);
      expect(result[0].unitName).toBe('SPECIFIC_UNIT');
    });

    it('should get applied results count', async () => {
      const incompleteVariables = [
        { unitName: 'UNIT1', variableId: 'var1' },
        { unitName: 'UNIT2', variableId: 'var2' }
      ];

      responseRepository.query.mockResolvedValue([{ applied_count: '10' }]);

      const result = await codingValidationService.getAppliedResultsCount(
        WORKSPACE_ID,
        incompleteVariables
      );

      expect(typeof result).toBe('number');
      expect(result).toBe(10);
    });

    it('should invalidate completeness cache', async () => {
      await codingValidationService.invalidateIncompleteVariablesCache(
        WORKSPACE_ID
      );

      expect(cacheService.delete).toHaveBeenCalledWith(
        `coding_incomplete_variables_v2:${WORKSPACE_ID}`
      );
    });

    it('should use cached results when available', async () => {
      const expectedCombinations = [
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'var1'
        }
      ];

      const cachedResults = {
        results: [
          { combination: expectedCombinations[0], status: 'EXISTS' as const }
        ],
        metadata: {
          total: 1,
          missing: 0,
          timestamp: Date.now(),
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      };

      cacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      cacheService.getPaginatedValidationResults.mockResolvedValue(
        cachedResults
      );

      const result = await codingValidationService.validateCodingCompleteness(
        WORKSPACE_ID,
        expectedCombinations,
        1,
        50
      );

      expect(result.results[0].status).toBe('EXISTS');
      expect(result.total).toBe(1);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete validation workflow: files -> responses -> completeness', async () => {
      // Step 1: File validation - all files present
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'BOOKLET1' }
      ]);
      const bookletContent = createBookletXml(['UNIT1']);
      const unitContent = createUnitXml('UNIT1', [
        { id: 'V1', alias: 'var1', type: 'string' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string };
          const files: Record<string, unknown> = {
            Booklet: [
              {
                id: 2,
                file_id: 'BOOKLET1',
                data: bookletContent,
                file_type: 'Booklet'
              }
            ],
            Unit: [
              {
                id: 3,
                file_id: 'UNIT1',
                data: unitContent,
                file_type: 'Unit'
              }
            ],
            TestTakers: [
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]
          };
          if (isTestTakersQuery(where)) {
            return Promise.resolve(files.TestTakers as FileUpload[]);
          }
          return Promise.resolve(
            (files[where.file_type as string] || []) as FileUpload[]
          );
        }
      );

      const fileResult =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);
      expect(fileResult.validationResults[0].booklets.complete).toBe(true);
      expect(fileResult.validationResults[0].units.complete).toBe(true);

      // Step 2: Response validation - valid variables
      personsRepository.find.mockResolvedValue([
        {
          id: 1,
          workspace_id: WORKSPACE_ID,
          consider: true,
          login: 'user1'
        }
      ] as unknown as Persons[]);

      unitRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([
          { id: 10, name: 'UNIT1' }
        ]) as unknown as SelectQueryBuilder<Unit>
      );

      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'var1',
          value: 'test_value',
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const responseResult = await responseValidationService.validateVariables(
        WORKSPACE_ID,
        1,
        10
      );
      expect(responseResult.total).toBe(0); // No invalid responses

      // Step 3: Completeness checking
      const expectedCombinations = [
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'var1'
        }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getCount.mockResolvedValue(1);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      cacheService.getPaginatedValidationResults.mockResolvedValue(null);
      cacheService.storeValidationResults.mockResolvedValue(true);

      const completenessResult =
        await codingValidationService.validateCodingCompleteness(
          WORKSPACE_ID,
          expectedCombinations,
          1,
          50
        );
      expect(completenessResult.results[0].status).toBe('EXISTS');
    });

    it('should handle validation failures cascading through workflow', async () => {
      // File validation detects missing booklet
      const testTakerContent = createTestTakerXml('G1', [
        { name: 'user1', mode: 'run-hot-return', booklet: 'MISSING_BOOKLET' }
      ]);

      fileUploadRepository.find.mockImplementation(
        (args: FindManyOptions<FileUpload>) => {
          // Handle pagination: return empty for skip > 0, return data for skip=0 or undefined
          if (args.skip !== undefined && args.skip > 0) return Promise.resolve([]);
          const where = args.where as { file_type?: string | object };
          if (where.file_type === 'Booklet') return Promise.resolve([]);
          if (isTestTakersQuery(where)) {
            return Promise.resolve([
              {
                id: 1,
                file_id: 'TESTTAKER1',
                data: testTakerContent,
                file_type: 'TestTakers'
              }
            ]);
          }
          return Promise.resolve([]);
        }
      );

      const fileResult =
        await filesValidationService.validateTestFiles(WORKSPACE_ID);
      expect(fileResult.validationResults[0].booklets.complete).toBe(false);

      // Response validation with invalid data
      personsRepository.find.mockResolvedValue([
        { id: 1, workspace_id: WORKSPACE_ID, consider: true }
      ] as unknown as Persons[]);

      unitRepository.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder([
          { id: 10, name: 'UNIT1' }
        ]) as unknown as SelectQueryBuilder<Unit>
      );

      fileUploadRepository.find.mockResolvedValue([
        {
          id: 1,
          file_id: 'UNIT1',
          data: createUnitXml('UNIT1', [
            { id: 'V1', alias: 'valid_var', type: 'string' }
          ]),
          file_type: 'Unit'
        }
      ] as unknown as FileUpload[]);

      responseRepository.find.mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'invalid_var',
          value: 'test',
          unit: { id: 10, name: 'UNIT1' }
        }
      ] as unknown as ResponseEntity[]);

      const responseResult = await responseValidationService.validateVariables(
        WORKSPACE_ID,
        1,
        10
      );
      expect(responseResult.total).toBe(1);

      // Completeness shows missing
      const expectedCombinations = [
        {
          unit_key: 'UNIT1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'BOOKLET1',
          variable_id: 'var1'
        }
      ];

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getCount.mockResolvedValue(0);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.getPaginatedValidationResults.mockResolvedValue(null);
      cacheService.storeValidationResults.mockResolvedValue(true);

      const completenessResult =
        await codingValidationService.validateCodingCompleteness(
          WORKSPACE_ID,
          expectedCombinations,
          1,
          50
        );
      expect(completenessResult.results[0].status).toBe('MISSING');
    });

    it('should handle pagination in completeness validation', async () => {
      const expectedCombinations = Array.from({ length: 100 }, (_, i) => ({
        unit_key: `UNIT${i}`,
        login_name: 'user1',
        login_code: 'code1',
        booklet_id: 'BOOKLET1',
        variable_id: `var${i}`
      }));

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.getCount.mockResolvedValue(1);
      responseRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as unknown as SelectQueryBuilder<ResponseEntity>
      );

      cacheService.generateValidationCacheKey.mockReturnValue('cache-key');
      cacheService.getPaginatedValidationResults.mockResolvedValue(null);
      cacheService.storeValidationResults.mockResolvedValue(true);

      // First page
      const firstPage =
        await codingValidationService.validateCodingCompleteness(
          WORKSPACE_ID,
          expectedCombinations,
          1,
          25
        );
      expect(firstPage.currentPage).toBe(1);
      expect(firstPage.pageSize).toBe(25);
      expect(firstPage.hasNextPage).toBe(true);

      // Last page
      cacheService.storeValidationResults.mockClear();
      const lastPage = await codingValidationService.validateCodingCompleteness(
        WORKSPACE_ID,
        expectedCombinations,
        4,
        25
      );
      expect(lastPage.currentPage).toBe(4);
      expect(lastPage.hasNextPage).toBe(false);
      expect(lastPage.hasPreviousPage).toBe(true);
    });
  });
});
