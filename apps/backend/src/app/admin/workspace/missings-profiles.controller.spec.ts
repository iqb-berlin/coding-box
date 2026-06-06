import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MissingsProfilesController } from './missings-profiles.controller';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard } from './access-level.guard';

describe('MissingsProfilesController', () => {
  it.each([
    ['getMissingsProfiles', [JwtAuthGuard, WorkspaceGuard], undefined],
    ['getMissingsProfileDetails', [JwtAuthGuard, WorkspaceGuard], undefined],
    ['createMissingsProfile', [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard], 3],
    ['updateMissingsProfile', [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard], 3],
    ['deleteMissingsProfile', [JwtAuthGuard, WorkspaceGuard, AccessLevelGuard], 3]
  ])('protects %s with the expected guards', (methodName, expectedGuards, expectedAccessLevel) => {
    const handler = MissingsProfilesController.prototype[
      methodName as keyof MissingsProfilesController
    ];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(expectedGuards);
    expect(Reflect.getMetadata('accessLevel', handler)).toBe(expectedAccessLevel);
  });
});
