import {
  BadRequestException, ExecutionContext, INestApplication, Logger
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CodingJobController } from '../admin/coding-job/coding-job.controller';
import { VariableAnalysisController } from '../admin/variable-analysis/variable-analysis.controller';
import { CodingJobService } from '../database/services/coding/coding-job.service';
import { VariableAnalysisService } from '../database/services/test-results/variable-analysis.service';
import { AuthService } from '../auth/service/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

describe('Domain errors at the HTTP boundary', () => {
  let app: INestApplication;
  let url: string;
  const codingService = { updateCodingJob: jest.fn() };
  const jobQueueService = {
    getVariableAnalysisJob: jest.fn(async () => ({ data: { workspaceId: 47 }, getState: async () => 'active' }))
  };
  const analysisService = new VariableAnalysisService(
    jobQueueService as never,
    { get: jest.fn(async () => null) } as never
  );
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CodingJobController, VariableAnalysisController],
      providers: [
        { provide: CodingJobService, useValue: codingService },
        { provide: VariableAnalysisService, useValue: analysisService },
        { provide: AuthService, useValue: { canAccessWorkSpace: async () => true } }
      ]
    }).useMocker(() => ({})).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = { id: 7 };
        return true;
      }
    })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  it('returns 400 for a status transition after results have been applied', async () => {
    codingService.updateCodingJob.mockRejectedValueOnce(new BadRequestException('Coding results have already been applied'));
    const res = await fetch(`${url}/api/admin/workspace/47/coding-job/23`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' })
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('already been applied');
    expect(codingService.updateCodingJob).toHaveBeenCalledWith(23, 47, { status: 'active' }, 7);
  });
  it('returns 400 for results of an unfinished analysis', async () => {
    const res = await fetch(`${url}/api/admin/workspace/47/variable-analysis/jobs/12/results`);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('is not completed');
  });
  it.each(['results', 'results/page', 'results/export/csv', 'results/export/xlsx'])(
    'returns 400 for expired analysis results through %s', async endpoint => {
      jobQueueService.getVariableAnalysisJob.mockResolvedValueOnce({
        data: { workspaceId: 47, cacheKey: 'variable-analysis:47:12', resultVersion: 2 },
        getState: async () => 'completed'
      } as never);
      const res = await fetch(`${url}/api/admin/workspace/47/variable-analysis/jobs/12/${endpoint}`);
      expect(res.status).toBe(400);
      expect((await res.json()).message).toContain('has no cached results');
    }
  );
  it('returns a recognizable error for analysis results that need recalculation', async () => {
    jobQueueService.getVariableAnalysisJob.mockResolvedValueOnce({
      data: { workspaceId: 47, cacheKey: 'variable-analysis:47:12' },
      getState: async () => 'completed'
    } as never);
    const res = await fetch(`${url}/api/admin/workspace/47/variable-analysis/jobs/12/results/page`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VARIABLE_ANALYSIS_OUTDATED' });
  });
  it('keeps unexpected failures as a safe 500 response', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    codingService.updateCodingJob.mockRejectedValueOnce(new Error('Internal database detail'));
    try {
      const res = await fetch(`${url}/api/admin/workspace/47/coding-job/23`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(500);
      expect((await res.json()).message).toBe('Internal server error');
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
