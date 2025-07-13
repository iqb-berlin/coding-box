import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { WorkspaceController } from './workspace.controller';
import { AuthService } from '../../auth/service/auth.service';
import { UsersService } from '../../database/services/users.service';
import { TestcenterService } from '../../database/services/testcenter.service';
import { UploadResultsService } from '../../database/services/upload-results.service'; // ggf. anpassen, falls anderer Pfad
import { WorkspaceCoreService } from '../../database/services/workspace-core.service';

describe('WorkspaceController', () => {
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
        }
      ]
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
