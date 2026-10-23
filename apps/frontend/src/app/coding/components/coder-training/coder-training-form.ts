import {
  FormArray, FormBuilder, FormControl, FormGroup, ValidatorFn, Validators
} from '@angular/forms';
import { CaseSelectionMode, ReferenceMode } from '../../models/coder-training.model';
import { Variable } from '../../models/coding-job.model';

export interface CoderTrainingFormValue {
  trainingLabel: string;
  caseOrderingMode: 'continuous' | 'alternating';
  caseSelectionMode: CaseSelectionMode;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
  includeDerivedVariables: boolean;
  referenceTrainingIds: number[];
  referenceMode: ReferenceMode | null;
}

export type TrainingVariableForm = FormGroup<{
  variableId: FormControl<string>;
  unitId: FormControl<string>;
  sampleCount: FormControl<number>;
  bundleId: FormControl<number | null>;
  bundleName: FormControl<string>;
  overlapWarning: FormControl<boolean>;
  bundleCaseOrderingMode: FormControl<'continuous' | 'alternating' | null>;
  includeDeriveError: FormControl<boolean>;
}>;

export type CoderTrainingForm = FormGroup<{
  [Key in keyof CoderTrainingFormValue]: FormControl<CoderTrainingFormValue[Key]>;
} & { variables: FormArray<TrainingVariableForm> }>;

export function createCoderTrainingForm(): CoderTrainingForm {
  const fb = new FormBuilder().nonNullable;
  return fb.group({
    trainingLabel: ['', [Validators.required]],
    caseOrderingMode: ['continuous' as 'continuous' | 'alternating'],
    caseSelectionMode: ['oldest_first' as CaseSelectionMode],
    showScore: [false],
    allowComments: [true],
    suppressGeneralInstructions: [false],
    includeDerivedVariables: [true],
    referenceTrainingIds: [[] as number[]],
    referenceMode: [null as ReferenceMode | null],
    variables: fb.array<TrainingVariableForm>([])
  });
}

export function trainingSampleCountValidators(maxAvailable: number): ValidatorFn[] {
  return [Validators.required, Validators.min(1), Validators.max(maxAvailable)];
}

interface TrainingVariableFormOptions {
  variableId: string;
  unitId: string;
  maxAvailable: number;
  sampleCount?: number;
  bundleId?: number;
  bundleName?: string;
  bundleCaseOrderingMode?: 'continuous' | 'alternating';
  includeDeriveError?: boolean;
}

export function createTrainingVariableForm({
  variableId, unitId, maxAvailable, sampleCount, bundleId, bundleName, bundleCaseOrderingMode, includeDeriveError = false
}: TrainingVariableFormOptions): TrainingVariableForm {
  const fb = new FormBuilder().nonNullable;
  return fb.group({
    variableId: [variableId, [Validators.required]],
    unitId: [unitId, [Validators.required]],
    sampleCount: [sampleCount !== undefined ? sampleCount : maxAvailable, trainingSampleCountValidators(maxAvailable)],
    bundleId: [bundleId ?? null],
    bundleName: [bundleName ?? ''],
    overlapWarning: [false],
    bundleCaseOrderingMode: [bundleCaseOrderingMode || null],
    includeDeriveError: [includeDeriveError]
  });
}

/** Event subscriptions and their lifetime remain with the owning component. */
export function updateTrainingReferenceModeValidation(form: CoderTrainingForm): void {
  const hasReferences = (form.controls.referenceTrainingIds.value || []).length > 0;
  const control = form.controls.referenceMode;
  control.setValidators(hasReferences ? [Validators.required] : []);
  if (!hasReferences && control.value) control.setValue(null, { emitEvent: false });
  control.updateValueAndValidity({ emitEvent: false });
}

export function hasValidTrainingReferenceMode(form: CoderTrainingForm): boolean {
  return (form.controls.referenceTrainingIds.value || []).length === 0 || !!form.controls.referenceMode.value;
}

export function hasCoderTrainingLabel(form: CoderTrainingForm): boolean {
  const value = form.controls.trainingLabel.value;
  return typeof value === 'string' && value.trim().length > 0;
}

export function getTrainingAvailableCaseCount(variable: Variable | undefined, includeDeriveError = false): number {
  if (includeDeriveError) {
    return variable?.uniqueCasesAfterAggregationWithDeriveError ??
      ((variable?.uniqueCasesAfterAggregation ?? variable?.responseCount ?? 0) + (variable?.deriveErrorResponseCount ?? 0));
  }
  return variable?.uniqueCasesAfterAggregation ?? variable?.responseCount ?? 0;
}

export function getTrainingVariableSampleLimit(variable: Variable | undefined, includeDeriveError = false): number {
  return variable ? getTrainingAvailableCaseCount(variable, includeDeriveError) : 1000;
}

export function hasValidTrainingCaseCounts(form: CoderTrainingForm, availableVariables: readonly Variable[]): boolean {
  return form.controls.variables.controls.every(control => {
    if (!control.controls.sampleCount.valid) return false;
    const variable = availableVariables.find(candidate => candidate.unitName === control.controls.unitId.value &&
      candidate.variableId === control.controls.variableId.value);
    return !variable || getTrainingAvailableCaseCount(variable, control.controls.includeDeriveError.value === true) >=
      (control.controls.sampleCount.value || 0);
  });
}

export function updateTrainingVariableSampleLimit(control: TrainingVariableForm, maxAvailable: number): void {
  const sampleCount = control.controls.sampleCount;
  sampleCount.setValidators(trainingSampleCountValidators(maxAvailable));
  if (control.controls.includeDeriveError.value && (Number(sampleCount.value) || 0) < 1 && maxAvailable > 0) {
    sampleCount.setValue(maxAvailable);
  }
  sampleCount.updateValueAndValidity();
}
