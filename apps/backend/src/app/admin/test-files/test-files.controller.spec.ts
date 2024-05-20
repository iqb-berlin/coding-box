import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { TestFilesController } from './test-files.controller';
import { AuthService } from '../../auth/service/auth.service';

describe('VeronaModulesController', () => {
  let controller: TestFilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestFilesController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        }
      ]
    }).compile();

    controller = module.get<TestFilesController>(TestFilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
