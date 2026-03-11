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
      {} as unknown as CtorParams[9]
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
      {} as unknown as CtorParams[9]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use createQueryBuilder to delete files', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', '2', '3'];

    await service.deleteTestFiles(workspaceId, fileIds);

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
  });

  it('should filter out invalid IDs', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', 'nan', '3'];

    await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'id IN (:...ids)',
      { ids: [1, 3] }
    );
  });

  it('should invalidate coding statistics cache', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1'];

    await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(workspaceId);
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
      {} as unknown as CtorParams[9]
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
    {} as unknown as CtorParams[9]
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
      {} as unknown as CtorParams[9]
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
