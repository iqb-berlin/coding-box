import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { WorkspaceController } from '../admin/workspace/workspace.controller';
import { WorkspaceCodingExportController } from '../admin/workspace/workspace-coding-export.controller';
import { JobQueueService } from '../job-queue/job-queue.service';
import { WorkspaceCodingCodebookController } from '../admin/workspace/workspace-coding-codebook.controller';
import { WorkspaceSettingsController } from '../workspace/workspace-settings.controller';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { WorkspaceCoreService } from '../database/services/workspace/workspace-core.service';
import { CacheService } from '../cache/cache.service';
import { AdminGuard } from '../admin/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';
import { createRequestValidationPipe } from './request-validation';

describe('Workspace request contracts over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let log: jest.SpyInstance;
  const repository = {
    findOne: jest.fn().mockResolvedValue({ id: 47, name: 'Original' }),
    save: jest.fn(async value => value)
  };

  beforeAll(async () => {
    const settings = new WorkspaceSettingsService({
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 0 })
    } as never);
    const core = new WorkspaceCoreService(repository as never, {} as never, {
      delete: jest.fn()
    } as never, {} as never);
    const builder = Test.createTestingModule({
      controllers: [WorkspaceController, WorkspaceSettingsController, WorkspaceCodingCodebookController, WorkspaceCodingExportController],
      providers: [
        { provide: JobQueueService, useValue: { getExportJob: jest.fn().mockRejectedValue(new Error('EACCES: /srv/private/export.zip')) } },
        { provide: WorkspaceSettingsService, useValue: settings },
        { provide: WorkspaceCoreService, useValue: core },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockRejectedValue(new Error('EACCES: /srv/private/codebook.docx'))
          }
        }
      ]
    }).useMocker(() => ({}));
    [AdminGuard, JwtAuthGuard, WorkspaceGuard, AccessLevelGuard].forEach(guard => {
      builder.overrideGuard(guard).useValue({ canActivate: () => true });
    });
    const module = await builder.compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => { await app.close(); log.mockRestore(); });

  it.each([{}, { name: 'Updated' }, { id: 0 }, { id: 1.5 }])('rejects invalid workspace IDs before persistence: %j', async payload => {
    repository.save.mockClear();
    const response = await fetch(`${baseUrl}/api/admin/workspace`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    expect(response.status).toBe(400);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('persists a partial workspace update with its ID', async () => {
    const response = await fetch(`${baseUrl}/api/admin/workspace`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 47, name: 'Updated' })
    });
    expect(response.status).toBe(200);
    expect(repository.save).toHaveBeenCalledWith({ id: 47, name: 'Updated' });
  });

  it.each(['PUT', 'DELETE'])('returns 404 for missing settings with %s', async method => {
    const response = await fetch(`${baseUrl}/api/workspace/47/settings/workspace-47-missing`, {
      method, ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: '{}' }) } : {})
    });
    expect(response.status).toBe(404);
  });

  it('sanitizes download errors through the global filter', async () => {
    const response = await fetch(`${baseUrl}/api/admin/workspace/47/coding/codebook/job/probe/download`);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe('Internal server error');
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/EACCES|\/srv\/private/);
  });

  it.each([
    ['GET', '/coding/export/job/probe'],
    ['GET', '/coding/export/job/probe/download'],
    ['DELETE', '/coding/export/job/probe'],
    ['POST', '/coding/export/job/probe/cancel']
  ])('sanitizes unexpected export errors with %s %s', async (method, path) => {
    const response = await fetch(`${baseUrl}/api/admin/workspace/47${path}`, { method });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toMatch(/EACCES|\/srv\/private/);
  });

  it('documents the same required ID and bounds as runtime validation', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const body = document.paths['/api/admin/workspace'].patch?.requestBody;
    if (!body || '$ref' in body) throw new Error('Missing workspace request schema');
    const schema = body.content['application/json'].schema as SchemaObject;
    expect(schema.required).toContain('id');
    expect(schema.required).not.toContain('name');
    expect(schema.properties?.id).toEqual({ type: 'integer', minimum: 1 });
  });
});
