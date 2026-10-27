import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { JwtStrategy } from './jwt.strategy';
import { WorkspaceTokenStrategy } from './workspace-token.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtOrWorkspaceTokenAuthGuard } from './jwt-or-workspace-token-auth.guard';
import { AuthService } from './service/auth.service';
import {
  WORKSPACE_TOKEN_SCOPE_REPLAY_READ as R,
  WORKSPACE_TOKEN_SCOPE_REPLAY_STATISTICS_WRITE as S,
  WORKSPACE_TOKEN_SCOPE_CODING_JOB_OPERATE as C,
  WorkspaceTokenScope
} from './workspace-token';
import { WORKSPACE_TOKEN_AUDIENCE, WORKSPACE_TOKEN_ISSUER } from './workspace-token.constants';
import { UsersService } from '../database/services/users';
import { JournalService } from '../database/services/shared/journal.service';
import { CodingJobService, CodingReplayService } from '../database/services/coding';
import { CodingJobAccessService } from '../database/services/coding/coding-job-access.service';
import { ReplayStatisticsService } from '../database/services/test-results';
import { UnitInfoService } from '../database/services/workspace';
import { WorkspaceUsersService } from '../database/services/workspace/workspace-users.service';
import { WsgCodingJobController } from '../wsg-admin/coding-job/coding-job.controller';
import { WorkspaceUsersController } from '../admin/workspace/workspace-users.controller';
import { ReplayStatisticsController } from '../admin/replay-statistics/replay-statistics.controller';
import { UnitInfoController } from '../admin/workspace/unit-info.controller';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { AccessLevelGuard } from '../admin/workspace/access-level.guard';

