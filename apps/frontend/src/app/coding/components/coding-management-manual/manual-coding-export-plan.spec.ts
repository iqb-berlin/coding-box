import { createCompactByVariableExportConfig, createManualCodingExportConfig, requiresWorksheetEstimate } from './manual-coding-export-plan';

describe('manual export planning', () => {
  it('captures only the relevant context and detaches selection arrays from the dialog', () => {
    const scope = [3, 4];
    const coders = [7];
    const config = createManualCodingExportConfig('training', { exportType: 'detailed', coderIds: coders, jobDefinitionIds: [99] }, 8, scope);
    scope.push(5);
    coders.push(9);
    expect(config).toEqual(expect.objectContaining({
      coderTrainingIds: [3, 4], coderIds: [7], jobDefinitionIds: undefined, userId: 8, excludeAutoCoded: true, includeReplayUrl: false, includeResponseValues: false
    }));
  });

  it('preserves an explicit empty scope rather than silently widening it', () => {
    expect(createManualCodingExportConfig('execution', { exportType: 'coding-times', jobDefinitionIds: [] }, 8, [3]).jobDefinitionIds).toEqual([]);
  });

  it.each(['most-frequent', 'new-column-per-coder', 'new-row-per-variable'] as const)('labels review method %s and estimates only the worksheet expansion', doubleCodingMethod => {
    const config = createManualCodingExportConfig('execution', { exportType: 'aggregated', doubleCodingMethod }, 8, [3]);
    expect(config.downloadFilePrefix).toBe(`manual-review-${doubleCodingMethod}`);
    expect(requiresWorksheetEstimate(config)).toBe(doubleCodingMethod === 'new-row-per-variable');
    const compact = createCompactByVariableExportConfig(config);
    expect(compact).toEqual(expect.objectContaining({
      exportType: 'by-variable-compact', doubleCodingMethod: undefined, jobDefinitionIds: [3], excludeAutoCoded: true
    }));
    expect(config.exportType).toBe('aggregated');
  });
});
