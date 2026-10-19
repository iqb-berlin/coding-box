import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceFilesInfoController } from '../admin/workspace/workspace-files-info.controller';
import { CodingReplayAnchorService } from '../database/services/coding/coding-replay-anchor.service';
import { Setting } from '../database/entities/setting.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

describe('Replay anchor validation over HTTP', () => {
  let app: INestApplication;
  let url: string;
  const repository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(value => value),
    save: jest.fn(async value => value)
  };
  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers: [WorkspaceFilesInfoController],
      providers: [CodingReplayAnchorService, { provide: getRepositoryToken(Setting), useValue: repository }]
    }).useMocker(() => ({}));
    [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard].forEach(guard => {
      builder.overrideGuard(guard).useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { id: 7 };
          return true;
        }
      });
    });
    const module = await builder.compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/workspace/7/files/replay-anchor-overrides`;
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it.each(['unitName', 'variableId', 'replayAnchor'])('returns 400 for empty and whitespace %s without writes', async key => {
    for (const value of ['', '  ', '\t\n']) {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'ANCHOR', [key]: value
        })
      });
      expect(response.status).toBe(400);
      expect(repository.save).not.toHaveBeenCalled();
    }
  });
  it('normalizes and persists a valid override', async () => {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitName: ' UNIT ', variableId: ' VAR ', replayAnchor: ' ANCHOR ' })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'ANCHOR' });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      key: 'workspace-7-replay-anchor-overrides',
      content: JSON.stringify([{ unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'ANCHOR' }])
    }));
  });
});
