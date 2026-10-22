import { Variable } from '../../models/coding-job.model';
import {
  createCoderTrainingForm, createTrainingVariableForm, getTrainingAvailableCaseCount, getTrainingVariableSampleLimit,
  hasCoderTrainingLabel, hasValidTrainingCaseCounts, hasValidTrainingReferenceMode, updateTrainingReferenceModeValidation,
  updateTrainingVariableSampleLimit
} from './coder-training-form';

describe('coder training form rules', () => {
  it('requires a reference mode only when reference trainings are selected', () => {
    const form = createCoderTrainingForm();
    form.controls.referenceTrainingIds.setValue([42]);
    updateTrainingReferenceModeValidation(form);
    expect(form.controls.referenceMode.hasError('required')).toBe(true);
    expect(hasValidTrainingReferenceMode(form)).toBe(false);
    form.controls.referenceMode.setValue('same');
    expect(hasValidTrainingReferenceMode(form)).toBe(true);

    const changes = jest.fn();
    form.controls.referenceMode.valueChanges.subscribe(changes);
    form.controls.referenceTrainingIds.setValue([]);
    updateTrainingReferenceModeValidation(form);
    expect(form.controls.referenceMode.value).toBeNull();
    expect(form.controls.referenceMode.valid).toBe(true);
    expect(hasValidTrainingReferenceMode(form)).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });

  it('does not allow a whitespace-only training label to start a training', () => {
    const form = createCoderTrainingForm();
    form.controls.trainingLabel.setValue('   ');
    expect(hasCoderTrainingLabel(form)).toBe(false);
    form.controls.trainingLabel.setValue('  Training 1  ');
    expect(hasCoderTrainingLabel(form)).toBe(true);
  });

  it('validates the inclusive sample limits and retains an explicit zero for correction', () => {
    const variable = createTrainingVariableForm({
      variableId: 'v', unitId: 'u', maxAvailable: 5, sampleCount: 0
    });
    expect(variable.controls.sampleCount.value).toBe(0);
    expect(variable.controls.sampleCount.hasError('min')).toBe(true);
    variable.controls.sampleCount.setValue(5);
    expect(variable.valid).toBe(true);
    variable.controls.sampleCount.setValue(6);
    expect(variable.controls.sampleCount.hasError('max')).toBe(true);
  });

  it('uses aggregated counts including authoritative zero before raw counts', () => {
    const variable: Variable = {
      unitName: 'u',
      variableId: 'v',
      responseCount: 20,
      deriveErrorResponseCount: 4,
      uniqueCasesAfterAggregation: 0,
      uniqueCasesAfterAggregationWithDeriveError: 0
    };
    expect(getTrainingAvailableCaseCount(variable)).toBe(0);
    expect(getTrainingAvailableCaseCount(variable, true)).toBe(0);
    expect(getTrainingVariableSampleLimit(variable)).toBe(0);
    expect(createTrainingVariableForm({ variableId: 'v', unitId: 'u', maxAvailable: 0 }).invalid).toBe(true);
  });

  it('adds derive errors only on opt-in and falls back when aggregation metadata is absent', () => {
    const variable: Variable = {
      unitName: 'u', variableId: 'v', responseCount: 8, deriveErrorResponseCount: 3
    };
    expect(getTrainingAvailableCaseCount(variable)).toBe(8);
    expect(getTrainingAvailableCaseCount(variable, true)).toBe(11);
    expect(getTrainingAvailableCaseCount({ ...variable, uniqueCasesAfterAggregation: 5 }, true)).toBe(8);
    expect(getTrainingAvailableCaseCount(undefined)).toBe(0);
    expect(getTrainingVariableSampleLimit(undefined)).toBe(1000);
  });

  it('fills an empty sample after opting into available derive-error cases', () => {
    const variable = createTrainingVariableForm({ variableId: 'v', unitId: 'u', maxAvailable: 0 });
    variable.controls.includeDeriveError.setValue(true);
    updateTrainingVariableSampleLimit(variable, 4);
    expect(variable.controls.sampleCount.value).toBe(4);
    expect(variable.valid).toBe(true);
  });

  it('revalidates changed availability without replacing a chosen sample', () => {
    const variable = createTrainingVariableForm({
      variableId: 'v', unitId: 'u', maxAvailable: 10, sampleCount: 5
    });
    updateTrainingVariableSampleLimit(variable, 3);
    expect(variable.controls.sampleCount.value).toBe(5);
    expect(variable.controls.sampleCount.hasError('max')).toBe(true);
    updateTrainingVariableSampleLimit(variable, 8);
    expect(variable.controls.sampleCount.value).toBe(5);
    expect(variable.valid).toBe(true);
  });

  it('rejects stale sample availability using the matching unit and variable', () => {
    const form = createCoderTrainingForm();
    form.controls.variables.push(createTrainingVariableForm({
      variableId: 'v', unitId: 'u', maxAvailable: 10, sampleCount: 5
    }));
    const available: Variable[] = [
      { unitName: 'other', variableId: 'v', responseCount: 100 },
      {
        unitName: 'u', variableId: 'v', responseCount: 3, deriveErrorResponseCount: 2
      }
    ];
    expect(form.controls.variables.valid).toBe(true);
    expect(hasValidTrainingCaseCounts(form, available)).toBe(false);
    form.controls.variables.at(0).controls.includeDeriveError.setValue(true);
    expect(hasValidTrainingCaseCounts(form, available)).toBe(true);
  });

  it('retains the recovery fallback when metadata is unavailable but rejects an invalid control', () => {
    const form = createCoderTrainingForm();
    const variable = createTrainingVariableForm({ variableId: 'v', unitId: 'u', maxAvailable: getTrainingVariableSampleLimit(undefined) });
    form.controls.variables.push(variable);
    expect(hasValidTrainingCaseCounts(form, [])).toBe(true);
    variable.controls.sampleCount.setValue(1001);
    expect(hasValidTrainingCaseCounts(form, [])).toBe(false);
  });

  it('keeps forms independent and resets nullable and nonnullable controls correctly', () => {
    const form = createCoderTrainingForm();
    const other = createCoderTrainingForm();
    form.controls.variables.push(createTrainingVariableForm({ variableId: 'v', unitId: 'u', maxAvailable: 10 }));
    form.patchValue({ trainingLabel: 'Changed', allowComments: false, referenceMode: 'different' });
    expect(other.controls.variables.length).toBe(0);
    expect(other.controls.trainingLabel.value).toBe('');
    form.reset();
    expect(form.controls.trainingLabel.value).toBe('');
    expect(form.controls.allowComments.value).toBe(true);
    expect(form.controls.referenceMode.value).toBeNull();
  });
});
