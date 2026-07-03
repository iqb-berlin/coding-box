import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { WorkspaceController } from './workspace.controller';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users';
import { TestcenterService, UploadResultsService } from '../../database/services/test-results';
import { WorkspaceCoreService, WorkspaceUsersService } from '../../database/services/workspace';
import { AccessRightsMatrixService } from './access-rights-matrix.service';

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  let workspaceCoreService: jest.Mocked<WorkspaceCoreService>;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: TestcenterService,
          useValue: createMock<TestcenterService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        },
        {
          provide: UploadResultsService,
          useValue: createMock<UploadResultsService>() // Mock-Implementierung für UploadResultsService
        },
        {
          provide: WorkspaceCoreService,
          useValue: createMock<WorkspaceCoreService>()
        },
        {
          provide: WorkspaceUsersService,
          useValue: createMock<WorkspaceUsersService>()
        },
        {
          provide: AccessRightsMatrixService,
          useValue: createMock<AccessRightsMatrixService>()
        }
      ]
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
    workspaceCoreService = module.get<jest.Mocked<WorkspaceCoreService>>(WorkspaceCoreService);
    usersService = module.get<jest.Mocked<UsersService>>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the authenticated user id when creating a workspace', async () => {
    workspaceCoreService.create.mockResolvedValueOnce(12);
    usersService.findUserByIdentity.mockResolvedValueOnce({
      id: 5,
      username: 'creator',
      isAdmin: true
    });

    await expect(controller.create(
      { name: 'New workspace' } as never,
      { user: { id: 'identity-5' } } as never
    )).resolves.toBe(12);

    expect(usersService.findUserByIdentity).toHaveBeenCalledWith('identity-5');
    expect(workspaceCoreService.create).toHaveBeenCalledWith({ name: 'New workspace' }, 5);
  });
});
