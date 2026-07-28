import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceCodingAnalysisController } from './workspace-coding-analysis.controller';

describe('WorkspaceCodingAnalysisController', () => {
  it('uses the read-only profile list for result exports', async () => {
    const missingsProfilesService = {
      getMissingsProfilesForExport: jest.fn().mockResolvedValue([
        { id: 4, label: 'IQB-Standard' }
      ])
    };
    const controller = new WorkspaceCodingAnalysisController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      missingsProfilesService as never,
      {} as never
    );

    await expect(controller.getExportMissingsProfiles(7)).resolves.toEqual([
      { id: 4, label: 'IQB-Standard' }
    ]);
    expect(missingsProfilesService.getMissingsProfilesForExport)
      .toHaveBeenCalledWith(7);
  });

  it('passes excludeJobDefinitionId to incomplete variable availability', async () => {
    const codingValidationService = {
      getCodingIncompleteVariables: jest.fn().mockResolvedValue([])
    };
    const controller = new WorkspaceCodingAnalysisController(
      {} as never,
      {} as never,
      codingValidationService as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      controller.getCodingIncompleteVariables(
        7,
        undefined,
        'false',
        'true',
        '55'
      )
    ).resolves.toEqual([]);

    expect(codingValidationService.getCodingIncompleteVariables)
      .toHaveBeenCalledWith(7, undefined, false, true, 55);
  });

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
    'getExportMissingsProfiles',
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
