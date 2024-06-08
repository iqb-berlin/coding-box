import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { WorkspaceService } from './database/services/workspace.service';
import { JwtService } from '@nestjs/jwt';
import { createMock } from '@golevelup/ts-jest';
import { AuthService } from './auth/service/auth.service';
import { UsersService } from './database/services/users.service';
import { TestcenterService } from './database/services/testcenter.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
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
        },{
          provide: WorkspaceService,
          useValue: createMock<WorkspaceService>()
        }
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
    });
  });
});
