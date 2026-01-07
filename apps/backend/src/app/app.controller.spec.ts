import { Test } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { AppController } from './app.controller';
import { AuthService } from './auth/service/auth.service';
import { UsersService } from './users/services/users.service';
import { TestcenterService } from './workspaces/services/testcenter.service';
import { WorkspaceUsersService } from './workspaces/services/workspace-users.service';
import { WorkspacesAdminFacade } from './workspaces/services/workspaces-admin-facade.service';

describe('AppController', () => {
  beforeEach(async () => {
    await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        },
        {
          provide: TestcenterService,
          useValue: createMock<TestcenterService>()
        },
        {
          provide: WorkspaceUsersService,
          useValue: createMock<WorkspaceUsersService>()
        },
        {
          provide: WorkspacesAdminFacade,
          useValue: createMock<WorkspacesAdminFacade>()
        }
      ]
    }).compile();
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
    });
  });
});
