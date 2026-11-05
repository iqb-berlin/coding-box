import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { createRequestValidationPipe } from '../../http/request-validation';
import { TestcenterInstancesService } from '../../testcenter/testcenter-instances.service';
import { AdminTestcenterInstancesController } from './testcenter-instances.controller';
import { TestcenterInstancesController } from './testcenter-discovery.controller';

describe('Testcenter instance approval HTTP authorization', () => {
  let app: INestApplication;
  let url: string;
  const store = new Map<string, { key: string; content: string }>();
  const http = { axiosRef: { get: jest.fn() } };

  beforeAll(async () => {
    const repository = {
      find: async () => [...store.values()],
      findOne: async ({ where }: { where: { key: string } }) => store.get(where.key) || null,
      save: async (entry: { key: string; content: string }) => { store.set(entry.key, entry); return entry; },
      delete: async (key: string) => { store.delete(key); }
    };
    const manager = { getRepository: () => repository, query: async () => [] };
    const module = await Test.createTestingModule({
      controllers: [AdminTestcenterInstancesController, TestcenterInstancesController],
      providers: [
        TestcenterInstancesService,
        { provide: ConfigService, useValue: new ConfigService() },
        { provide: HttpService, useValue: http },
        {
          provide: getRepositoryToken(Setting),
          useValue: {
            ...repository,
            manager: { transaction: async (_isolation: string, change: (value: typeof manager) => Promise<unknown>) => change(manager) }
          }
        },
        { provide: AuthService, useValue: { isAdminUser: async () => false } },
        { provide: UsersService, useValue: {} }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: { switchToHttp: () => { getRequest: () => { headers: { authorization?: string }; user?: unknown } } }) {
        const request = context.switchToHttp().getRequest();
        if (!['Bearer administrator', 'Bearer workspace-user'].includes(request.headers.authorization || '')) throw new UnauthorizedException();
        request.user = { id: 1, isAdmin: request.headers.authorization === 'Bearer administrator' };
        return true;
      }
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createRequestValidationPipe());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  beforeEach(() => { store.clear(); http.axiosRef.get.mockReset(); });
  afterAll(async () => { await app?.close(); });

  const request = (path: string, role: string, method = 'GET', body?: unknown) => fetch(`${url}/api/${path}`, {
    method,
    headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  it('requires application authentication for discovery and system administrator rights for changes and probes', async () => {
    expect((await request('testcenter/instances', 'anonymous')).status).toBe(401);
    expect((await request('testcenter/instances', 'workspace-user')).status).toBe(200);
    const input = { label: 'Study', baseUrl: 'https://study.example/tci' };
    for (const method of ['POST', 'DELETE']) {
      expect((await request('admin/testcenter/instances', 'workspace-user', method, method === 'POST' ? input : { baseUrl: input.baseUrl })).status).toBe(401);
    }
    expect((await request('admin/testcenter/instances/test', 'workspace-user', 'POST', { baseUrl: input.baseUrl })).status).toBe(401);
    expect(store.size).toBe(0);
    expect(http.axiosRef.get).not.toHaveBeenCalled();
  });

  it('validates the body before saving an approval and exposes saved instances to import users', async () => {
    expect((await request('admin/testcenter/instances', 'administrator', 'POST', { label: 'Study', baseUrl: 'https://study.example', credentials: 'must-not-be-stored' })).status).toBe(400);
    expect((await request('admin/testcenter/instances', 'administrator', 'POST', { label: 'Study', baseUrl: 'https://study.example/tci' })).status).toBe(201);
    const list = await request('testcenter/instances', 'workspace-user');
    expect(await list.json()).toContainEqual({ label: 'Study', baseUrl: 'https://study.example/tci', source: 'administrator' });
  });
});
