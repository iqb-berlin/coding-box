import { ExportJobConfig } from '../../../shared/services/file/export-job.service';
import { ManualCodingExportContext, ManualCodingExportDialogResult } from '../manual-coding-export-dialog/manual-coding-export-dialog.component';

/** Freeze the view's selection before estimation, confirmation and job startup. */
export function createManualCodingExportConfig(
  context: ManualCodingExportContext,
  result: ManualCodingExportDialogResult,
  userId: number | undefined,
  scopeIds: number[]
): ExportJobConfig {
  return {
    exportType: result.exportType,
    userId,
    ...getDisplayMetadata(result),
    includeReplayUrl: result.includeReplayUrl ?? false,
    includeResponseValues: result.includeResponseValues ?? false,
    outputCommentsInsteadOfCodes: result.outputCommentsInsteadOfCodes,
    anonymizeCoders: result.anonymizeCoders,
    usePseudoCoders: result.usePseudoCoders,
    doubleCodingMethod: result.doubleCodingMethod,
    includeComments: result.includeComments,
    includeModalValue: result.includeModalValue,
    excludeAutoCoded: true,
    coderIds: result.coderIds ? [...result.coderIds] : undefined,
    coderTrainingIds: context === 'training' ?
      [...(result.coderTrainingIds ?? scopeIds)] :
      undefined,
    jobDefinitionIds: context === 'execution' ?
      [...(result.jobDefinitionIds ?? scopeIds)] :
      undefined
  };
}

export function requiresWorksheetEstimate(config: ExportJobConfig): boolean {
  return config.exportType === 'aggregated' && config.doubleCodingMethod === 'new-row-per-variable';
}

export function createCompactByVariableExportConfig(exportConfig: ExportJobConfig): ExportJobConfig {
  return {
    ...exportConfig,
    exportType: 'by-variable-compact',
    doubleCodingMethod: undefined,
    displayLabelKey: 'export-toast.types.by-variable-compact',
    downloadFilePrefix: 'manual-review-by-variable-compact'
  };
}

function getDisplayMetadata(
  result: ManualCodingExportDialogResult
): Pick<ExportJobConfig, 'displayLabelKey' | 'downloadFilePrefix'> {
  if (result.exportType !== 'aggregated') {
    return {};
  }

  switch (result.doubleCodingMethod || 'most-frequent') {
    case 'new-column-per-coder':
      return {
        displayLabelKey: 'export-toast.types.manual-review-new-column-per-coder',
        downloadFilePrefix: 'manual-review-new-column-per-coder'
      };
    case 'new-row-per-variable':
      return {
        displayLabelKey: 'export-toast.types.manual-review-new-row-per-variable',
        downloadFilePrefix: 'manual-review-new-row-per-variable'
      };
    case 'most-frequent':
    default:
      return {
        displayLabelKey: 'export-toast.types.manual-review-most-frequent',
        downloadFilePrefix: 'manual-review-most-frequent'
      };
  }
}
