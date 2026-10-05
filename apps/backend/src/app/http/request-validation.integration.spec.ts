import {
  BadRequestException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
  Query
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { CodingJobController } from '../admin/coding-job/coding-job.controller';
import { VariableBundleController } from '../admin/variable-bundle/variable-bundle.controller';
import { UsersController } from '../admin/users/users.controller';
import { WorkspaceCodingStatisticsController } from '../admin/workspace/workspace-coding-statistics.controller';
import { WorkspaceTestCenterController } from '../admin/workspace/workspace-test-center.controller';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';
import { DistributionPreviewLimiterService } from '../admin/workspace-coding/distribution-preview-limiter.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { CodingJobService, VariableBundleService } from '../database/services/coding';
import { UsersService } from '../database/services/users';
import { TestcenterService } from '../database/services/test-results';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

const readQuery = jest.fn((threshold: unknown, enabled: unknown) => ({ threshold, enabled }));

@Controller('validation-probe')
class PrimitiveQueryController {
  @Get()
  read(@Query('threshold') threshold: number, @Query('enabled') enabled: boolean) {
    return readQuery(threshold, enabled);
  }
}

describe('HTTP request validation and exception handling', () => {
  let app: INestApplication;
  let baseUrl: string;
  const codingJobs = {
    createCodingJob: jest.fn(),
    createDistributedCodingJobs: jest.fn(),
    calculateDistribution: jest.fn()
  };
  const bundles = { createVariableBundle: jest.fn() };
  const users = { updateUsersAccess: jest.fn() };
  const testcenter = { getTestgroups: jest.fn() };
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CodingJobController,
        VariableBundleController,
        UsersController,
        PrimitiveQueryController,
        WorkspaceCodingStatisticsController,
        WorkspaceTestCenterController
      ],
      providers: [
        { provide: CodingJobService, useValue: codingJobs },
        { provide: VariableBundleService, useValue: bundles },
        { provide: UsersService, useValue: users },
        { provide: TestcenterService, useValue: testcenter },
        {
          provide: DistributionPreviewLimiterService,
          useValue: { run: (callback: () => Promise<unknown>) => callback() }
        }
      ]
    })
      .useMocker(() => ({}))
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { id: 7 };
          return true;
        }
      })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AccessLevelGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(json({ limit: '1kb' }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    codingJobs.createCodingJob.mockResolvedValue({ id: 124 });
    codingJobs.createDistributedCodingJobs.mockResolvedValue({ success: true, jobsCreated: 1, jobs: [] });
    codingJobs.calculateDistribution.mockResolvedValue({ distribution: {} });
    bundles.createVariableBundle.mockResolvedValue({ id: 12, variables: [] });
    users.updateUsersAccess.mockResolvedValue(true);
  });

  afterAll(async () => {
    logError?.mockRestore();
    await app?.close();
  });

  function post(route: string, payload: unknown, method = 'POST'): Promise<Response> {
    return fetch(`${baseUrl}/api/${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  it.each([
    { name: 123, assignedCoders: 'not-an-array', showScore: 'yes' },
    { name: 'Job', assignedCoders: ['7'] },
    { name: 'Job', variables: [{ unitName: 'U1', variableId: 12 }] },
    { name: 'Job', status: 'unrecognized' }
  ])('rejects malformed coding job DTOs before invoking the service: %j', async payload => {
    const response = await post('admin/workspace/47/coding-job', payload);
    expect(response.status).toBe(400);
    expect(codingJobs.createCodingJob).not.toHaveBeenCalled();
  });

  it('retains valid payloads', async () => {
    const payload = {
      name: 'Job',
      assignedCoders: [7],
      showScore: false,
      variables: [{ unitName: 'U1', variableId: 'V1' }]
    };
    const response = await post('admin/workspace/47/coding-job', payload);
    expect(response.status).toBe(201);
    expect(codingJobs.createCodingJob).toHaveBeenCalledWith(47, payload);
  });

  function distributionPayload(maxCodingCases: unknown) {
    return {
      selectedVariables: [{ unitName: 'U1', variableId: 'V1' }],
      selectedCoders: [{ id: 7, name: 'Coder', username: 'coder' }],
      doubleCodingAbsolute: 0,
      doubleCodingPercentage: 0,
      caseOrderingMode: 'continuous',
      maxCodingCases
    };
  }

  it.each([null, 100, undefined])('creates distributed jobs with the frontend case limit %j', async maxCodingCases => {
    const payload = distributionPayload(maxCodingCases);
    const response = await post('admin/workspace/47/coding/create-distributed-jobs', payload);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, jobsCreated: 1, jobs: [] });
    expect(codingJobs.createDistributedCodingJobs).toHaveBeenCalledWith(
      47, JSON.parse(JSON.stringify(payload))
    );
  });

  it.each([null, 100, undefined])('previews distribution with case limit %j', async maxCodingCases => {
    const payload = distributionPayload(maxCodingCases);
    const response = await post('admin/workspace/47/coding/calculate-distribution', payload);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ distribution: {} });
    expect(codingJobs.calculateDistribution).toHaveBeenCalledWith(47, JSON.parse(JSON.stringify(payload)));
  });

  it.each(['100', {}])('rejects malformed case limits before creating jobs: %j', async maxCodingCases => {
    const response = await post('admin/workspace/47/coding/create-distributed-jobs', distributionPayload(maxCodingCases));
    expect(response.status).toBe(400);
    expect(codingJobs.createDistributedCodingJobs).not.toHaveBeenCalled();
  });

  it('omits Testcenter query credentials from logs when group retrieval fails', async () => {
    const token = 'synthetic-testcenter-token';
    const error = new Error('Testcenter unavailable');
    testcenter.getTestgroups.mockRejectedValue(error);
    const query = new URLSearchParams({
      tc_workspace: '1', server: '', url: encodeURIComponent('https://example.invalid'), token
    });
    const response = await fetch(`${baseUrl}/api/admin/workspace/47/importWorkspaceFiles/testGroups?${query}`);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(testcenter.getTestgroups).toHaveBeenCalledWith('47', '1', '', 'https://example.invalid', token, undefined);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(`[${body.requestId}] GET /api/admin/workspace/47/importWorkspaceFiles/testGroups failed with 500`),
      error.stack
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(token);
  });

  it('rejects a missing DTO body before invoking the service', async () => {
    const response = await post('admin/workspace/47/coding-job', undefined);
    expect(response.status).toBe(400);
    expect(codingJobs.createCodingJob).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON without exposing its contents', async () => {
    const response = await fetch(`${baseUrl}/api/admin/workspace/47/coding-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": private-request-value}'
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('private-request-value');
    expect(codingJobs.createCodingJob).not.toHaveBeenCalled();
  });

  it('returns 413 for oversized bodies before invoking the service', async () => {
    const response = await post('admin/workspace/47/coding-job', { name: 'x'.repeat(2048) });
    expect(response.status).toBe(413);
    expect(codingJobs.createCodingJob).not.toHaveBeenCalled();
  });

  it('rejects malformed nested variables in bundles', async () => {
    const response = await post('admin/workspace/47/variable-bundle', {
      name: 'Bundle', variables: [{ unitName: 'U1', variableId: 12 }]
    });
    expect(response.status).toBe(400);
    expect(bundles.createVariableBundle).not.toHaveBeenCalled();
  });

  it.each([
    { id: 5, accessLevel: 1 },
    [{ id: '5', accessLevel: 1 }],
    [{ id: 5, accessLevel: 1, canCode: 'true' }],
    [{ id: 5 }]
  ].map(payload => [payload]))('validates array request elements before persisting access: %j', async payload => {
    const response = await post('admin/users/access/47', payload, 'PATCH');
    expect(response.status).toBe(400);
    expect(users.updateUsersAccess).not.toHaveBeenCalled();
  });

  it('accepts the existing minimal user-access write contract', async () => {
    const payload = [{ id: 5, accessLevel: 1, canCode: false }];
    const response = await post('admin/users/access/47', payload, 'PATCH');
    expect(response.status).toBe(200);
    expect(users.updateUsersAccess).toHaveBeenCalledWith(47, payload);
  });

  it.each([
    'threshold=NaN&enabled=false',
    'threshold=1&threshold=2&enabled=false',
    'threshold=0.85&enabled=wrong',
    'threshold=0.85&enabled=true&enabled=false'
  ])('rejects malformed query parameters before invoking a handler: %s', async query => {
    const response = await fetch(`${baseUrl}/api/validation-probe?${query}`);
    expect(response.status).toBe(400);
    expect(readQuery).not.toHaveBeenCalled();
  });

  it('retains valid scalar query values for the existing conversions', async () => {
    const response = await fetch(`${baseUrl}/api/validation-probe?threshold=0.85&enabled=false`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ threshold: '0.85', enabled: 'false' });
  });

  it('rejects fractional path IDs before user-access updates', async () => {
    const response = await post('admin/users/access/47.5', [{ id: 5, accessLevel: 1 }], 'PATCH');
    expect(response.status).toBe(400);
    expect(users.updateUsersAccess).not.toHaveBeenCalled();
  });

  it.each([
    [new BadRequestException('Invalid assignment'), 400],
    [new ForbiddenException('Ownership denied'), 403],
    [new NotFoundException('Workspace not found'), 404]
  ])('preserves service HTTP exceptions (%s)', async (error, status) => {
    codingJobs.createCodingJob.mockRejectedValue(error);
    const response = await post('admin/workspace/47/coding-job', { name: 'Job' });
    expect(response.status).toBe(status);
    expect((await response.json()).message).toBe(error.message);
  });

  it('returns a sanitized 500 and logs the original server failure with a request ID', async () => {
    const error = new Error('Database password=synthetic-private-detail');
    codingJobs.createCodingJob.mockRejectedValue(error);
    const response = await post('admin/workspace/47/coding-job', { name: 'Job' });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('synthetic-private-detail');
    expect(body.requestId).toBeTruthy();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining(`[${body.requestId}]`), error.stack);
  });
});
