import { BadRequestException } from '@nestjs/common';
import { ContentPoolIntegrationService } from './content-pool-integration.service';
import { WorkspaceFilesService } from '../../database/services/workspace';

type HttpServiceMock = {
  axiosRef: {
    get: jest.Mock;
    post: jest.Mock;
  };
};

type WorkspaceFilesServiceMock = {
  uploadTestFiles: jest.Mock;
};

type SettingRepositoryMock = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  getContent: (key: string) => string | undefined;
};

function createHttpServiceMock(): HttpServiceMock {
  return {
    axiosRef: {
      get: jest.fn(),
      post: jest.fn()
    }
  };
}

function createWorkspaceFilesServiceMock(): WorkspaceFilesServiceMock {
  return {
    uploadTestFiles: jest.fn()
  };
}

function createSettingRepositoryMock(
  initial: Record<string, string> = {}
): SettingRepositoryMock {
  const store = new Map(Object.entries(initial));

  return {
    findOne: jest.fn(({ where }: { where: { key: string } }) => Promise.resolve(
      store.has(where.key) ? { key: where.key, content: store.get(where.key) } : null
    )),
    create: jest.fn(entity => entity),
    save: jest.fn(entity => {
      store.set(entity.key, entity.content);
      return Promise.resolve(entity);
    }),
    getContent: (key: string) => store.get(key)
  };
}

function createService(
  httpService: HttpServiceMock = createHttpServiceMock(),
  workspaceFilesService: WorkspaceFilesServiceMock = createWorkspaceFilesServiceMock(),
  settingRepository: SettingRepositoryMock = createSettingRepositoryMock()
): ContentPoolIntegrationService {
  type CtorParams = ConstructorParameters<typeof ContentPoolIntegrationService>;

  return new ContentPoolIntegrationService(
    settingRepository as unknown as CtorParams[0],
    {} as unknown as CtorParams[1],
    httpService as unknown as CtorParams[2],
    workspaceFilesService as unknown as CtorParams[3]
  );
}

function createEnabledSettings(): SettingRepositoryMock {
  return createSettingRepositoryMock({
    'system-content-pool-enabled': 'true',
    'system-content-pool-base-url': 'http://content-pool.test',
    'system-content-pool-application-token': 'cp_test_token'
  });
}

function normalizeApiBaseUrl(
  service: ContentPoolIntegrationService,
  rawBaseUrl: string
): string {
  return (
    service as unknown as { normalizeApiBaseUrl: (x: string) => string }
  ).normalizeApiBaseUrl(rawBaseUrl);
}

describe('ContentPoolIntegrationService.normalizeApiBaseUrl', () => {
  let service: ContentPoolIntegrationService;

  beforeEach(() => {
    service = createService();
  });

  it('should add https protocol and api suffix', () => {
    const out = normalizeApiBaseUrl(service, 'content-pool.example.org');

    expect(out).toBe('https://content-pool.example.org/api');
  });

  it('should remove trailing slashes before checking api suffix', () => {
    const out = normalizeApiBaseUrl(
      service,
      'https://content-pool.example.org/api///'
    );

    expect(out).toBe('https://content-pool.example.org/api');
  });

  it('should reject invalid URLs', () => {
    expect(() => normalizeApiBaseUrl(service, 'bad url')).toThrow(
      BadRequestException
    );
  });

  it('should handle long slash-heavy input without regex backtracking', () => {
    const out = normalizeApiBaseUrl(
      service,
      `https://content-pool.example.org${'/'.repeat(50000)}x`
    );

    expect(out.endsWith('x/api')).toBe(true);
  });
});

describe('ContentPoolIntegrationService settings', () => {
  it('should report whether an application token is configured without returning it', async () => {
    const settingRepository = createEnabledSettings();
    const service = createService(undefined, undefined, settingRepository);

    await expect(service.getSettings()).resolves.toEqual({
      enabled: true,
      baseUrl: 'http://content-pool.test',
      hasApplicationToken: true
    });
  });

  it('should store a new application token and only return token presence', async () => {
    const settingRepository = createSettingRepositoryMock();
    const service = createService(undefined, undefined, settingRepository);

    await expect(service.updateSettings({
      enabled: true,
      baseUrl: 'http://content-pool.test',
      applicationToken: 'cp_new_token'
    })).resolves.toEqual({
      enabled: true,
      baseUrl: 'http://content-pool.test',
      hasApplicationToken: true
    });
    expect(settingRepository.getContent('system-content-pool-application-token'))
      .toBe('cp_new_token');
  });

  it('should reject enabling the integration without an application token', async () => {
    const service = createService();

    await expect(service.updateSettings({
      enabled: true,
      baseUrl: 'http://content-pool.test'
    })).rejects.toThrow(BadRequestException);
  });
});