// Real controllers, Passport strategies, authorization guards and job-access rules;
// only repositories/domain writes are replaced. No application DB/provider is used.
describe('Workspace token permissions over HTTP (#569)', () => {
  const secret = 'isolated-workspace-permissions-test-key';
  const issuer = 'https://oidc.example.test';
  const jwt = new JwtService({ secret });
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = {
    ...key.publicKey.export({ format: 'jwk' }), kid: 'oidc', alg: 'RS256', use: 'sig'
  };
  const infoPath = '/admin/workspace/7/unit/UNIT-1/info';
  const statsPath = '/admin/workspace/7/replay-statistics';
  const jobPath = '/wsg-admin/workspace/7/coding-job/11';
  const ownTokenPath = '/admin/workspace/7/token/1?scopes=replay:read';
  const codingBody = { testPerson: 'synthetic@person@booklet', unitId: 'UNIT-1', variableId: 'v1' };
  const entity = {
    id: 11, workspace_id: 7, name: 'Synthetic job', status: 'active'
  };
  const users = {
    createOidcProviderUser: jest.fn(),
    findUserById: jest.fn(),
    findUserByIdentity: jest.fn(),
    canAccessWorkSpace: jest.fn(),
    getUserIsAdmin: jest.fn(),
    getUserAccessLevel: jest.fn(),
    canUserCodeInWorkspace: jest.fn()
  };
  const jobRepository = { findOne: jest.fn() };
  const assignmentRepository = { count: jest.fn() };
  const jobAccess = new CodingJobAccessService(
    jobRepository as never, assignmentRepository as never, {} as never, users as never
  );
  const jobs = {
    assertUserCanAccessCodingJob: jest.fn(),
    assertUserCanCodeCodingJob: jest.fn(),
    getCodingJob: jest.fn(),
    getCodingProgress: jest.fn(),
    updateCodingJob: jest.fn(),
    saveCodingProgress: jest.fn(),
    saveCodingNotes: jest.fn(),
    saveCodingIssueReviewProgress: jest.fn(),
    saveCodingIssueReviewNotes: jest.fn(),
    pauseCodingJob: jest.fn(),
    resumeCodingJob: jest.fn(),
    submitCodingJob: jest.fn()
  };
  const journal = { recordEvent: jest.fn() };
  const unitInfo = { getUnitInfo: jest.fn() };
  const statistics = { storeReplayStatistics: jest.fn(), getReplayStatistics: jest.fn() };
  const workspaceUsers = { findUsers: jest.fn() };
  let app: INestApplication;
  let jwks: Server;
  let baseUrl: string;

  const workspaceToken = (scopes: WorkspaceTokenScope[] | undefined, legacy = false) => jwt.sign({
    userId: 42,
    username: 'synthetic-token-user',
    workspace: 7,
    ...(legacy ? {} : { token_use: 'workspace', tokenType: 'workspace-api' }),
    ...(scopes === undefined ? {} : { scopes })
  }, {
    algorithm: 'HS256',
    expiresIn: 3600,
    ...(legacy ? {} : { issuer: WORKSPACE_TOKEN_ISSUER, audience: WORKSPACE_TOKEN_AUDIENCE })
  });
  const oidcToken = () => new JwtService().sign({ sub: 'synthetic-user', azp: 'coding-box' }, {
    privateKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    algorithm: 'RS256',
    keyid: 'oidc',
    issuer,
    expiresIn: 300
  });

  async function createApp(legacy = true) {
    const config = new ConfigService({
      OIDC_ISSUER: issuer,
      OIDC_JWKS_URI: `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/certs`,
      OAUTH2_CLIENT_ID: 'coding-box',
      JWT_SECRET: secret,
      ALLOW_LEGACY_WORKSPACE_REPLAY_TOKENS: legacy
    });
    const module = await Test.createTestingModule({
      controllers: [WsgCodingJobController, WorkspaceUsersController, ReplayStatisticsController, UnitInfoController],
      providers: [
        JwtStrategy, WorkspaceTokenStrategy, JwtAuthGuard, JwtOrWorkspaceTokenAuthGuard,
        WorkspaceGuard, AccessLevelGuard, AuthService,
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwt },
        { provide: UsersService, useValue: users },
        { provide: JournalService, useValue: journal },
        { provide: CodingJobService, useValue: jobs },
        { provide: CodingReplayService, useValue: {} },
        { provide: WorkspaceUsersService, useValue: workspaceUsers },
        { provide: ReplayStatisticsService, useValue: statistics },
        { provide: UnitInfoService, useValue: unitInfo }
      ]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  }

  const request = (method: string, path: string, token: string, body?: object) => fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  beforeAll(async () => {
    jwks = createServer((_req, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicKey] }));
    });
    await new Promise<void>(resolve => { jwks.listen(0, '127.0.0.1', resolve); });
    await createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    users.createOidcProviderUser.mockResolvedValue(42);
    users.findUserById.mockResolvedValue({ id: 42, username: 'synthetic-token-user' });
    users.findUserByIdentity.mockResolvedValue({ id: 43, username: 'synthetic-other-user' });
    users.canAccessWorkSpace.mockImplementation((_user: number, workspace: number) => Promise.resolve(workspace === 7));
    users.getUserIsAdmin.mockResolvedValue(false);
    users.getUserAccessLevel.mockResolvedValue(1);
    users.canUserCodeInWorkspace.mockResolvedValue(true);
    jobRepository.findOne.mockImplementation(({ where }: { where: { id: number; workspace_id: number } }) => (
      Promise.resolve(where.id === 11 && where.workspace_id === 7 ? entity : null)
    ));
    assignmentRepository.count.mockResolvedValue(1);
    jobs.assertUserCanAccessCodingJob.mockImplementation((id: number, workspace: number, user: number) => (
      jobAccess.assertUserCanAccessCodingJob(id, workspace, user)
    ));
    jobs.assertUserCanCodeCodingJob.mockImplementation((id: number, workspace: number, user: number) => (
      jobAccess.assertUserCanCodeCodingJob(id, workspace, user)
    ));
    jobs.getCodingJob.mockResolvedValue({ codingJob: entity });
    jobs.getCodingProgress.mockResolvedValue({});
    [jobs.updateCodingJob, jobs.saveCodingProgress, jobs.saveCodingNotes, jobs.saveCodingIssueReviewProgress,
      jobs.saveCodingIssueReviewNotes, jobs.pauseCodingJob, jobs.resumeCodingJob, jobs.submitCodingJob]
      .forEach(mock => mock.mockResolvedValue(entity));
    journal.recordEvent.mockResolvedValue(undefined);
    unitInfo.getUnitInfo.mockResolvedValue({ id: 'UNIT-1' });
    statistics.storeReplayStatistics.mockResolvedValue({ id: 1 });
  });

  afterAll(async () => {
    await app?.close();
    jwks?.closeAllConnections();
    if (jwks?.listening) {
      await new Promise<void>((resolve, reject) => {
        jwks.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it.each([
    {
      scopes: [R], info: 200, statisticsStatus: 201, progress: 401, source: 'external'
    },
    {
      scopes: [S], info: 401, statisticsStatus: 201, progress: 401, source: 'internal'
    },
    {
      scopes: [C], info: 401, statisticsStatus: 401, progress: 200, source: undefined
    },
    {
      scopes: [R, S, C], info: 200, statisticsStatus: 201, progress: 200, source: 'internal'
    }
  ])('enforces cross-scope permissions for $scopes on real routes', async row => {
    const signed = workspaceToken(row.scopes as WorkspaceTokenScope[]);
    expect((await request('GET', infoPath, signed)).status).toBe(row.info);
    expect((await request('POST', statsPath, signed, { unitId: 'UNIT-1', durationMilliseconds: 100 })).status)
      .toBe(row.statisticsStatus);
    expect((await request('GET', `${jobPath}/progress`, signed)).status).toBe(row.progress);
    if (row.source) {
      expect(statistics.storeReplayStatistics).toHaveBeenCalledWith(expect.objectContaining({ replaySource: row.source }));
    } else {
      expect(statistics.storeReplayStatistics).not.toHaveBeenCalled();
    }
    expect(users.createOidcProviderUser).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'POST', suffix: '/progress', body: { ...codingBody, selectedCode: null } },
    { method: 'POST', suffix: '/notes', body: { ...codingBody, notes: 'Synthetic note' } },
    { method: 'PUT', suffix: '/status', body: { status: 'paused' } },
    { method: 'PUT', suffix: '/comment', body: { comment: 'Synthetic comment' } },
    { method: 'POST', suffix: '/pause', body: undefined },
    { method: 'POST', suffix: '/resume', body: undefined },
    { method: 'POST', suffix: '/submit', body: undefined }
  ])('allows C and denies R on $method $suffix', async ({ method, suffix, body }) => {
    expect((await request(method, `${jobPath}${suffix}`, workspaceToken([R]), body)).status).toBe(401);
    expect(jobs.assertUserCanAccessCodingJob).not.toHaveBeenCalled();
    expect(jobs.assertUserCanCodeCodingJob).not.toHaveBeenCalled();
    expect((await request(method, `${jobPath}${suffix}`, workspaceToken([C]), body)).status)
      .toBe(method === 'POST' ? 201 : 200);
  });

  it.each([
    '/admin/workspace/token-policy',
    ownTokenPath,
    '/admin/workspace/7/other-identity/token/1?scopes=replay:read',
    '/admin/workspace/7/users',
    statsPath
  ])('denies even combined workspace scopes on protected user/admin route %s', async path => {
    expect((await request('GET', path, workspaceToken([R, S, C]))).status).toBe(401);
    expect(journal.recordEvent).not.toHaveBeenCalled();
    expect(workspaceUsers.findUsers).not.toHaveBeenCalled();
    expect(statistics.getReplayStatistics).not.toHaveBeenCalled();
  });

  it('denies job creation, deletion and human review submission for combined workspace scopes', async () => {
    const signed = workspaceToken([R, S, C]);
    expect((await request('POST', '/wsg-admin/workspace/7/coding-job', signed, {})).status).toBe(401);
    expect((await request('DELETE', jobPath, signed)).status).toBe(401);
    expect((await request('POST', `${jobPath}/submit-review`, signed)).status).toBe(401);
  });

  it('checks token workspace before reading data or writing progress', async () => {
    const signed = workspaceToken([R, S, C]);
    expect((await request('GET', infoPath.replace('/7/', '/8/'), signed)).status).toBe(401);
    expect((await request('POST', `${jobPath}/progress`.replace('/7/', '/8/'), signed, codingBody)).status).toBe(401);
    expect(users.canAccessWorkSpace).not.toHaveBeenCalled();
    expect(unitInfo.getUnitInfo).not.toHaveBeenCalled();
    expect(jobs.saveCodingProgress).not.toHaveBeenCalled();
  });

  it('enforces current membership for scoped reads and writes', async () => {
    users.canAccessWorkSpace.mockResolvedValue(false);
    const signed = workspaceToken([R, S, C]);
    expect((await request('GET', infoPath, signed)).status).toBe(403);
    expect((await request('POST', `${jobPath}/notes`, signed, codingBody)).status).toBe(403);
    expect(jobs.saveCodingNotes).not.toHaveBeenCalled();
    expect(unitInfo.getUnitInfo).not.toHaveBeenCalled();
  });

  it('requires actual job assignment for C progress writes', async () => {
    assignmentRepository.count.mockResolvedValue(0);
    const response = await request('POST', `${jobPath}/progress`, workspaceToken([C]), codingBody);
    expect(response.status).toBe(403);
    expect(assignmentRepository.count).toHaveBeenCalledWith({ where: { coding_job_id: 11, user_id: 42 } });
    expect(jobs.saveCodingProgress).not.toHaveBeenCalled();
  });

  it('retains manager checks on general job updates without widening coding access', async () => {
    const signed = workspaceToken([C]);
    expect((await request('PUT', jobPath, signed, { name: 'Synthetic rename' })).status).toBe(403);
    expect(jobs.updateCodingJob).not.toHaveBeenCalled();
    users.getUserAccessLevel.mockResolvedValue(2);
    assignmentRepository.count.mockResolvedValue(0);
    expect((await request('PUT', jobPath, signed, { name: 'Synthetic rename' })).status).toBe(200);
    expect((await request('POST', `${jobPath}/progress`, signed, codingBody)).status).toBe(403);
    expect(jobs.saveCodingProgress).not.toHaveBeenCalled();
  });

  it('requires manager rights for the issueReview branch of note writes', async () => {
    assignmentRepository.count.mockResolvedValue(0);
    const signed = workspaceToken([C]);
    const body = { ...codingBody, notes: 'Synthetic review note', issueReview: true };
    expect((await request('POST', `${jobPath}/notes`, signed, body)).status).toBe(403);
    expect(jobs.saveCodingIssueReviewNotes).not.toHaveBeenCalled();
    users.getUserAccessLevel.mockResolvedValue(2);
    expect((await request('POST', `${jobPath}/notes`, signed, body)).status).toBe(201);
    expect(jobs.saveCodingIssueReviewNotes).toHaveBeenCalledWith(11, 42, body);
    expect(jobs.saveCodingNotes).not.toHaveBeenCalled();
  });

  it('does not let C address a missing or foreign job through its bound workspace', async () => {
    expect((await request('GET', `${jobPath.replace('/11', '/99')}/progress`, workspaceToken([C]))).status).toBe(404);
    expect(jobs.getCodingProgress).not.toHaveBeenCalled();
  });

  it('issues a modern scoped token through a real OIDC-authenticated request and audits no token value', async () => {
    const response = await request('GET', ownTokenPath, oidcToken());
    expect(response.status).toBe(200);
    const issued = await response.json() as string;
    expect(jwt.verify(issued, {
      algorithms: ['HS256'],
      issuer: WORKSPACE_TOKEN_ISSUER,
      audience: WORKSPACE_TOKEN_AUDIENCE
    })).toMatchObject({
      userId: 42, workspace: 7, token_use: 'workspace', scopes: [R]
    });
    expect(journal.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 42, entityId: 42, eventType: 'ACCESS_TOKEN_CREATED', details: { durationDays: 1, scopes: [R] }
    }));
    expect(JSON.stringify(journal.recordEvent.mock.calls)).not.toContain(issued);
    expect((await request('GET', infoPath, issued)).status).toBe(200);
  });

  it.each([
    '/admin/workspace/7/token/1',
    '/admin/workspace/7/token/1?scopes=admin:all',
    '/admin/workspace/7/token/2?scopes=replay:read&scopes=coding-job:operate'
  ])('rejects invalid issuance policy over HTTP at %s', async path => {
    expect((await request('GET', path, oidcToken())).status).toBe(400);
    expect(journal.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects minting for another identity below workspace level 3', async () => {
    const path = '/admin/workspace/7/other-identity/token/1?scopes=replay:read';
    expect((await request('GET', path, oidcToken())).status).toBe(403);
    expect(journal.recordEvent).not.toHaveBeenCalled();
    users.getUserAccessLevel.mockResolvedValue(3);
    expect((await request('GET', path, oidcToken())).status).toBe(200);
    expect(journal.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 42, entityId: 43 }));
  });

  it('keeps scope-less legacy replay reading and statistics without granting job writes', async () => {
    const signed = workspaceToken(undefined, true);
    expect((await request('GET', infoPath, signed)).status).toBe(200);
    expect((await request('POST', statsPath, signed, { unitId: 'UNIT-1', durationMilliseconds: 100 })).status).toBe(201);
    expect((await request('POST', `${jobPath}/notes`, signed, codingBody)).status).toBe(401);
    expect(jobs.saveCodingNotes).not.toHaveBeenCalled();
  });

  it('preserves explicitly scoped legacy job operations instead of downgrading them to R', async () => {
    const signed = workspaceToken([C], true);
    expect((await request('POST', `${jobPath}/notes`, signed, codingBody)).status).toBe(201);
    expect((await request('GET', infoPath, signed)).status).toBe(401);
  });

  it('cuts off both legacy forms while preserving modern tokens after restarting with compatibility disabled', async () => {
    const modern = workspaceToken([R, C]);
    const legacyRead = workspaceToken(undefined, true);
    const legacyOperate = workspaceToken([C], true);
    await app.close();
    await createApp(false);
    expect((await request('GET', infoPath, modern)).status).toBe(200);
    expect((await request('POST', `${jobPath}/notes`, modern, codingBody)).status).toBe(201);
    expect((await request('GET', infoPath, legacyRead)).status).toBe(401);
    expect((await request('POST', `${jobPath}/notes`, legacyOperate, codingBody)).status).toBe(401);
  });
});
