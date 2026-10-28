import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CodingStatisticsService } from '../database/services/coding/coding-statistics.service';
import { WorkspaceCodingStatisticsController } from '../admin/workspace/workspace-coding-statistics.controller';
import { CodingStatisticsProcessor } from '../job-queue/processors/coding-statistics.processor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

describe('Statistics failure contracts', () => {
  let app: INestApplication;
  let baseUrl: string;
  let log: jest.SpyInstance;
  const repository = { query: jest.fn() };
  const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
  const queue = { getWorkspaceJob: jest.fn() };
  const files = {
    getUnitVariableMap: jest.fn().mockResolvedValue(new Map([['UNIT', new Set(['V'])]])),
    getDerivedVariableMap: jest.fn().mockResolvedValue(new Map())
  };
  const statistics = new CodingStatisticsService(
    repository as never,
    cache as never,
    queue as never,
    {} as never,
    {} as never,
    { resolveExclusionsForQueries: async () => ({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }) } as never,
    files as never
  );

  beforeAll(async () => {
    jest.spyOn(statistics, 'onApplicationBootstrap').mockResolvedValue(undefined);
    const builder = Test.createTestingModule({
      controllers: [WorkspaceCodingStatisticsController], providers: [{ provide: CodingStatisticsService, useValue: statistics }]
    }).useMocker(() => ({}));
    [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard].forEach(guard => builder.overrideGuard(guard).useValue({ canActivate: () => true }));
    const module = await builder.compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/api/admin/workspace/47/coding/statistics`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repository.query.mockResolvedValue([]);
    queue.getWorkspaceJob.mockResolvedValue(null);
    cache.set.mockResolvedValue(true);
  });

  afterAll(async () => { await app.close(); log.mockRestore(); });

  it('returns 500 rather than zero statistics on a query failure', async () => {
    repository.query.mockRejectedValueOnce(new Error('private SQL connection details'));
    const response = await fetch(baseUrl);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ message: 'Internal server error' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('still returns valid empty statistics when the query succeeds', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalResponses: 0, statusCounts: {} });
  });

  it('returns computed data when a best-effort cache write returns false', async () => {
    repository.query.mockResolvedValue([{ statusValue: 5, isDerived: false, count: '3' }]);
    cache.set.mockResolvedValue(false);
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalResponses: 3, statusCounts: { 5: 3 } });
  });

  it('returns 404 for a missing or foreign job', async () => {
    expect((await fetch(`${baseUrl}/job/missing`)).status).toBe(404);
  });

  it('returns 500 for a queue outage instead of pretending the job is missing', async () => {
    queue.getWorkspaceJob.mockRejectedValueOnce(new Error('private Redis connection details'));
    const response = await fetch(`${baseUrl}/job/probe`);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private Redis');
  });

  it.each(['v4', 'invalid', 'v1&version=v2'])('rejects unsupported query versions: %s', async version => {
    expect((await fetch(`${baseUrl}?version=${version}`)).status).toBe(400);
    expect(repository.query).not.toHaveBeenCalled();
    expect((await fetch(`${baseUrl}/job?version=${version}`, { method: 'POST' })).status).toBe(400);
  });

  it('fails the worker without reporting 100 percent after a calculation error', async () => {
    const failure = new Error('query failed');
    repository.query.mockRejectedValueOnce(failure);
    const job = { id: 'probe', data: { workspaceId: 47 }, updateProgress: jest.fn() };
    await expect(new CodingStatisticsProcessor(statistics).processWorkspaceJob(job as never)).rejects.toBe(failure);
    expect(job.updateProgress).toHaveBeenCalledWith(0);
    expect(job.updateProgress).not.toHaveBeenCalledWith(100);
  });
});
