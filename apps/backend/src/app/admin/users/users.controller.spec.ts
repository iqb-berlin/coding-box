import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { UsersController } from './users.controller';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: ReturnType<typeof createMock<UsersService>>;

  beforeEach(async () => {
    usersService = createMock<UsersService>();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: UsersService,
          useValue: usersService
        }

      ]
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  async function createTestApp(): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: UsersService,
          useValue: usersService
        }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = module.createNestApplication();
    await app.init();
    await app.listen(0);
    return app;
  }

  describe('workspace access', () => {
    it('parses the workspace id when retrieving user access', async () => {
      usersService.getUsersWithWorkspaceAccess.mockResolvedValue([]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`);

        expect(response.status).toBe(200);
        expect(usersService.getUsersWithWorkspaceAccess).toHaveBeenCalledWith(3);
      } finally {
        await app?.close();
      }
    });

    it('parses the workspace id when updating user access', async () => {
      usersService.updateUsersAccess.mockResolvedValue(true);
      const payload = [{ id: 5, accessLevel: 1, canCode: true }];
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/access/3`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toBe(true);
        expect(usersService.updateUsersAccess).toHaveBeenCalledWith(3, payload);
      } finally {
        await app?.close();
      }
    });
  });

  describe('user workspaces', () => {
    it('parses the user id when retrieving workspaces', async () => {
      usersService.getUserWorkspaces.mockResolvedValue([2, 3]);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5/workspaces`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([2, 3]);
        expect(usersService.getUserWorkspaces).toHaveBeenCalledWith(5);
      } finally {
        await app?.close();
      }
    });
  });

  describe('updateUser', () => {
    it('parses the user id before delegating', async () => {
      const payload = { id: 5, username: 'updated-user', isAdmin: false };
      usersService.updateUser.mockResolvedValue(payload);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(payload);
        expect(usersService.updateUser).toHaveBeenCalledWith(5, payload);
      } finally {
        await app?.close();
      }
    });
  });

  describe('assignUserWorkspaces', () => {
    it('parses the user id from the route before delegating', async () => {
      usersService.assignUserWorkspaces.mockResolvedValue(true);
      let app: INestApplication | undefined;

      try {
        app = await createTestApp();

        const response = await fetch(`${await app.getUrl()}/admin/users/5/workspaces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([2, 3])
        });

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toBe(true);
        expect(usersService.assignUserWorkspaces).toHaveBeenCalledWith(5, [2, 3]);
      } finally {
        await app?.close();
      }
    });
  });
});
