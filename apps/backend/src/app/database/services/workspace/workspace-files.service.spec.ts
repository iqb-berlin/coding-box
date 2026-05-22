import { ConsoleLogger, Logger } from '@nestjs/common';
import { WorkspaceFilesService } from './workspace-files.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';

describe('WorkspaceFilesService.handleFile', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
    jest.restoreAllMocks();
  });

  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      {} as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  const makeXmlFile = (mimetype: string): FileIo => ({
    fieldname: 'files',
    originalname: 'unit.xml',
    encoding: '7bit',
    mimetype,
    buffer: Buffer.from('<Unit></Unit>'),
    size: 13
  });

  it('should treat application/xml as xml and call handleXmlFile', async () => {
    const service = makeService();

    const handleXmlSpy = jest
      .spyOn(
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        },
        'handleXmlFile'
      )
      .mockResolvedValue(undefined);

    const file = makeXmlFile('application/xml');

    const tasks = service.handleFile(1, file, true);
    await Promise.all(tasks);

    expect(handleXmlSpy).toHaveBeenCalledTimes(1);
  });

  it('should normalize mimetype and accept application/xml; charset=utf-8', async () => {
    const service = makeService();

    const handleXmlSpy = jest
      .spyOn(
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        },
        'handleXmlFile'
      )
      .mockResolvedValue(undefined);

    const file = makeXmlFile('Application/XML; charset=utf-8');

    const tasks = service.handleFile(1, file, true);
    await Promise.all(tasks);

    expect(handleXmlSpy).toHaveBeenCalledTimes(1);
  });

  it('should treat text/xml as xml and call handleXmlFile', async () => {
    const service = makeService();

    const handleXmlSpy = jest
      .spyOn(
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        },
        'handleXmlFile'
      )
      .mockResolvedValue(undefined);

    const file = makeXmlFile('text/xml');

    const tasks = service.handleFile(1, file, true);
    await Promise.all(tasks);

    expect(handleXmlSpy).toHaveBeenCalledTimes(1);
  });

  it('should reject unsupported xml root tag (no false success)', async () => {
    const service = makeService();

    const badFile: FileIo = {
      ...makeXmlFile('application/xml'),
      buffer: Buffer.from('<Foo></Foo>')
    };

    await expect(
      (
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        }
      ).handleXmlFile(1, badFile, true)
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('WorkspaceFilesService.onModuleInit', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn()
  };

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should refresh the startup unit variable cache for raw workspace_id values', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([{ workspace_id: '1' }]);
    const service = makeService();
    const refreshSpy = jest
      .spyOn(service, 'refreshUnitVariableCache')
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(1);
    expect(refreshSpy).not.toHaveBeenCalledWith(undefined);
  });

  it('should skip invalid startup workspace ids', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([{ workspace_id: null }]);
    const service = makeService();
    const refreshSpy = jest
      .spyOn(service, 'refreshUnitVariableCache')
      .mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    await service.onModuleInit();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Skipping unit variable cache refresh for invalid workspace id: null'
    );
  });
});

describe('WorkspaceFilesService.deleteTestFiles', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockQueryBuilder = {
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 })
  };

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
  };

  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined)
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      mockCodingStatisticsService as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });
  });

  it('should use createQueryBuilder to delete files', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', '2', '3'];
    mockQueryBuilder.execute.mockResolvedValueOnce({ affected: 3 });

    const result = await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockFileUploadRepository.createQueryBuilder).toHaveBeenCalled();
    expect(mockQueryBuilder.delete).toHaveBeenCalled();
    expect(mockQueryBuilder.from).toHaveBeenCalled();
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      'workspace_id = :workspaceId',
      { workspaceId }
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'id IN (:...ids)',
      { ids: [1, 2, 3] }
    );
    expect(mockQueryBuilder.execute).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should filter out invalid IDs', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', 'nan', '3', '1e2', '0x10', '2.5', '03'];
    mockQueryBuilder.execute.mockResolvedValueOnce({ affected: 2 });

    const result = await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'id IN (:...ids)',
      { ids: [1, 3] }
    );
    expect(result).toBe(true);
  });

  it('should invalidate coding statistics cache', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1'];

    await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(workspaceId);
  });

  it('should not execute delete query when no valid IDs are provided', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['nan', '0', '-1'];

    const result = await service.deleteTestFiles(workspaceId, fileIds);

    expect(result).toBe(false);
    expect(mockFileUploadRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(mockCodingStatisticsService.invalidateCache).not.toHaveBeenCalled();
  });

  it('should return false when not all requested files were deleted', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', '2', '3'];
    mockQueryBuilder.execute.mockResolvedValueOnce({ affected: 2 });

    const result = await service.deleteTestFiles(workspaceId, fileIds);

    expect(result).toBe(false);
    expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(workspaceId);
  });
});

