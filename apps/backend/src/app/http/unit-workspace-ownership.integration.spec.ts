import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { In } from 'typeorm';
import { UnitTagsController } from '../admin/unit-tags/unit-tags.controller';
import { UnitNotesController } from '../admin/unit-notes/unit-notes.controller';
import { UnitTagService } from '../database/services/workspace/unit-tag.service';
import { UnitNoteService } from '../database/services/workspace/unit-note.service';
import { AuthService } from '../auth/service/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { createRequestValidationPipe } from './request-validation';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';

describe.each(['tag', 'note'] as const)('Unit %s workspace ownership', kind => {
  let app: INestApplication;
  let url: string;
  let records: Array<Record<string, unknown>>;
  const units = [
    { id: 1001, workspaceId: 47 },
    { id: 2002, workspaceId: 88 }
  ];
  const auth = { canAccessWorkSpace: jest.fn(async (_user, workspace) => workspace === 47) };
  const unitRepository = {
    findOne: jest.fn(async ({ where }) => units.find(unit => (
      unit.id === where.id &&
      (where.booklet?.person?.workspace_id === undefined ||
       unit.workspaceId === where.booklet.person.workspace_id)
    )) || null)
  };
  const matches = (record: Record<string, unknown>, where) => {
    const workspaceId = where.unit?.booklet?.person?.workspace_id;
    const unit = units.find(candidate => candidate.id === record.unitId);
    const unitIds = where.unitId?.value;
    return (where.id === undefined || record.id === where.id) &&
      (where.unitId === undefined || (unitIds ? unitIds.includes(record.unitId) : record.unitId === where.unitId)) &&
      (workspaceId === undefined || unit?.workspaceId === workspaceId);
  };
  const repository = {
    findOne: jest.fn(async ({ where }) => records.find(record => matches(record, where)) || null),
    find: jest.fn(async ({ where }) => records.filter(record => matches(record, where))),
    create: jest.fn(value => ({ id: 9001, ...value })),
    save: jest.fn(async value => value),
    delete: jest.fn(async id => ({ affected: records.some(record => record.id === id) ? 1 : 0 }))
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UnitTagsController, UnitNotesController],
      providers: [
        { provide: UnitTagService, useValue: new UnitTagService(repository as never, unitRepository as never) },
        { provide: UnitNoteService, useValue: new UnitNoteService(repository as never, unitRepository as never) },
        { provide: AuthService, useValue: auth }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = { id: 7 };
        return true;
      }
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/admin/workspace/47/unit-${kind}s`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    records = [
      {
        id: 5001, unitId: 1001, [kind]: 'Own annotation', createdAt: new Date(), updatedAt: new Date()
      },
      {
        id: 5002, unitId: 2002, [kind]: 'Private foreign annotation', createdAt: new Date(), updatedAt: new Date()
      }
    ];
  });

  afterAll(async () => app?.close());

  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${url}${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  });

  it.each(['GET', 'PATCH', 'DELETE'])('rejects %s of a foreign annotation with 404', async method => {
    const response = await request('/5002', method, method === 'PATCH' ? { [kind]: 'Changed' } : undefined);
    expect(response.status).toBe(404);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
    expect(auth.canAccessWorkSpace).toHaveBeenCalledWith(7, 47);
  });

  it('rejects creation and listing for a foreign unit', async () => {
    expect((await request('', 'POST', { unitId: 2002, [kind]: 'New' })).status).toBe(404);
    expect((await request('/unit/2002')).status).toBe(404);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.find).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PATCH', 'DELETE'])('allows %s of an annotation in the authorized workspace', async method => {
    const response = await request('/5001', method, method === 'PATCH' ? { [kind]: 'Changed' } : undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(method === 'DELETE' ? true : expect.objectContaining({
      id: 5001,
      [kind]: method === 'PATCH' ? 'Changed' : 'Own annotation'
    }));
  });

  it('allows creation and listing in the authorized workspace', async () => {
    const created = await request('', 'POST', { unitId: 1001, [kind]: 'New' });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ unitId: 1001, [kind]: 'New' });
    const list = await request('/unit/1001');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([expect.objectContaining({ id: 5001 })]);
  });

  it('filters mixed batches by workspace and skips empty batches', async () => {
    const service = kind === 'tag' ? app.get(UnitTagService) : app.get(UnitNoteService);
    const result = await service.findAllByUnitIds(47, [1001, 2002]);
    expect(result).toEqual(kind === 'tag' ? [expect.objectContaining({ id: 5001 })] : {
      1001: [expect.objectContaining({ id: 5001 })]
    });
    expect(repository.find).toHaveBeenCalledWith({
      where: { unitId: In([1001, 2002]), unit: { booklet: { person: { workspace_id: 47 } } } },
      order: { createdAt: 'DESC' }
    });
    repository.find.mockClear();
    expect(await service.findAllByUnitIds(47, [])).toEqual(kind === 'tag' ? [] : {});
    expect(repository.find).not.toHaveBeenCalled();
    if (kind === 'note') {
      const response = await request('/units/notes', 'POST', { unitIds: [1001, 2002] });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ 1001: [expect.objectContaining({ id: 5001 })] });
    }
  });

  it('rejects a URL for a workspace without access', async () => {
    const response = await fetch(`${url.replace('/47/', '/88/')}/5002`);
    expect(response.status).toBe(401);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it.each(['/not-a-number', '/unit/not-a-number'])('rejects invalid numeric resource ids at %s', async path => {
    expect((await request(path)).status).toBe(400);
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(unitRepository.findOne).not.toHaveBeenCalled();
  });
});
