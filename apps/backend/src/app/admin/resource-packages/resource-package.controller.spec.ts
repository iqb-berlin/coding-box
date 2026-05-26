import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ResourcePackageController } from './resource-package.controller';
import { AuthService } from '../../auth/service/auth.service';
import { ResourcePackageService } from '../../database/services/workspace';
import { AccessLevelGuard } from '../workspace/access-level.guard';
import { UsersService } from '../../database/services/users';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from '../workspace/workspace.guard';

describe('ResourcePackageController', () => {
  let controller: ResourcePackageController;
  let resourcePackageService: jest.Mocked<ResourcePackageService>;

  beforeEach(async () => {
    resourcePackageService = createMock<ResourcePackageService>();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourcePackageController],
      providers: [
        {
          provide: AuthService,
          useValue: createMock<AuthService>()
        },
        {
          provide: ResourcePackageService,
          useValue: resourcePackageService
        },
        AccessLevelGuard,
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        }
      ]
    }).compile();

    controller = module.get<ResourcePackageController>(
      ResourcePackageController
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return an empty list when no resource packages exist', async () => {
    resourcePackageService.findResourcePackages.mockResolvedValue([]);

    await expect(controller.findResourcePackages(5)).resolves.toEqual([]);
  });

  it.each([
    'findResourcePackages',
    'removeResourcePackage',
    'removeIds',
    'getZippedResourcePackage',
    'create',
    'installGeoGebra'
  ] as const)('requires study-manager access for %s', methodName => {
    const handler = ResourcePackageController.prototype[methodName];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler);

    expect(guards).toEqual([JwtAuthGuard, WorkspaceGuard, AccessLevelGuard]);
    expect(Reflect.getMetadata('accessLevel', handler)).toBe(3);
  });
});