describe('WorkspaceFilesService response deletion cache invalidation', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockWorkspaceResponseValidationService = {
    deleteInvalidResponses: jest.fn(),
    deleteAllInvalidResponses: jest.fn()
  };

  const mockWorkspaceTestResultsService = {
    invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined)
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      {} as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      mockWorkspaceResponseValidationService as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      mockWorkspaceTestResultsService as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should invalidate workspace stats after deleting invalid responses', async () => {
    const service = makeService();
    mockWorkspaceResponseValidationService.deleteInvalidResponses.mockResolvedValue(2);

    const deletedCount = await service.deleteInvalidResponses(1, [10, 11]);

    expect(deletedCount).toBe(2);
    expect(mockWorkspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
  });

  it('should not invalidate workspace stats when no invalid responses were deleted', async () => {
    const service = makeService();
    mockWorkspaceResponseValidationService.deleteInvalidResponses.mockResolvedValue(0);

    const deletedCount = await service.deleteInvalidResponses(1, [10]);

    expect(deletedCount).toBe(0);
    expect(mockWorkspaceTestResultsService.invalidateWorkspaceStatsCache).not.toHaveBeenCalled();
  });

  it('should invalidate workspace stats after deleting all invalid responses', async () => {
    const service = makeService();
    mockWorkspaceResponseValidationService.deleteAllInvalidResponses.mockResolvedValue(3);

    const deletedCount = await service.deleteAllInvalidResponses(1, 'variables');

    expect(deletedCount).toBe(3);
    expect(mockWorkspaceTestResultsService.invalidateWorkspaceStatsCache).toHaveBeenCalledWith(1);
  });
});

describe('WorkspaceFilesService.findAllFileTypes', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const baseQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn()
  };

  const resourceQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn()
  };

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn()
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockFileUploadRepository.createQueryBuilder
      .mockReturnValueOnce(baseQueryBuilder)
      .mockReturnValueOnce(resourceQueryBuilder);
  });

  it('should return resource subtypes for known extensions', async () => {
    baseQueryBuilder.getRawMany.mockResolvedValue([
      { file_type: 'Resource' },
      { file_type: 'Unit' }
    ]);
    resourceQueryBuilder.getRawMany.mockResolvedValue([
      { filename: 'test1.vocs' },
      { filename: 'test2.voud' },
      { filename: 'test3.vomd' },
      { filename: 'test4.html' },
      { filename: 'test5.txt' }
    ]);

    const service = makeService();
    const result = await service.findAllFileTypes(1);

    expect(result).toEqual(expect.arrayContaining([
      'Resource',
      'Unit',
      'Resource (.vocs)',
      'Resource (.voud)',
      'Resource (.vomd)',
      'Resource (.html)'
    ]));
  });
});

describe('WorkspaceFilesService.findFiles', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };

  const mockFileTypesQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([])
  };

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn()
  };

  const mockService = () => new WorkspaceFilesService(
    mockFileUploadRepository as unknown as CtorParams[0],
    {} as unknown as CtorParams[1],
    {} as unknown as CtorParams[2],
    {} as unknown as CtorParams[3],
    {} as unknown as CtorParams[4],
    {} as unknown as CtorParams[5],
    {} as unknown as CtorParams[6],
    {} as unknown as CtorParams[7],
    {} as unknown as CtorParams[8],
    {} as unknown as CtorParams[9],
    { delete: jest.fn() } as unknown as CtorParams[10],
    { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockFileUploadRepository.createQueryBuilder
      .mockReturnValueOnce(mockQueryBuilder)
      .mockReturnValueOnce(mockFileTypesQueryBuilder);
  });

  it('should filter resource subtypes by file extension', async () => {
    const service = mockService();
    await service.findFiles(1, { page: 1, limit: 20, fileType: 'Resource (.vocs)' });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'file.file_type = :fileType',
      { fileType: 'Resource' }
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'LOWER(file.filename) LIKE :extension',
      { extension: '%.vocs' }
    );
  });
});

