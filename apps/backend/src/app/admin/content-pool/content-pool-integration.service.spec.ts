import { BadRequestException } from '@nestjs/common';
import { ContentPoolIntegrationService } from './content-pool-integration.service';
import { WorkspaceFilesService } from '../../database/services/workspace';

type HttpServiceMock = {
  axiosRef: {
    delete: jest.Mock;
    get: jest.Mock;
    post: jest.Mock;
  };
};

type WorkspaceFilesServiceMock = {
  uploadTestFiles: jest.Mock;
};

function createHttpServiceMock(): HttpServiceMock {
  return {
    axiosRef: {
      delete: jest.fn(),
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

function createService(
  httpService: HttpServiceMock = createHttpServiceMock(),
  workspaceFilesService: WorkspaceFilesServiceMock = createWorkspaceFilesServiceMock()
): ContentPoolIntegrationService {
  type CtorParams = ConstructorParameters<typeof ContentPoolIntegrationService>;

  return new ContentPoolIntegrationService(
    {} as unknown as CtorParams[0],
    {} as unknown as CtorParams[1],
    httpService as unknown as CtorParams[2],
    workspaceFilesService as unknown as CtorParams[3]
  );
}

function normalizeApiBaseUrl(
  service: ContentPoolIntegrationService,
  rawBaseUrl: string
): string {
  return (
    service as unknown as { normalizeApiBaseUrl: (x: string) => string }
  ).normalizeApiBaseUrl(rawBaseUrl);
}

function authenticate(
  service: ContentPoolIntegrationService,
  apiBaseUrl: string,
  username: string,
  password: string
): Promise<string> {
  return (
    service as unknown as {
      authenticate: (
        apiBaseUrl: string,
        username: string,
        password: string
      ) => Promise<string>;
    }
  ).authenticate(apiBaseUrl, username, password);
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

describe('ContentPoolIntegrationService.authenticate', () => {
  it('should return token from Content Pool password login', async () => {
    const httpService = createHttpServiceMock();
    const service = createService(httpService);
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { accessToken: 'content-pool-token' }
    });

    const token = await authenticate(
      service,
      'http://content-pool.test/api',
      'local-user',
      'local-password'
    );

    expect(token).toBe('content-pool-token');
    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'http://content-pool.test/api/auth/login',
      {
        username: 'local-user',
        password: 'local-password'
      }
    );
  });

  it('should fall back to Keycloak password grant after invalid local login', async () => {
    const httpService = createHttpServiceMock();
    const service = createService(httpService);
    const unauthorizedError = {
      isAxiosError: true,
      response: { status: 401, data: { message: 'Invalid credentials' } }
    };

    httpService.axiosRef.post
      .mockRejectedValueOnce(unauthorizedError)
      .mockResolvedValueOnce({
        data: { id_token: 'keycloak-id-token' }
      })
      .mockResolvedValueOnce({
        data: { accessToken: 'content-pool-oidc-token' }
      });
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: {
        enabled: true,
        issuerUrl: 'http://keycloak.test/realms/iqb/',
        clientId: 'contentpool',
        scope: 'openid profile email'
      }
    });

    const token = await authenticate(
      service,
      'http://content-pool.test/api',
      'keycloak-user',
      'keycloak-password'
    );

    expect(token).toBe('content-pool-oidc-token');
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'http://content-pool.test/api/auth/oidc-config'
    );
    expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
      2,
      'http://keycloak.test/realms/iqb/protocol/openid-connect/token',
      expect.stringContaining('grant_type=password'),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      }
    );
    expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
      3,
      'http://content-pool.test/api/auth/oidc-callback',
      { idToken: 'keycloak-id-token' }
    );
  });
});

describe('ContentPoolIntegrationService.importAcpFilesToWorkspace', () => {
  it('should download ACP files and pass them through the workspace upload pipeline', async () => {
    const httpService = createHttpServiceMock();
    const workspaceFilesService = createWorkspaceFilesServiceMock();
    const settingRepository = {
      findOne: jest.fn(({ where }: { where: { key: string } }) => Promise.resolve(
        {
          content:
            where.key === 'system-content-pool-enabled' ?
              'true' :
              'http://content-pool.test'
        }
      ))
    };
    const service = new ContentPoolIntegrationService(
      settingRepository as never,
      {} as never,
      httpService as never,
      workspaceFilesService as unknown as WorkspaceFilesService
    );

    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { accessToken: 'content-pool-token' }
    });
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
      username: 'user',
      password: 'pass',
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
      'http://content-pool.test/api/acp/acp-1/files/file-1/download',
      expect.objectContaining({ responseType: 'arraybuffer' })
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
  it('should replace matching ACP files and report skipped files', async () => {
    const httpService = createHttpServiceMock();
    const workspaceFilesService = createWorkspaceFilesServiceMock();
    const settingRepository = {
      findOne: jest.fn(({ where }: { where: { key: string } }) => Promise.resolve(
        {
          content:
            where.key === 'system-content-pool-enabled' ?
              'true' :
              'http://content-pool.test'
        }
      ))
    };
    const fileUploadRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 11,
          filename: 'unit.xml',
          workspace_id: 123,
          data: Buffer.from('<Unit/>').toString('base64')
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

    httpService.axiosRef.post
      .mockResolvedValueOnce({
        data: { accessToken: 'content-pool-token' }
      })
      .mockResolvedValueOnce({
        data: {}
      })
      .mockResolvedValueOnce({
        data: { id: 'snapshot-1', versionNumber: 7 }
      });
    httpService.axiosRef.get
      .mockResolvedValueOnce({
        data: [{ id: 'acp-1', name: 'ACP 1' }]
      })
      .mockResolvedValueOnce({
        data: [{ id: 'target-file-1', originalName: 'unit.xml' }]
      });
    httpService.axiosRef.delete.mockResolvedValueOnce({});
    const reportProgress = jest.fn();

    const result = await service.uploadWorkspaceFilesToAcp({
      workspaceId: 123,
      acpId: 'acp-1',
      username: 'user',
      password: 'pass',
      fileIds: [11, 12],
      changelog: 'manual changelog'
    }, reportProgress);

    expect(result).toEqual({
      acpId: 'acp-1',
      total: 2,
      replaced: 1,
      skipped: 1,
      failed: 0,
      replacedFiles: [{ fileId: 11, filename: 'unit.xml' }],
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
    expect(httpService.axiosRef.delete).toHaveBeenCalledWith(
      'http://content-pool.test/api/acp/acp-1/files/target-file-1',
      expect.anything()
    );
    expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
      2,
      'http://content-pool.test/api/acp/acp-1/files/upload',
      expect.anything(),
      expect.objectContaining({ maxBodyLength: Infinity })
    );
    expect(httpService.axiosRef.post).toHaveBeenNthCalledWith(
      3,
      'http://content-pool.test/api/acp/acp-1/snapshots',
      { changelog: 'manual changelog' },
      expect.anything()
    );
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'replacing-files',
      processedFiles: 2,
      totalFiles: 2,
      progress: 90
    }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'creating-snapshot',
      progress: 94
    }));
  });
});
