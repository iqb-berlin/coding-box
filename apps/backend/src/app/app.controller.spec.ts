import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { AppController } from './app.controller';
import { AuthService } from './auth/service/auth.service';
import { UsersService } from './database/services/users';
import { TestcenterService } from './database/services/test-results';
import { WorkspaceUsersService } from './database/services/workspace';

describe('AppController', () => {
  let controller: AppController;
  let usersService: ReturnType<typeof createMock<UsersService>>;
  let workspaceUsersService: ReturnType<typeof createMock<WorkspaceUsersService>>;

  beforeEach(async () => {
    usersService = createMock<UsersService>();
    workspaceUsersService = createMock<WorkspaceUsersService>();

    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: UsersService,
          useValue: usersService
        },
        {
          provide: TestcenterService,
          useValue: createMock<TestcenterService>()
        },
        {
          provide: WorkspaceUsersService,
          useValue: workspaceUsersService
        }
      ]
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  describe('getUserAuthData', () => {
    it('returns auth data for the authenticated identity', async () => {
      usersService.findUserByIdentity.mockResolvedValue({
        id: 5,
        username: 'new-user',
        isAdmin: false
      });
      workspaceUsersService.findAllUserWorkspaces.mockResolvedValue([]);

      await expect(controller.getUserAuthData(
        'identity-1',
        { user: { identity: 'identity-1' } } as never
      )).resolves.toEqual({
        userId: 5,
        userName: 'new-user',
        isAdmin: false,
        workspaces: []
      });

      expect(usersService.findUserByIdentity).toHaveBeenCalledWith('identity-1');
      expect(workspaceUsersService.findAllUserWorkspaces).toHaveBeenCalledWith('identity-1');
    });

    it('rejects missing identity parameters', async () => {
      await expect(controller.getUserAuthData(
        ' ',
        { user: { identity: 'identity-1' } } as never
      )).rejects.toBeInstanceOf(BadRequestException);

      expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    });

    it('rejects repeated identity parameters', async () => {
      await expect(controller.getUserAuthData(
        ['identity-1', 'identity-2'] as unknown as string,
        { user: { identity: 'identity-1' } } as never
      )).rejects.toBeInstanceOf(BadRequestException);

      expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    });

    it('rejects identity parameters that do not match the token identity', async () => {
      await expect(controller.getUserAuthData(
        'requested-identity',
        { user: { identity: 'token-identity' } } as never
      )).rejects.toBeInstanceOf(ForbiddenException);

      expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    });

    it('rejects identity parameters when the token has no identity claim', async () => {
      await expect(controller.getUserAuthData(
        'requested-identity',
        { user: {} } as never
      )).rejects.toBeInstanceOf(ForbiddenException);

      expect(usersService.findUserByIdentity).not.toHaveBeenCalled();
    });

    it('returns not found when the authenticated identity is not in the coding-box database yet', async () => {
      usersService.findUserByIdentity.mockResolvedValue(null);

      await expect(controller.getUserAuthData(
        'identity-1',
        { user: { identity: 'identity-1' } } as never
      )).rejects.toBeInstanceOf(NotFoundException);

      expect(workspaceUsersService.findAllUserWorkspaces).not.toHaveBeenCalled();
    });
  });
});