describe('WorkspaceFilesService.downloadWorkspaceFilesAsZip', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    find: jest.fn()
  };
  const mockWorkspaceFileStorageService = {
    createZipBufferFromFiles: jest.fn().mockReturnValue(Buffer.from('zip'))
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      mockWorkspaceFileStorageService as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should filter resource files by selected subtype for zip export', async () => {
    mockFileUploadRepository.find.mockResolvedValue([
      { file_type: 'Resource', filename: 'a.vocs' },
      { file_type: 'Resource', filename: 'b.voud' },
      { file_type: 'Unit', filename: 'unit.xml' }
    ]);

    const service = makeService();
    await service.downloadWorkspaceFilesAsZip(1, ['Resource (.vocs)']);

    expect(mockWorkspaceFileStorageService.createZipBufferFromFiles).toHaveBeenCalled();
    const [filesPassed] = mockWorkspaceFileStorageService.createZipBufferFromFiles.mock.calls[0];
    expect(filesPassed).toEqual([
      { file_type: 'Resource', filename: 'a.vocs' },
      { file_type: 'Unit', filename: 'unit.xml' }
    ]);
  });
});

describe('WorkspaceFilesService.getUnitVariableDetails', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const unitXml = `
    <Unit>
      <Metadata><Id>UnitA</Id></Metadata>
      <BaseVariables>
        <Variable id="B1" alias="base_alias" type="string" />
        <Variable alias="derived_alias" type="integer" />
      </BaseVariables>
      <DerivedVariables>
        <Variable id="DX" alias="xml_derived_alias" type="boolean" />
      </DerivedVariables>
    </Unit>
  `;

  const codingScheme = {
    version: '3.2',
    variableCodings: [
      {
        id: 'B1',
        alias: 'base_alias',
        sourceType: 'BASE',
        type: 'string',
        codes: []
      },
      {
        id: 'D1',
        alias: 'derived_alias',
        sourceType: 'MANUAL',
        type: 'integer',
        codes: [{ id: 1, label: 'Code 1', score: 1 }]
      },
      {
        id: 'S1',
        alias: 'scheme_only_alias',
        sourceType: 'SUM_SCORE',
        type: 'number',
        codes: [{ id: 2, label: 'Code 2', score: 2 }]
      },
      {
        id: 'N1',
        alias: 'excluded_alias',
        sourceType: 'BASE_NO_VALUE',
        type: 'string',
        codes: []
      }
    ]
  };

  const unitFiles = [
    {
      workspace_id: 1,
      file_type: 'Unit',
      file_id: 'UnitA',
      data: Buffer.from(unitXml)
    }
  ];

  const codingSchemes = [
    {
      workspace_id: 1,
      file_type: 'Resource',
      file_id: 'UnitA.VOCS',
      data: JSON.stringify(codingScheme)
    }
  ];

  const mockFileUploadRepository = {
    find: jest.fn()
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      {} as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockFileUploadRepository.find.mockImplementation(({ where }) => {
      if (where.file_type === 'Unit') {
        return Promise.resolve(unitFiles);
      }
      if (where.file_type === 'Resource') {
        return Promise.resolve(codingSchemes);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should mark base XML variables as derived when the VOCS sourceType is derived', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const derivedFromScheme = unit.variables.find(variable => variable.alias === 'derived_alias');
    const baseVariable = unit.variables.find(variable => variable.alias === 'base_alias');

    expect(baseVariable).toMatchObject({
      id: 'B1',
      alias: 'base_alias',
      isDerived: false
    });
    expect(derivedFromScheme).toMatchObject({
      id: 'D1',
      alias: 'derived_alias',
      type: 'integer',
      isDerived: true
    });
  });

  it('should include XML-derived and scheme-only derived variables', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const xmlDerived = unit.variables.find(variable => variable.alias === 'xml_derived_alias');
    const schemeOnlyDerived = unit.variables.find(variable => variable.alias === 'scheme_only_alias');
    const excludedVariable = unit.variables.find(variable => variable.alias === 'excluded_alias');

    expect(xmlDerived).toMatchObject({
      id: 'DX',
      alias: 'xml_derived_alias',
      isDerived: true
    });
    expect(schemeOnlyDerived).toMatchObject({
      id: 'S1',
      alias: 'scheme_only_alias',
      type: 'number',
      isDerived: true
    });
    expect(excludedVariable).toBeUndefined();
  });
});
