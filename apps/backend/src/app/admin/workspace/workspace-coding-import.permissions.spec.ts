import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { WorkspaceCodingImportController } from './workspace-coding-import.controller';
import { ExternalCodingImportService } from '../../database/services/coding/external-coding-import.service';
import { JobQueueService, ExternalCodingImportJobData } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { UsersService } from '../../database/services/users/users.service';
import { AuthService } from '../../auth/service/auth.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

describe('External coding import HTTP permissions', () => {
  let app: INestApplication;
  let origin: string;
  const queuedFiles: string[] = [];
  const preview = {
    message: 'preview', processedRows: 1, updatedRows: 1, errors: [], affectedRows: []
  };
  const service = {
    importExternalCoding: jest.fn(async () => preview),
    importExternalCodingWithProgress: jest.fn(async () => preview)
  };
  const queue = {
    assertNoDependencyConflicts: jest.fn(async () => undefined),
    addExternalCodingImportJob: jest.fn(async (data: ExternalCodingImportJobData) => {
      queuedFiles.push(data.tempFilePath);
      return { id: 'permission-test' };
    })
  };
  const body = { file: Buffer.from('unit_key,variable_id,code\nUNIT,VAR,1\n').toString('base64'), fileName: 'permission-test.csv' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkspaceCodingImportController],
      providers: [
        { provide: ExternalCodingImportService, useValue: service },
        { provide: JobQueueService, useValue: queue },
        { provide: CacheService, useValue: {} },
        { provide: AuthService, useValue: { canAccessWorkSpace: async () => true } },
        {
          provide: UsersService,
          useValue: {
            getUserIsAdmin: async (id: number) => id === 4,
            getUserAccessLevel: async (id: number, workspaceId: number) => (workspaceId === 17 ? id : null)
          }
        }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest();
        request.user = { id: Number(request.headers['x-test-user-id']) };
        return true;
      }
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterEach(() => {
    for (const file of queuedFiles.splice(0)) fs.unlinkSync(file);
    jest.clearAllMocks();
  });

  afterAll(async () => app?.close());

  function post(userId: number, suffix: string, payload: object) {
    return fetch(`${origin}/admin/workspace/17/coding/external-coding-import${suffix}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user-id': String(userId) },
      body: JSON.stringify(payload)
    });
  }

  it.each([1, 2])('rejects apply at Level %s before creating a file or job', async userId => {
    const response = await post(userId, '/apply', { ...body, requestedByUserId: 4 });
    expect(response.status).toBe(401);
    expect(queue.assertNoDependencyConflicts).not.toHaveBeenCalled();
    expect(queue.addExternalCodingImportJob).not.toHaveBeenCalled();
    expect(queuedFiles).toHaveLength(0);
  });

  it.each([3, 4])('accepts apply for study managers and admins and binds the authenticated actor %s', async userId => {
    const response = await post(userId, '/apply', { ...body, requestedByUserId: 99 });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: 'permission-test' });
    expect(queue.addExternalCodingImportJob).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 17, requestedByUserId: userId
    }));
    expect(fs.readFileSync(queuedFiles[0]).toString()).toContain('UNIT,VAR,1');
  });

  it('retains the Level-2 synchronous preview without queuing an import', async () => {
    const response = await post(2, '', { ...body, previewOnly: true });
    expect(response.status).toBe(201);
    expect(service.importExternalCoding).toHaveBeenCalledWith(17, expect.objectContaining({ previewOnly: true }));
    expect(queue.addExternalCodingImportJob).not.toHaveBeenCalled();
  });

  it('retains the Level-2 streaming preview without queuing an import', async () => {
    const response = await post(2, '/stream', body);
    expect(response.status).toBe(201);
    expect(await response.text()).toContain('"message":"preview"');
    expect(service.importExternalCodingWithProgress).toHaveBeenCalledWith(17, expect.objectContaining({ previewOnly: true }), expect.any(Function));
    expect(queue.addExternalCodingImportJob).not.toHaveBeenCalled();
  });

  it.each(['', '/stream'])('prevents Level 2 from writing through preview endpoint %s', async suffix => {
    const response = await post(2, suffix, { ...body, previewOnly: false });
    expect(response.status).toBe(400);
    expect(service.importExternalCoding).not.toHaveBeenCalled();
    expect(service.importExternalCodingWithProgress).not.toHaveBeenCalled();
    expect(queue.addExternalCodingImportJob).not.toHaveBeenCalled();
  });
});
