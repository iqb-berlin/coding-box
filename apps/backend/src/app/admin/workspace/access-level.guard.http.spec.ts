import {
  Controller, Get, INestApplication, UseGuards
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import { UsersService } from '../../database/services/users';
import { GlobalHttpExceptionFilter } from '../../http/global-http-exception.filter';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';

@Controller('workspace/:workspace_id')
@UseGuards(AccessLevelGuard)
class ProtectedWorkspaceController {
  @Get()
  @RequireAccessLevel(3)
  read(): { allowed: boolean } {
    return { allowed: true };
  }
}

describe('Workspace permission status at the HTTP boundary', () => {
  let app: INestApplication;
  let url: string;
  const usersService = {
    getUserIsAdmin: jest.fn(),
    getUserAccessLevel: jest.fn()
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProtectedWorkspaceController],
      providers: [AccessLevelGuard, { provide: UsersService, useValue: usersService }]
    }).compile();
    app = module.createNestApplication();
    app.use((request: Request & { user?: { id: number } }, _response: Response, next: NextFunction) => {
      if (request.headers['x-fixture-user'] === '42') request.user = { id: 42 };
      next();
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/workspace/17`;
  });

  beforeEach(() => {
    usersService.getUserIsAdmin.mockReset().mockResolvedValue(false);
    usersService.getUserAccessLevel.mockReset().mockResolvedValue(3);
  });

  afterAll(async () => { await app?.close(); });

  const authenticatedRequest = () => fetch(url, { headers: { 'x-fixture-user': '42' } });

  it('returns 401 when no authenticated identity is available', async () => {
    expect((await fetch(url)).status).toBe(401);
    expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
  });

  it.each([null, 0, 1, 2])('returns 403 for an authenticated user with access level %s', async level => {
    usersService.getUserAccessLevel.mockResolvedValue(level);
    const response = await authenticatedRequest();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({ statusCode: 403 }));
  });

  it('honors revoked rights on the next request without rejecting the identity', async () => {
    expect((await authenticatedRequest()).status).toBe(200);
    usersService.getUserAccessLevel.mockResolvedValue(null);
    expect((await authenticatedRequest()).status).toBe(403);
    expect(usersService.getUserAccessLevel).toHaveBeenCalledTimes(2);
  });

  it('allows a system administrator without workspace membership', async () => {
    usersService.getUserIsAdmin.mockResolvedValue(true);
    usersService.getUserAccessLevel.mockResolvedValue(null);
    expect((await authenticatedRequest()).status).toBe(200);
    expect(usersService.getUserAccessLevel).not.toHaveBeenCalled();
  });
});
