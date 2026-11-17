import { createServer, Socket } from 'node:net';
import { ForbiddenException, INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { WorkspaceCodingReplayController } from '../admin/workspace/workspace-coding-replay.controller';
import { WorkspaceGuard } from '../admin/workspace/workspace.guard';
import { JwtOrWorkspaceTokenAuthGuard } from '../auth/jwt-or-workspace-token-auth.guard';
import { CodingReplayService } from '../database/services/coding';
import { WorkspaceTestResultsService } from '../database/services/test-results';
import { WorkspaceFilesService, WorkspacePlayerService } from '../database/services/workspace';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';
import { requestIdMiddleware } from './request-id.middleware';

jest.mock('libxmljs2', () => ({}));

const routes = ['replay-assets/UNIT', 'replay-response/login@code@group@BOOKLET/UNIT', 'replay-payload/login@code@group@BOOKLET/UNIT'];
const deadlines = ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'];

describe('PostgreSQL connection deadlines through replay HTTP routes', () => {
  let app: INestApplication;
  let baseUrl: string;
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;
  const results = { findUnitResponse: jest.fn() };
  const player = { findUnitDef: jest.fn(), findUnit: jest.fn(), findPlayer: jest.fn() };
  const files = { getVocs: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkspaceCodingReplayController],
      providers: [
        { provide: CodingReplayService, useValue: {} },
        { provide: WorkspaceTestResultsService, useValue: results },
        { provide: WorkspacePlayerService, useValue: player },
        { provide: WorkspaceFilesService, useValue: files },
        { provide: ConfigService, useValue: { get: () => undefined } }
      ]
    })
      .overrideGuard(JwtOrWorkspaceTokenAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/api/admin/workspace/47`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    results.findUnitResponse.mockResolvedValue({ responses: [] });
    player.findUnitDef.mockResolvedValue([{ data: 'unit definition' }]);
    player.findUnit.mockResolvedValue([{ data: '<Unit><DefinitionRef player="PLAYER-1" /></Unit>' }]);
    player.findPlayer.mockResolvedValue([{ data: 'player' }]);
    files.getVocs.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app?.close();
    errorLog?.mockRestore();
    warnLog?.mockRestore();
  });

  it.each(routes.flatMap(route => deadlines.map(message => ({ route, message }))))(
    'returns a safe 503 for $route on $message', async ({ route, message }) => {
      (route.startsWith('replay-assets') ? player.findUnitDef : results.findUnitResponse)
        .mockRejectedValueOnce(new Error(message));
      const response = await fetch(`${baseUrl}/${route}`, { headers: { 'X-Request-Id': 'deadline-request' } });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        statusCode: 503, message: 'Internal server error', requestId: 'deadline-request'
      });
      expect(response.headers.get('X-Request-Id')).toBe('deadline-request');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Vary')).toBe('Authorization');
    }
  );

  it('returns 503 for the actual pg error when a new connection cannot complete its handshake', async () => {
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address() as { port: number };
    const pool = new Pool({
      host: '127.0.0.1',
      port: address.port,
      user: 'deadline-test',
      database: 'deadline-test',
      connectionTimeoutMillis: 100
    });
    let driverError: unknown;
    results.findUnitResponse.mockImplementationOnce(async () => {
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        driverError = error;
        throw error;
      }
      return { responses: [] };
    });
    try {
      const response = await fetch(`${baseUrl}/${routes[1]}`);
      expect(driverError).toEqual(expect.objectContaining({ message: 'Connection terminated due to connection timeout' }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ statusCode: 503, message: 'Internal server error' });
    } finally {
      await pool.end();
      sockets.forEach(socket => socket.destroy());
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  });

  it.each(routes)('keeps successful responses and cache headers compatible on %s', async route => {
    const response = await fetch(`${baseUrl}/${route}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(route.startsWith('replay-assets') ? 'private, max-age=300' : 'no-store');
    expect(response.headers.get('Vary')).toBe('Authorization');
  });

  it('preserves HTTP 403 instead of reclassifying existing HTTP exceptions', async () => {
    results.findUnitResponse.mockRejectedValueOnce(new ForbiddenException());
    expect((await fetch(`${baseUrl}/${routes[1]}`)).status).toBe(403);
  });

  it('keeps unrelated failures as a safe HTTP 500', async () => {
    results.findUnitResponse.mockRejectedValueOnce(new Error('private SQL execution detail'));
    const response = await fetch(`${baseUrl}/${routes[1]}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ statusCode: 500, message: 'Internal server error' });
  });
});
