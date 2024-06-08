import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { TestFilesController } from './test-files.controller';
import { AuthService } from '../../auth/service/auth.service';
import { WorkspaceService } from '../../database/services/workspace.service';

describe('VeronaModulesController', () => {
  let controller: TestFilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestFilesController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: WorkspaceService,
          useValue: createMock<WorkspaceService>()
        }
      ]
    }).compile();

    controller = module.get<TestFilesController>(TestFilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
