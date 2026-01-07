import { Test } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { AppController } from './app.controller';
import { AuthService } from './auth/service/auth.service';
import { UsersService } from './users/services/users.service';
import { TestcenterService } from './workspaces/services/testcenter.service';
import { WorkspaceUsersService } from './workspaces/services/workspace-users.service';

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
        }
      ]
    }).compile();
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
    });
  });
});
