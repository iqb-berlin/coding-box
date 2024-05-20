import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { WorkspaceController } from './workspace.controller';
import { AuthService } from '../../auth/service/auth.service';
import { WorkspaceService } from '../../database/services/workspace.service';
import { UsersService } from '../../database/services/users.service';

describe('WorkspaceGroupsController', () => {
  let controller: WorkspaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: WorkspaceService,
          useValue: createMock<WorkspaceService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        }
      ]
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
