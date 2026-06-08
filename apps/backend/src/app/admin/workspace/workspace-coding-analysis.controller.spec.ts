import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceCodingAnalysisController } from './workspace-coding-analysis.controller';

describe('WorkspaceCodingAnalysisController', () => {
  it('requires coding-manager access for getVariableAnalysis', () => {
    const handler = WorkspaceCodingAnalysisController.prototype.getVariableAnalysis;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      WorkspaceGuard,
      AccessLevelGuard
    ]);
    expect(Reflect.getMetadata('accessLevel', handler)).toBe(2);
  });

  it.each([
    'validateCodingCompleteness',
    'validateAndExportCodingCompleteness',
    'getCodingIncompleteVariables',
    'getManualCodingScopeSummary',
    'validateManualCodeAvailability',
    'getAppliedResultsCount',
    'getMissingsProfiles',
    'getResponseAnalysis',
    'getAggregationSettings',
    'saveAggregationSettings',
    'applyDuplicateAggregation',
    'postTriggerResponseAnalysis'
  ] as const)('requires coding-manager access for %s', methodName => {
    const handler = WorkspaceCodingAnalysisController.prototype[methodName];

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      WorkspaceGuard,
      AccessLevelGuard
    ]);
    expect(Reflect.getMetadata('accessLevel', handler)).toBe(2);
  });
});
