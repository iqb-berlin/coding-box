import { createTrainingVariableForm } from './coder-training-form';
import { groupTrainingVariables, markTrainingVariableOverlaps } from './training-variable-groups';

describe('training variable groups', () => {
  it('retains form control identity and original indices across manual and bundle groups', () => {
    const manual = createTrainingVariableForm({ unitId: 'U', variableId: 'v', maxAvailable: 5 });
    const bundled = createTrainingVariableForm({
      unitId: 'U', variableId: 'v', maxAvailable: 5, bundleId: 2, bundleName: 'Bundle', bundleCaseOrderingMode: 'alternating'
    });
    const grouped = groupTrainingVariables([manual, bundled], [], 'continuous');
    expect(grouped.manual).toEqual([{ control: manual, index: 0 }]);
    expect(grouped.bundles[0].variables[0]).toEqual({ control: bundled, index: 1 });
    expect(grouped.bundles[0].bundle.caseOrderingMode).toBe('alternating');
    grouped.bundles[0].variables[0].control.controls.sampleCount.setValue(3);
    expect(bundled.controls.sampleCount.value).toBe(3);
  });

  it('sets and clears only changed manual overlap warnings', () => {
    const manual = createTrainingVariableForm({ unitId: 'U', variableId: 'v', maxAvailable: 5 });
    const bundled = createTrainingVariableForm({
      unitId: 'U', variableId: 'v', maxAvailable: 5, bundleId: 2, bundleName: 'B'
    });
    const changes = jest.fn();
    manual.controls.overlapWarning.valueChanges.subscribe(changes);
    markTrainingVariableOverlaps([manual, bundled]);
    markTrainingVariableOverlaps([manual, bundled]);
    expect(changes.mock.calls).toEqual([[true]]);
    markTrainingVariableOverlaps([manual]);
    expect(changes.mock.calls).toEqual([[true], [false]]);
    expect(bundled.controls.overlapWarning.value).toBe(false);
  });
});
