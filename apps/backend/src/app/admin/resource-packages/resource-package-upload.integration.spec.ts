import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import { ResourcePackageController } from './resource-package.controller';
import { ResourcePackageService } from '../../database/services/workspace/resource-package.service';
import { RESOURCE_PACKAGE_LIMITS } from '../../database/services/workspace/resource-package-limits';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';
import { AccessLevelGuard } from '../workspace/access-level.guard';
import { GlobalHttpExceptionFilter } from '../../http/global-http-exception.filter';

// Keep the real multipart parser, controller and exception handling; avoid large test buffers.
jest.mock('../../database/services/workspace/resource-package-limits', () => ({
  RESOURCE_PACKAGE_LIMITS: {
    ...jest.requireActual('../../database/services/workspace/resource-package-limits').RESOURCE_PACKAGE_LIMITS,
    maxArchiveBytes: 1024
  }
}));

describe('Resource package multipart upload over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const packages = {
    create: jest.fn().mockResolvedValue(42),
    getZippedResourcePackage: jest.fn()
  };

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers: [ResourcePackageController],
      providers: [{ provide: ResourcePackageService, useValue: packages }]
    }).useMocker(() => ({}));
    [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard].forEach(guard => {
      builder.overrideGuard(guard).useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { id: 1 };
          return true;
        }
      });
    });
    app = (await builder.compile()).createNestApplication();
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => { packages.create.mockClear(); });

  async function upload(size: number, extraField = false) {
    const form = new FormData();
    form.append('resourcePackage', new Blob([new Uint8Array(size)], { type: 'application/zip' }), 'Example.itcr.zip');
    if (extraField) form.append('unexpected', 'value');
    return fetch(`${baseUrl}/admin/workspace/7/resource-packages`, { method: 'POST', body: form });
  }

  it('passes an ordinary single-file upload to the service unchanged', async () => {
    const response = await upload(32);
    expect(response.status).toBe(201);
    expect(await response.json()).toBe(42);
    expect(packages.create).toHaveBeenCalledWith(7, expect.objectContaining({
      originalname: 'Example.itcr.zip', buffer: Buffer.alloc(32), size: 32
    }));
  });

  it('returns 413 before the service receives an oversized multipart upload', async () => {
    const response = await upload(RESOURCE_PACKAGE_LIMITS.maxArchiveBytes + 1);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ statusCode: 413 });
    expect(packages.create).not.toHaveBeenCalled();
  });

  it('rejects unexpected multipart fields before calling the service', async () => {
    const response = await upload(32, true);
    expect(response.status).toBe(400);
    expect(packages.create).not.toHaveBeenCalled();
  });

  it('streams ZIP downloads without changing the response bytes or content type', async () => {
    const bytes = Buffer.from([0, 1, 255, 128]);
    packages.getZippedResourcePackage.mockResolvedValueOnce(Readable.from([bytes]));
    const response = await fetch(`${baseUrl}/admin/workspace/7/resource-packages/Example`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});
