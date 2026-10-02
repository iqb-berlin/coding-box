import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceCodingReviewController } from './workspace-coding-review.controller';

describe('WorkspaceCodingReviewController', () => {
  it.each([
    ['getDoubleCodedVariablesForReview', 2],
    ['saveDoubleCodedReviewDraft', 2],
    ['deleteDoubleCodedReviewDraft', 2],
    ['applyDoubleCodedResolutions', 3],
    ['reconcileDoubleCodedAggregation', 3]
  ] as const)('%s requires access level %i', (methodName, accessLevel) => {
    const handler = WorkspaceCodingReviewController.prototype[methodName];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      WorkspaceGuard,
      AccessLevelGuard
    ]);
    expect(Reflect.getMetadata('accessLevel', handler)).toBe(accessLevel);
  });
});
