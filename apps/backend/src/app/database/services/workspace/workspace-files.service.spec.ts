import { ConsoleLogger, Logger } from '@nestjs/common';
import { WorkspaceFilesService } from './workspace-files.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';

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

  function makeService(overrides: Partial<{
    workspaceXmlSchemaValidationService: CtorParams[5];
  }> = {}): WorkspaceFilesService {
    return new WorkspaceFilesService(
      {} as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      {} as unknown as CtorParams[4],
      (overrides.workspaceXmlSchemaValidationService || {}) as CtorParams[5],
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

  it('should treat octet-stream Unit XML as xml and call handleXmlFile', async () => {
    const service = makeService();

    const handleXmlSpy = jest
      .spyOn(
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        },
        'handleXmlFile'
      )
      .mockResolvedValue(undefined);

    const file = makeXmlFile('application/octet-stream');

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

  it('should return XSD validation details for failed XML uploads', async () => {
    const service = makeService({
      workspaceXmlSchemaValidationService: {
        validateXmlViaXsdUrl: jest.fn().mockResolvedValue({
          schemaValid: false,
          errors: [
            "line 299: Element 'Variable': Duplicate key-sequence ['08'] in key identity-constraint 'basicKey'."
          ]
        })
      } as unknown as CtorParams[5]
    });

    const result = await (
      service as unknown as {
        handleXmlFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleXmlFile(1, makeXmlFile('application/xml'), true);

    expect(result).toEqual({
      failed: true,
      filename: 'unit.xml',
      reason: 'XSD validation failed: unit.xml',
      details: [
        "line 299: Element 'Variable': Duplicate key-sequence ['08'] in key identity-constraint 'basicKey'."
      ]
    });
  });
});

describe('WorkspaceFilesService coding scheme freshness', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const createCodingScheme = (
    options: {
      processing?: string[];
      codeModel?: string;
      manualInstruction?: string;
    } = {}
  ): string => JSON.stringify({
    version: '3.4',
    variableCodings: [
      {
        id: 'VAR_A',
        alias: 'var_a',
        sourceType: 'BASE',
        processing: options.processing || [],
        codeModel: options.codeModel || 'MANUAL_AND_RULES',
        codes: [
          {
            id: 1,
            score: 1,
            manualInstruction: options.manualInstruction || '<p>old</p>',
            ruleSets: [
              {
                rules: [
                  {
                    method: 'MATCH',
                    parameters: ['A']
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  });

  const createVocsFile = (data: string): FileIo => ({
    fieldname: 'files',
    originalname: 'UNIT_A.vocs',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    buffer: Buffer.from(data),
    size: Buffer.byteLength(data)
  });

  const mockFileUploadRepository = {
    create: jest.fn((value: unknown) => value),
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    upsert: jest.fn().mockResolvedValue(undefined)
  };
  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined),
    invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
  };
  const mockCodingFreshnessService = {
    markUnitsStaleAfterCodingSchemeChange: jest.fn().mockResolvedValue(undefined)
  };
  const mockCodingReadinessCacheInvalidator = {
    invalidateWorkspaceReadinessCache: jest.fn()
  };
  const mockWorkspaceFileParsingService = {
    extractUnitInfo: jest.fn().mockResolvedValue({
      codingSchemeRef: 'UNIT_A.VOCS',
      codingSchemeRefNormalized: 'UNIT_A',
      codingSchemeRefs: ['UNIT_A']
    })
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
      mockWorkspaceFileParsingService as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9],
      { delete: jest.fn() } as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11],
      undefined,
      mockCodingFreshnessService as unknown as CtorParams[13],
      undefined,
      undefined,
      mockCodingReadinessCacheInvalidator as unknown as CtorParams[16]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceFileParsingService.extractUnitInfo.mockResolvedValue({
      codingSchemeRef: 'UNIT_A.VOCS',
      codingSchemeRefNormalized: 'UNIT_A',
      codingSchemeRefs: ['UNIT_A']
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks auto-coding and manual coding stale after coding scheme rule changes', async () => {
    const service = makeService();
    const oldData = createCodingScheme({ processing: [] });
    const newData = createCodingScheme({ processing: ['IGNORE_CASE'] });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });

    await (
      service as unknown as {
        handleOctetStreamFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, createVocsFile(newData), true);

    expect(mockCodingFreshnessService.markUnitsStaleAfterCodingSchemeChange)
      .toHaveBeenCalledWith(1, {
        autoCodingSchemeRefs: ['UNIT_A'],
        manualCodingSchemeRefs: ['UNIT_A']
      });
  });

  it('marks auto-coding and manual coding stale after coding scheme code model changes', async () => {
    const service = makeService();
    const oldData = createCodingScheme({ codeModel: 'MANUAL_ONLY' });
    const newData = createCodingScheme({ codeModel: 'MANUAL_AND_RULES' });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });

    await (
      service as unknown as {
        handleOctetStreamFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, createVocsFile(newData), true);

    expect(mockCodingFreshnessService.markUnitsStaleAfterCodingSchemeChange)
      .toHaveBeenCalledWith(1, {
        autoCodingSchemeRefs: ['UNIT_A'],
        manualCodingSchemeRefs: ['UNIT_A']
      });
  });

  it('marks only manual coding stale after instruction-only coding scheme changes', async () => {
    const service = makeService();
    const oldData = createCodingScheme({ manualInstruction: '<p>old</p>' });
    const newData = createCodingScheme({ manualInstruction: '<p>new</p>' });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });

    await (
      service as unknown as {
        handleOctetStreamFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, createVocsFile(newData), true);

    expect(mockCodingFreshnessService.markUnitsStaleAfterCodingSchemeChange)
      .toHaveBeenCalledWith(1, {
        autoCodingSchemeRefs: [],
        manualCodingSchemeRefs: ['UNIT_A']
      });
  });

  it('does not mark coding freshness when coding scheme JSON is semantically unchanged', async () => {
    const service = makeService();
    const oldData = JSON.stringify({
      version: '3.4',
      variableCodings: [
        {
          id: 'VAR_A',
          alias: 'var_a',
          sourceType: 'BASE',
          codes: [{ id: 1, manualInstruction: '<p>old</p>' }]
        }
      ]
    });
    const newData = JSON.stringify({
      variableCodings: [
        {
          sourceType: 'BASE',
          alias: 'var_a',
          codes: [{ manualInstruction: '<p>old</p>', id: 1 }],
          id: 'VAR_A'
        }
      ],
      version: '3.4'
    });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });

    await (
      service as unknown as {
        handleOctetStreamFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, createVocsFile(newData), true);

    expect(mockCodingFreshnessService.markUnitsStaleAfterCodingSchemeChange)
      .not.toHaveBeenCalled();
  });

  it('keeps upload successful and returns a freshness warning when stale marking fails', async () => {
    const service = makeService();
    const oldData = createCodingScheme({ processing: [] });
    const newData = createCodingScheme({ processing: ['IGNORE_CASE'] });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });
    mockCodingFreshnessService.markUnitsStaleAfterCodingSchemeChange
      .mockRejectedValueOnce(new Error('freshness failed'));

    const result = await service.uploadTestFiles(
      1,
      [createVocsFile(newData)],
      true
    );

    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.issues).toEqual([
      expect.objectContaining({
        level: 'warning',
        category: 'coding_freshness',
        fileName: 'UNIT_A.VOCS',
        message: expect.stringContaining('Datei wurde gespeichert')
      })
    ]);
    expect(result.uploadedFiles?.[0]).not.toHaveProperty('issues');
    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
  });

  it('keeps incomplete variable cache fresh after a pure coding scheme upload', async () => {
    const service = makeService();
    const oldData = createCodingScheme({ processing: [] });
    const newData = createCodingScheme({ processing: ['IGNORE_CASE'] });
    mockFileUploadRepository.findOne.mockResolvedValue({
      file_id: 'UNIT_A.VOCS',
      data: oldData
    });

    await service.uploadTestFiles(1, [createVocsFile(newData)], true);

    expect(mockCodingStatisticsService.invalidateCache).not.toHaveBeenCalled();
    expect(mockCodingStatisticsService.invalidateIncompleteVariablesCache)
      .toHaveBeenCalledWith(1);
    expect(mockCodingReadinessCacheInvalidator.invalidateWorkspaceReadinessCache)
      .toHaveBeenCalledWith(1);
  });

  it('extracts coding scheme refs for unit XML files uploaded as octet-stream', async () => {
    const service = makeService();
    const unitXml = `
      <Unit>
        <Metadata><Id>UNIT_A</Id></Metadata>
        <CodingSchemeRef>UNIT_A.VOCS</CodingSchemeRef>
      </Unit>
    `;
    mockFileUploadRepository.findOne.mockResolvedValue(null);

    await (
      service as unknown as {
        handleOctetStreamFile: (...args: unknown[]) => Promise<unknown>;
      }
    ).handleOctetStreamFile(
      1,
      {
        fieldname: 'files',
        originalname: 'unit_a.xml',
        encoding: '7bit',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from(unitXml),
        size: Buffer.byteLength(unitXml)
      },
      true
    );

    expect(mockWorkspaceFileParsingService.extractUnitInfo).toHaveBeenCalled();
    expect(mockFileUploadRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        file_type: 'Unit',
        structured_data: {
          extractedInfo: expect.objectContaining({
            rootElement: 'Unit',
            detectedVia: 'octet-stream-handler',
            codingSchemeRefNormalized: 'UNIT_A'
          })
        }
      }),
      ['file_id', 'workspace_id']
    );
  });

  it('invalidates workspace file caches after Testcenter import writes files', async () => {
    const service = makeService();
    const conflictQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };
    const insertQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined)
    };
    mockFileUploadRepository.createQueryBuilder
      .mockReturnValueOnce(conflictQueryBuilder)
      .mockReturnValueOnce(insertQueryBuilder);
    mockFileUploadRepository.find.mockResolvedValue([]);
    const invalidateSpy = jest
      .spyOn(
        service as unknown as {
          invalidateWorkspaceFileCaches: (workspaceId: number) => Promise<void>;
        },
        'invalidateWorkspaceFileCaches'
      )
      .mockResolvedValue(undefined);

    await service.testCenterImport([
      {
        workspace_id: 1,
        file_id: 'UNIT_A.VOCS',
        filename: 'UNIT_A.VOCS',
        file_type: 'Resource',
        file_size: 12,
        data: createCodingScheme()
      }
    ]);

    expect(invalidateSpy).toHaveBeenCalledWith(1);
  });

  it('extracts coding scheme refs for Unit files imported from Testcenter', async () => {
    const service = makeService();
    const conflictQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };
    const insertQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined)
    };
    mockFileUploadRepository.createQueryBuilder
      .mockReturnValueOnce(conflictQueryBuilder)
      .mockReturnValueOnce(insertQueryBuilder);

    await service.testCenterImport([
      {
        workspace_id: 1,
        file_id: 'UnitA',
        filename: 'UnitA.xml',
        file_type: 'Unit',
        file_size: 12,
        data: '<Unit><CodingSchemeRef>UnitA.vocs</CodingSchemeRef></Unit>'
      }
    ]);

    expect(mockWorkspaceFileParsingService.extractUnitInfo).toHaveBeenCalled();
    expect(insertQueryBuilder.values).toHaveBeenCalledWith([
      expect.objectContaining({
        file_id: 'UnitA',
        structured_data: {
          extractedInfo: expect.objectContaining({
            codingSchemeRefNormalized: 'UNIT_A'
          })
        }
      })
    ]);
  });

  it('invalidates auto-coding readiness cache when workspace file caches are invalidated', async () => {
    const service = makeService();

    await service.invalidateWorkspaceFileCaches(1);

    expect(mockCodingReadinessCacheInvalidator.invalidateWorkspaceReadinessCache)
      .toHaveBeenCalledWith(1);
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

  it('should reuse one unit variable cache refresh for concurrent workspace requests', async () => {
    const service = makeService();
    let resolveRefresh: () => void = () => undefined;
    const refreshSpy = jest
      .spyOn(
        service as unknown as {
          refreshUnitVariableCacheInternal: (workspaceId: number) => Promise<void>;
        },
        'refreshUnitVariableCacheInternal'
      )
      .mockImplementation(
        () => new Promise<void>(resolve => {
          resolveRefresh = resolve;
        })
      );

    const firstRefresh = service.refreshUnitVariableCache(4);
    const secondRefresh = service.refreshUnitVariableCache(4);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(4);

    resolveRefresh();
    await Promise.all([firstRefresh, secondRefresh]);
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
    createQueryBuilder: jest.fn(),
    manager: {
      connection: {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn().mockResolvedValue(undefined),
          startTransaction: jest.fn().mockResolvedValue(undefined),
          query: jest.fn().mockResolvedValue(undefined),
          commitTransaction: jest.fn().mockResolvedValue(undefined),
          rollbackTransaction: jest.fn().mockResolvedValue(undefined),
          release: jest.fn().mockResolvedValue(undefined)
        })
      }
    }
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
    createQueryBuilder: jest.fn(),
    manager: {
      connection: {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn().mockResolvedValue(undefined),
          startTransaction: jest.fn().mockResolvedValue(undefined),
          query: jest.fn().mockResolvedValue(undefined),
          commitTransaction: jest.fn().mockResolvedValue(undefined),
          rollbackTransaction: jest.fn().mockResolvedValue(undefined),
          release: jest.fn().mockResolvedValue(undefined)
        })
      }
    }
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

  it('should use a case-sensitive regex search when enabled', async () => {
    const service = mockService();
    await service.findFiles(1, {
      page: 1,
      limit: 20,
      searchText: '^Unit_\\d+\\.xml$',
      regexSearch: true
    });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      "(file.filename ~ :searchRegex OR file.file_type ~ :searchRegex OR TO_CHAR(file.created_at, 'DD.MM.YYYY HH24:MI') ~ :searchRegex)",
      { searchRegex: '^Unit_\\d+\\.xml$' }
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
  const cacheStore = new Map<string, unknown>();

  const unitXml = `
    <Unit>
      <Metadata><Id>UnitA</Id></Metadata>
      <BaseVariables>
        <Variable id="B1" alias="base_alias" type="string" multiple="1" nullable="false">
          <Values complete="1">
            <Value><label>Alpha</label><value>A</value></Value>
            <Value><label>Beta</label><value>B</value></Value>
          </Values>
          <ValuePositionLabels>
            <ValuePositionLabel>First option</ValuePositionLabel>
            <ValuePositionLabel>Second option</ValuePositionLabel>
          </ValuePositionLabels>
        </Variable>
        <Variable id="04" alias="02" type="string" />
        <Variable id="07" alias="04" type="string" />
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
        id: '04',
        alias: '02',
        sourceType: 'BASE',
        type: 'string',
        codes: []
      },
      {
        id: '07',
        alias: '04',
        sourceType: 'BASE',
        type: 'string',
        codes: []
      },
      {
        id: 'D1',
        alias: 'derived_alias',
        sourceType: 'MANUAL',
        type: 'integer',
        deriveSources: ['B1'],
        codes: [{
          id: 1,
          label: 'Code 1',
          score: 1,
          manualInstruction: '<p>Manual</p>'
        }]
      },
      {
        id: 'DX',
        alias: 'xml_derived_alias',
        sourceType: 'MANUAL',
        type: 'boolean',
        deriveSources: ['base_alias'],
        codes: []
      },
      {
        id: 'S1',
        alias: 'scheme_only_alias',
        sourceType: 'SUM_SCORE',
        type: 'number',
        codes: [{ id: 2, label: 'Code 2', score: 2 }]
      },
      {
        id: 'G1',
        alias: 'general_instruction_only',
        sourceType: 'MANUAL',
        type: 'string',
        manualInstruction: '<p>General instruction only</p>',
        codes: [{
          id: 3,
          label: 'Code 3',
          score: 3,
          manualInstruction: ''
        }]
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
  const mockCacheService = {
    get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key) || null)),
    set: jest.fn((key: string, value: unknown) => {
      cacheStore.set(key, value);
      return Promise.resolve(true);
    }),
    delete: jest.fn((key: string) => {
      cacheStore.delete(key);
      return Promise.resolve(true);
    })
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
      mockCacheService as unknown as CtorParams[10],
      { invalidateWorkspaceStatsCache: jest.fn().mockResolvedValue(undefined) } as unknown as CtorParams[11]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    cacheStore.clear();
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
      isDerived: false,
      multiple: true,
      nullable: false,
      valuesComplete: true,
      values: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' }
      ],
      valuePositionLabels: ['First option', 'Second option']
    });
    expect(derivedFromScheme).toMatchObject({
      id: 'D1',
      alias: 'derived_alias',
      type: 'integer',
      isDerived: true
    });
  });

  it('should keep schema ids separate from aliases when ids collide with other aliases', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const visibleVariable02 = unit.variables.find(variable => variable.alias === '02');
    const visibleVariable04 = unit.variables.find(variable => variable.alias === '04');

    expect(visibleVariable02).toMatchObject({
      id: '04',
      alias: '02',
      sourceType: 'BASE'
    });
    expect(visibleVariable04).toMatchObject({
      id: '07',
      alias: '04',
      sourceType: 'BASE'
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

  it('should resolve derived variable source mappings from deriveSources', async () => {
    const service = makeService();

    const sourceMap = await service.getDerivedVariablesBySourceMap(1);

    expect(sourceMap.get(getManualCodingScopeKey('UnitA', 'base_alias')))
      .toEqual(new Set(['derived_alias', 'xml_derived_alias']));
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'workspace_files:v2:derived_variables_by_source:1',
      {
        [getManualCodingScopeKey('UnitA', 'base_alias')]: [
          'derived_alias',
          'xml_derived_alias'
        ]
      }
    );
  });

  it('should cache variables with manual instructions by response alias', async () => {
    const service = makeService();

    const manualInstructionMap = await service.getManualInstructionVariableMap(1);

    expect(manualInstructionMap.get('UnitA')).toEqual(new Set(['derived_alias']));
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'workspace_files:v2:manual_instruction_variables:1',
      {
        UnitA: ['derived_alias']
      }
    );
  });

  it('should not treat variable-level instructions as selectable manual codes', async () => {
    const service = makeService();

    const manualInstructionMap = await service.getManualInstructionVariableMap(1);

    expect(manualInstructionMap.get('UnitA'))
      .not.toContain('general_instruction_only');
  });
});
