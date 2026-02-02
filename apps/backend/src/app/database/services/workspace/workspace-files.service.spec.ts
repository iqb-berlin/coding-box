import { WorkspaceFilesService } from './workspace-files.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';

describe('WorkspaceFilesService.uploadTestFiles', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    upsert: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null)
  };

  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined),
    invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
  };

  const mockWorkspaceXmlSchemaValidationService = {
    validateXmlViaXsdUrl: jest
      .fn()
      .mockResolvedValue({ schemaValid: true, errors: [] })
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      mockFileUploadRepository as unknown as CtorParams[0],
      {} as unknown as CtorParams[1],
      {} as unknown as CtorParams[2],
      {} as unknown as CtorParams[3],
      mockCodingStatisticsService as unknown as CtorParams[4],
      mockWorkspaceXmlSchemaValidationService as unknown as CtorParams[5],
      {} as unknown as CtorParams[6],
      {} as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeXmlFile = (
    name: string,
    content: string = '<Unit><Metadata><Id>TEST</Id></Metadata></Unit>'
  ): FileIo => ({
    fieldname: 'files',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/xml',
    buffer: Buffer.from(content),
    size: content.length
  });

  it('should handle non-array files input gracefully', async () => {
    const service = makeService();

    const result = await service.uploadTestFiles(
      1,
      null as unknown as FileIo[],
      true
    );

    expect(result.total).toBe(0);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.failedFiles).toBeDefined();
    expect(result.failedFiles?.[0]?.reason).toContain('Invalid files input');
  });

  it('should upload a single XML file successfully', async () => {
    const service = makeService();
    const file = makeXmlFile('unit.xml');

    const result = await service.uploadTestFiles(1, [file], true);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
    expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1);
    expect(
      mockCodingStatisticsService.invalidateIncompleteVariablesCache
    ).toHaveBeenCalledWith(1);
  });

  it('should handle file conflicts when not overwriting', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'TEST'
    });

    const file = makeXmlFile('unit.xml');
    const result = await service.uploadTestFiles(1, [file], false);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts?.length).toBe(1);
    expect(result.conflicts?.[0].fileId).toBe('TEST');
  });

  it('should overwrite existing files when overwriteExisting is true', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'TEST'
    });

    const file = makeXmlFile('unit.xml');
    const result = await service.uploadTestFiles(1, [file], true);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(result.conflicts).toBeUndefined();
    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
  });

  it('should skip files not in overwriteAllowList when overwriteExisting is true', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'TEST'
    });

    const file = makeXmlFile('unit.xml');
    // Only allow overwriting OTHER files, not TEST
    const result = await service.uploadTestFiles(1, [file], true, ['OTHER']);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(0);
    // File is silently skipped when not in allow list
    expect(result.conflicts).toBeUndefined();
  });

  it('should process files in the overwriteAllowList', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'TEST'
    });

    const file = makeXmlFile('unit.xml');
    // Allow overwriting TEST
    const result = await service.uploadTestFiles(1, [file], true, ['TEST']);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(result.conflicts).toBeUndefined();
  });

  it('should handle XSD validation failures', async () => {
    const service = makeService();
    mockWorkspaceXmlSchemaValidationService.validateXmlViaXsdUrl.mockResolvedValueOnce(
      {
        schemaValid: false,
        errors: ['Invalid schema']
      }
    );

    const file = makeXmlFile('unit.xml');
    const result = await service.uploadTestFiles(1, [file], true);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failedFiles?.[0].reason).toContain('XSD validation failed');
  });

  it('should handle invalid XML gracefully', async () => {
    const service = makeService();

    const file = makeXmlFile('invalid.xml', '<InvalidRoot></InvalidRoot>');
    const result = await service.uploadTestFiles(1, [file], true);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('should handle mixed success and failures', async () => {
    const service = makeService();
    mockWorkspaceXmlSchemaValidationService.validateXmlViaXsdUrl
      .mockResolvedValueOnce({ schemaValid: true, errors: [] })
      .mockResolvedValueOnce({ schemaValid: false, errors: ['Error'] });

    const files = [
      makeXmlFile(
        'unit1.xml',
        '<Unit><Metadata><Id>TEST1</Id></Metadata></Unit>'
      ),
      makeXmlFile(
        'unit2.xml',
        '<Unit><Metadata><Id>TEST2</Id></Metadata></Unit>'
      )
    ];
    const result = await service.uploadTestFiles(1, files, true);

    expect(result.total).toBe(2);
    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe('WorkspaceFilesService.handleFile', () => {
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
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('id IN (:...ids)', {
      ids: [1, 2, 3]
    });
    expect(mockQueryBuilder.execute).toHaveBeenCalled();
  });

  it('should filter out invalid IDs', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1', 'nan', '3'];

    await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('id IN (:...ids)', {
      ids: [1, 3]
    });
  });

  it('should invalidate coding statistics cache', async () => {
    const service = makeService();
    const workspaceId = 1;
    const fileIds = ['1'];

    await service.deleteTestFiles(workspaceId, fileIds);

    expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(
      workspaceId
    );
  });
});

describe('WorkspaceFilesService.downloadTestFile', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    findOne: jest.fn()
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
  });

  it('should return file with base64 data for text content', async () => {
    const service = makeService();
    const fileData = '<Unit><Metadata><Id>TEST</Id></Metadata></Unit>';
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      filename: 'unit.xml',
      data: fileData
    });

    const result = await service.downloadTestFile(1, 1);

    expect(result.filename).toBe('unit.xml');
    expect(result.base64Data).toBe(
      Buffer.from(fileData, 'utf8').toString('base64')
    );
    expect(result.mimeType).toBe('application/xml');
  });

  it('should return file with existing base64 data unchanged', async () => {
    const service = makeService();
    const base64Data = 'SGVsbG8gV29ybGQ='; // "Hello World" in base64
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      filename: 'binary.dat',
      data: base64Data
    });

    const result = await service.downloadTestFile(1, 1);

    expect(result.base64Data).toBe(base64Data);
  });

  it('should throw error when file not found', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce(null);

    await expect(service.downloadTestFile(1, 999)).rejects.toThrow(
      'File not found'
    );
  });

  it('should use binary conversion as fallback for invalid UTF-8', async () => {
    const service = makeService();
    // Invalid UTF-8 sequence that would cause Buffer.from(str, 'utf8') to fail
    const invalidData = '\xFF\xFE';
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      filename: 'corrupt.xml',
      data: invalidData
    });

    const result = await service.downloadTestFile(1, 1);

    expect(result.base64Data).toBeDefined();
    expect(result.filename).toBe('corrupt.xml');
  });
});