describe('ContentPoolIntegrationService.listAccessibleAcps', () => {
  it('should list ACPs through the Content Pool server API token', async () => {
    const httpService = createHttpServiceMock();
    const settingRepository = createEnabledSettings();
    const service = createService(httpService, undefined, settingRepository);
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: [{ id: 'acp-1', name: 'ACP 1' }]
    });

    await expect(service.listAccessibleAcps()).resolves.toEqual({
      settings: {
        enabled: true,
        baseUrl: 'http://content-pool.test',
        hasApplicationToken: true
      },
      acps: [expect.objectContaining({ id: 'acp-1', name: 'ACP 1' })]
    });
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'http://content-pool.test/api/server/acp',
      { headers: { 'X-Server-Token': 'cp_test_token' } }
    );
  });
});

describe('ContentPoolIntegrationService.importAcpFilesToWorkspace', () => {
  it('should download ACP files through the server API and pass them through the workspace upload pipeline', async () => {
    const httpService = createHttpServiceMock();
    const workspaceFilesService = createWorkspaceFilesServiceMock();
    const settingRepository = createEnabledSettings();
    const service = createService(httpService, workspaceFilesService, settingRepository);

    httpService.axiosRef.get
      .mockResolvedValueOnce({
        data: [{ id: 'acp-1', name: 'ACP 1' }]
      })
      .mockResolvedValueOnce({
        data: [
          { id: 'file-1', originalName: 'unit.xml' },
          { id: 'file-2', originalName: 'scheme.vocs' }
        ]
      })
      .mockResolvedValueOnce({
        data: Buffer.from('<Unit/>'),
        headers: { 'content-type': 'application/xml' }
      })
      .mockResolvedValueOnce({
        data: Buffer.from('{}'),
        headers: { 'content-type': 'application/json' }
      });
    workspaceFilesService.uploadTestFiles.mockResolvedValueOnce({
      total: 2,
      uploaded: 2,
      failed: 0
    });
    const reportProgress = jest.fn();

    const result = await service.importAcpFilesToWorkspace({
      workspaceId: 123,
      acpId: 'acp-1',
      overwriteExisting: true,
      overwriteFileIds: ['UNIT']
    }, reportProgress);

    expect(result).toEqual({
      total: 2,
      uploaded: 2,
      failed: 0
    });
    expect(httpService.axiosRef.get).toHaveBeenNthCalledWith(
      3,
      'http://content-pool.test/api/server/acp/acp-1/files/file-1/download',
      expect.objectContaining({
        headers: { 'X-Server-Token': 'cp_test_token' },
        responseType: 'arraybuffer'
      })
    );
    expect(workspaceFilesService.uploadTestFiles).toHaveBeenCalledWith(
      123,
      [
        expect.objectContaining({
          originalname: 'unit.xml',
          mimetype: 'application/xml',
          size: 7
        }),
        expect.objectContaining({
          originalname: 'scheme.vocs',
          mimetype: 'application/octet-stream',
          size: 2
        })
      ],
      true,
      ['UNIT']
    );
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading-files',
      processedFiles: 2,
      totalFiles: 2,
      progress: 88
    }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'uploading-files',
      progress: 92
    }));
  });
});

describe('ContentPoolIntegrationService.uploadWorkspaceFilesToAcp', () => {
  it('should replace matching coding schemes through the server API and report skipped files', async () => {
    const httpService = createHttpServiceMock();
    const workspaceFilesService = createWorkspaceFilesServiceMock();
    const settingRepository = createEnabledSettings();
    const fileUploadRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 11,
          filename: 'scheme.vocs',
          workspace_id: 123,
          data: Buffer.from('{}').toString('base64')
        },
        {
          id: 12,
          filename: 'missing.vocs',
          workspace_id: 123,
          data: '{}'
        }
      ])
    };
    const service = new ContentPoolIntegrationService(
      settingRepository as never,
      fileUploadRepository as never,
      httpService as never,
      workspaceFilesService as unknown as WorkspaceFilesService
    );

    httpService.axiosRef.get
      .mockResolvedValueOnce({
        data: [{ id: 'acp-1', name: 'ACP 1' }]
      })
      .mockResolvedValueOnce({
        data: [{ id: 'target-file-1', originalName: 'scheme.vocs' }]
      });
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { snapshot: { id: 'snapshot-1', versionNumber: 7 } }
    });
    const reportProgress = jest.fn();

    const result = await service.uploadWorkspaceFilesToAcp({
      workspaceId: 123,
      acpId: 'acp-1',
      fileIds: [11, 12],
      changelog: 'manual changelog'
    }, reportProgress);

    expect(result).toEqual({
      acpId: 'acp-1',
      total: 2,
      replaced: 1,
      skipped: 1,
      failed: 0,
      replacedFiles: [{ fileId: 11, filename: 'scheme.vocs' }],
      skippedFiles: [{
        fileId: 12,
        filename: 'missing.vocs',
        reason: 'Keine Datei mit gleichem Namen im ACP gefunden.'
      }],
      failedFiles: [],
      snapshotId: 'snapshot-1',
      versionNumber: 7,
      changelog: 'manual changelog'
    });
    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'http://content-pool.test/api/server/acp/acp-1/coding-schemes/replace',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Server-Token': 'cp_test_token' }),
        maxBodyLength: Infinity
      })
    );
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'replacing-files',
      processedFiles: 2,
      totalFiles: 2,
      progress: 90
    }));
  });
});
