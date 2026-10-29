import { ExecutionContext, INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { Setting } from '../database/entities/setting.entity';
import { WorkspaceFilesController } from '../admin/workspace/workspace-files.controller';
import { WorkspaceFilesService } from '../database/services/workspace/workspace-files.service';
import { WorkspaceCoreService } from '../database/services/workspace/workspace-core.service';
import { PersonService } from '../database/services/test-results/person.service';
import { CodingStatisticsService } from '../database/services/coding/coding-statistics.service';
import { CodingValidationService } from '../database/services/coding/coding-validation.service';
import { UsersService } from '../database/services/users';
import { AuthService } from '../auth/service/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

describe('Workspace multipart uploads', () => {
  let app: INestApplication;
  let url: string;
  const filesService = {
    uploadTestFiles: jest.fn(async () => ({
      total: 1, uploaded: 1, failed: 0, failedFiles: []
    }))
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkspaceFilesController],
      providers: [
        WorkspaceSettingsService,
        { provide: WorkspaceFilesService, useValue: filesService },
        { provide: WorkspaceCoreService, useValue: {} },
        { provide: getRepositoryToken(Setting), useValue: {} },
        { provide: PersonService, useValue: {} },
        { provide: CodingStatisticsService, useValue: {} },
        { provide: CodingValidationService, useValue: {} },
        { provide: AuthService, useValue: { canAccessWorkSpace: async () => true } },
        {
          provide: UsersService,
          useValue: {
            getUserIsAdmin: async () => false,
            getUserAccessLevel: async () => 3
          }
        }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = { id: 7 };
        return true;
      }
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/workspace/47/upload`;
  });

  afterAll(async () => app?.close());

  it('returns a safe 500 for unexpected upload failures', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = new Error('Database private detail');
    filesService.uploadTestFiles.mockRejectedValueOnce(error);
    const body = new FormData();
    body.append('files', new Blob(['<Unit/>'], { type: 'application/xml' }), 'unit.xml');
    try {
      const response = await fetch(url, { method: 'POST', body });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ message: 'Internal server error' });
      expect(log).toHaveBeenCalledWith(expect.any(String), error.stack);
    } finally {
      log.mockRestore();
      filesService.uploadTestFiles.mockClear();
    }
  });

  it('rejects crafted field names without terminating the API and still accepts a valid upload', async () => {
    // Regression payload from GHSA-wc9g-mqfw-jrwm (maximum JavaScript array index).
    const crafted = new FormData();
    crafted.append('items[4294967294]', 'x');
    crafted.append('items[]', 'y');
    const rejected = await fetch(url, { method: 'POST', body: crafted });
    expect(rejected.status).toBe(400);
    // Nest 11.2.8 maps Multer's error code before the global filter sees it.
    expect(await rejected.json()).toMatchObject({ statusCode: 400, message: expect.stringMatching(/^Invalid field name/) });
    expect(filesService.uploadTestFiles).not.toHaveBeenCalled();

    const valid = new FormData();
    valid.append('files', new Blob(['<Unit/>'], { type: 'application/xml' }), 'unit.xml');
    const accepted = await fetch(url, { method: 'POST', body: valid });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({ uploaded: 1, failed: 0 });
    expect(filesService.uploadTestFiles).toHaveBeenCalledWith(
      '47',
      [expect.objectContaining({ originalname: 'unit.xml', buffer: Buffer.from('<Unit/>') })],
      false,
      undefined
    );
  });
});