describe('WorkspaceFilesService.handleZipFile', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockWorkspaceFileStorageService = {
    unzipToFileIos: jest.fn()
  };

  function makeService(): WorkspaceFilesService {
    return new WorkspaceFilesService(
      {} as unknown as CtorParams[0],
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

  const makeZipFile = (): FileIo => ({
    fieldname: 'files',
    originalname: 'archive.zip',
    encoding: '7bit',
    mimetype: 'application/zip',
    buffer: Buffer.from('fake-zip-data'),
    size: 100
  });

  it('should extract files from ZIP and process them recursively', async () => {
    const service = makeService();
    const zipFile = makeZipFile();

    const innerFiles: FileIo[] = [
      {
        fieldname: 'files',
        originalname: 'unit.xml',
        encoding: '7bit',
        mimetype: 'application/xml',
        buffer: Buffer.from('<Unit><Metadata><Id>TEST</Id></Metadata></Unit>'),
        size: 50
      }
    ];
    mockWorkspaceFileStorageService.unzipToFileIos.mockReturnValueOnce(
      innerFiles
    );

    const handleXmlSpy = jest
      .spyOn(
        service as unknown as {
          handleXmlFile: (...args: unknown[]) => Promise<unknown>;
        },
        'handleXmlFile'
      )
      .mockResolvedValue(undefined);

    const tasks = service.handleFile(1, zipFile, true);
    await Promise.all(tasks);

    expect(mockWorkspaceFileStorageService.unzipToFileIos).toHaveBeenCalledWith(
      zipFile.buffer
    );
    expect(handleXmlSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle empty ZIP file', async () => {
    const service = makeService();
    const zipFile = makeZipFile();

    mockWorkspaceFileStorageService.unzipToFileIos.mockReturnValueOnce([]);

    const tasks = service.handleFile(1, zipFile, true);
    const results = await Promise.allSettled(tasks);

    expect(results.length).toBe(0);
  });

  it('should handle ZIP extraction errors', async () => {
    const service = makeService();
    const zipFile = makeZipFile();

    mockWorkspaceFileStorageService.unzipToFileIos.mockImplementationOnce(
      () => {
        throw new Error('Invalid ZIP format');
      }
    );

    const tasks = service.handleFile(1, zipFile, true);
    const results = await Promise.allSettled(tasks);

    expect(results.length).toBe(1);
    expect(results[0].status).toBe('rejected');
  });
});

describe('WorkspaceFilesService.handleOctetStreamFile', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation(data => data)
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
  });

  it('should handle text file as UTF-8', async () => {
    const service = makeService();
    const file: FileIo = {
      fieldname: 'files',
      originalname: 'data.txt',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from('Hello World'),
      size: 11
    };

    await (
      service as unknown as {
        handleOctetStreamFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, file, true);

    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
    const upsertCall = mockFileUploadRepository.upsert.mock.calls[0];
    expect(upsertCall[0].data).toBe('Hello World');
    expect(upsertCall[0].file_type).toBe('Resource');
  });

  it('should detect Unit XML content in octet-stream', async () => {
    const service = makeService();
    const file: FileIo = {
      fieldname: 'files',
      originalname: 'test.xml',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from(
        '<?xml version="1.0"?><Unit><Metadata><Id>U1</Id></Metadata></Unit>'
      ),
      size: 50
    };

    await (
      service as unknown as {
        handleOctetStreamFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, file, true);

    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
    const upsertCall = mockFileUploadRepository.upsert.mock.calls[0];
    expect(upsertCall[0].file_type).toBe('Unit');
    expect(upsertCall[0].structured_data.extractedInfo.rootElement).toBe(
      'Unit'
    );
  });

  it('should handle binary file as base64', async () => {
    const service = makeService();
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const file: FileIo = {
      fieldname: 'files',
      originalname: 'image.bin',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      buffer: binaryData,
      size: 4
    };

    await (
      service as unknown as {
        handleOctetStreamFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, file, true);

    const upsertCall = mockFileUploadRepository.upsert.mock.calls[0];
    expect(upsertCall[0].data).toBe(binaryData.toString('base64'));
  });

  it('should detect conflict when file exists and no overwrite', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'DATA.TXT'
    });

    const file: FileIo = {
      fieldname: 'files',
      originalname: 'data.txt',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from('content'),
      size: 7
    };

    const result = await (
      service as unknown as {
        handleOctetStreamFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleOctetStreamFile(1, file, false);

    expect(result).toMatchObject({
      conflict: true,
      fileId: 'DATA.TXT'
    });
  });
});

describe('WorkspaceFilesService.handleHtmlFile', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined)
  };

  const mockWorkspaceFileParsingService = {
    getSchemerId: jest.fn().mockReturnValue('SCHEMER-1'),
    getPlayerId: jest.fn().mockReturnValue('PLAYER-1')
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
      mockWorkspaceFileParsingService as unknown as CtorParams[7],
      {} as unknown as CtorParams[8],
      {} as unknown as CtorParams[9]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const makeHtmlFile = (content: string): FileIo => ({
    fieldname: 'files',
    originalname: 'player.html',
    encoding: '7bit',
    mimetype: 'text/html',
    buffer: Buffer.from(content),
    size: content.length
  });

  it('should handle HTML player file', async () => {
    const service = makeService();
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="application/ld+json">{"@type": "player"}</script>
</head>
<body></body>
</html>`;
    const file = makeHtmlFile(htmlContent);

    await (
      service as unknown as {
        handleHtmlFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleHtmlFile(1, file, true);

    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
    const upsertCall = mockFileUploadRepository.upsert.mock.calls[0];
    expect(upsertCall[0].file_type).toBe('Resource');
    expect(upsertCall[0].file_id).toBe('PLAYER-1');
  });

  it('should handle HTML schemer file', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce(null);

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="application/ld+json">{"@type": "schemer"}</script>
</head>
<body></body>
</html>`;
    const file = makeHtmlFile(htmlContent);

    await (
      service as unknown as {
        handleHtmlFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleHtmlFile(1, file, true);

    const upsertCall = mockFileUploadRepository.upsert.mock.calls[0];
    expect(upsertCall[0].file_type).toBe('Schemer');
    expect(upsertCall[0].file_id).toBe('SCHEMER-1');
  });

  it('should handle malformed metadata gracefully', async () => {
    const service = makeService();
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <script type="application/ld+json">invalid json</script>
</head>
<body></body>
</html>`;
    const file = makeHtmlFile(htmlContent);

    await (
      service as unknown as {
        handleHtmlFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleHtmlFile(1, file, true);

    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
  });

  it('should detect conflict for existing player file', async () => {
    const service = makeService();
    mockFileUploadRepository.findOne.mockResolvedValueOnce({
      id: 1,
      file_id: 'PLAYER-1'
    });

    const htmlContent = `<!DOCTYPE html>
<html lang="en"><head></head><body></body></html>`;
    const file = makeHtmlFile(htmlContent);

    const result = await (
      service as unknown as {
        handleHtmlFile: (
          workspaceId: number,
          file: FileIo,
          overwriteExisting: boolean
        ) => Promise<unknown>;
      }
    ).handleHtmlFile(1, file, false);

    expect(result).toMatchObject({
      conflict: true,
      fileId: 'PLAYER-1',
      fileType: 'Resource'
    });
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
      {} as unknown as CtorParams[9]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty result when no files exist', async () => {
    const service = makeService();
    mockQueryBuilder.getManyAndCount.mockResolvedValueOnce([[], 0]);

    const [files, total] = await service.findFiles(1);

    expect(files).toEqual([]);
    expect(total).toBe(0);
  });

  it('should apply pagination correctly', async () => {
    const service = makeService();
    const mockFiles = [
      { id: 1, filename: 'test1.xml', file_type: 'Unit' },
      { id: 2, filename: 'test2.xml', file_type: 'Unit' }
    ];
    mockQueryBuilder.getManyAndCount.mockResolvedValueOnce([mockFiles, 10]);

    const [files, total] = await service.findFiles(1, { page: 2, limit: 5 });

    expect(mockQueryBuilder.skip).toHaveBeenCalledWith(5); // (2-1) * 5
    expect(mockQueryBuilder.take).toHaveBeenCalledWith(5);
    expect(files.length).toBe(2);
    expect(total).toBe(10);
  });

  it('should apply fileType filter', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 1, limit: 20, fileType: 'Unit' });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'file.file_type = :fileType',
      { fileType: 'Unit' }
    );
  });

  it('should apply fileSize filter for 0-10KB range', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 1, limit: 20, fileSize: '0-10KB' });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'file.file_size < :max',
      { max: 10240 }
    );
  });

  it('should apply fileSize filter for 10MB+ range', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 1, limit: 20, fileSize: '10MB+' });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'file.file_size >= :min',
      { min: 10485760 }
    );
  });

  it('should apply search text filter', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 1, limit: 20, searchText: 'test' });

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(file.filename) LIKE :search'),
      { search: '%test%' }
    );
  });

  it('should clamp limit to maximum of 10000', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 1, limit: 50000 });

    expect(mockQueryBuilder.take).toHaveBeenCalledWith(10000);
  });

  it('should enforce minimum page of 1', async () => {
    const service = makeService();

    await service.findFiles(1, { page: 0, limit: 20 });

    expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0); // (1-1) * 20
  });
});

describe('WorkspaceFilesService.findAllFileTypes', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([])
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
      {} as unknown as CtorParams[9]
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty array when no file types exist', async () => {
    const service = makeService();
    mockQueryBuilder.getRawMany.mockResolvedValueOnce([]);

    const result = await service.findAllFileTypes(1);

    expect(result).toEqual([]);
  });

  it('should return sorted unique file types', async () => {
    const service = makeService();
    mockQueryBuilder.getRawMany.mockResolvedValueOnce([
      { file_type: 'Booklet' },
      { file_type: 'TestTakers' },
      { file_type: 'Unit' }
    ]);

    const result = await service.findAllFileTypes(1);

    expect(result).toEqual(['Booklet', 'TestTakers', 'Unit']);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      'file.workspace_id = :workspaceId',
      { workspaceId: 1 }
    );
  });

  it('should filter out null file types', async () => {
    const service = makeService();

    await service.findAllFileTypes(1);

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'file.file_type IS NOT NULL'
    );
  });

  it('should return empty array on database error', async () => {
    const service = makeService();
    mockQueryBuilder.getRawMany.mockRejectedValueOnce(new Error('DB Error'));

    const result = await service.findAllFileTypes(1);

    expect(result).toEqual([]);
  });
});

describe('WorkspaceFilesService.testCenterImport', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFilesService>;

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn(),
    create: jest.fn().mockImplementation(entries => entries),
    upsert: jest.fn().mockResolvedValue(undefined)
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
  });

  const mockSelectQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([])
  };

  const mockInsertQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({})
  };

  it('should handle empty entries array', async () => {
    const service = makeService();
    mockFileUploadRepository.createQueryBuilder.mockReturnValue(
      mockSelectQueryBuilder
    );

    const result = await service.testCenterImport([]);

    expect(result.total).toBe(0);
    expect(result.uploaded).toBe(0);
  });

  it('should handle non-array input gracefully', async () => {
    const service = makeService();
    mockFileUploadRepository.createQueryBuilder.mockReturnValue(
      mockSelectQueryBuilder
    );

    const result = await service.testCenterImport(
      null as unknown as Record<string, unknown>[]
    );

    expect(result.total).toBe(0);
    expect(result.uploaded).toBe(0);
  });

  it('should insert new files without conflicts', async () => {
    const service = makeService();
    mockSelectQueryBuilder.getMany.mockResolvedValueOnce([]);
    // First call (for select) returns select builder, subsequent calls (for insert) return insert builder
    let callCount = 0;
    mockFileUploadRepository.createQueryBuilder.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? mockSelectQueryBuilder : mockInsertQueryBuilder;
    });

    const entries = [
      {
        workspace_id: 1,
        file_id: 'FILE1',
        filename: 'file1.xml',
        file_type: 'Unit'
      },
      {
        workspace_id: 1,
        file_id: 'FILE2',
        filename: 'file2.xml',
        file_type: 'Unit'
      }
    ];

    const result = await service.testCenterImport(entries);

    expect(result.total).toBe(2);
    expect(result.uploaded).toBe(2);
    expect(result.conflicts).toBeUndefined();
  });

  it('should detect conflicts for existing files', async () => {
    const service = makeService();
    mockSelectQueryBuilder.getMany.mockResolvedValueOnce([
      { file_id: 'FILE1', filename: 'file1.xml', file_type: 'Unit' }
    ]);
    let callCount = 0;
    mockFileUploadRepository.createQueryBuilder.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? mockSelectQueryBuilder : mockInsertQueryBuilder;
    });

    const entries = [
      {
        workspace_id: 1,
        file_id: 'FILE1',
        filename: 'file1.xml',
        file_type: 'Unit'
      },
      {
        workspace_id: 1,
        file_id: 'FILE2',
        filename: 'file2.xml',
        file_type: 'Unit'
      }
    ];

    const result = await service.testCenterImport(entries);

    expect(result.total).toBe(2);
    expect(result.uploaded).toBe(1);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts?.length).toBe(1);
    expect(result.conflicts?.[0].fileId).toBe('FILE1');
  });

  it('should overwrite files when specified in overwriteFileIds', async () => {
    const service = makeService();
    mockSelectQueryBuilder.getMany.mockResolvedValueOnce([
      { file_id: 'FILE1', filename: 'file1.xml', file_type: 'Unit' }
    ]);
    let callCount = 0;
    mockFileUploadRepository.createQueryBuilder.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? mockSelectQueryBuilder : mockInsertQueryBuilder;
    });

    const entries = [
      {
        workspace_id: 1,
        file_id: 'FILE1',
        filename: 'file1.xml',
        file_type: 'Unit'
      }
    ];

    const result = await (
      service as unknown as {
        testCenterImport: (
          entries: Record<string, unknown>[],
          overwriteFileIds?: string[]
        ) => Promise<{
          total: number;
          uploaded: number;
          failed: number;
          uploadedFiles?: unknown[];
          conflicts?: unknown[];
          failedFiles?: unknown[];
        }>;
      }
    ).testCenterImport(entries, ['FILE1']);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(result.conflicts).toBeUndefined();
    expect(mockFileUploadRepository.upsert).toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    const service = makeService();
    mockFileUploadRepository.createQueryBuilder.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const entries = [
      {
        workspace_id: 1,
        file_id: 'FILE1',
        filename: 'file1.xml',
        file_type: 'Unit'
      }
    ];

    const result = await service.testCenterImport(entries);

    expect(result.total).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failedFiles?.[0].reason).toContain(
      'Database connection failed'
    );
  });
});
