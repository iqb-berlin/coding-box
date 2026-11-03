import { VariableBundle } from '../../models/coding-job.model';
import { TrainingVariableForm } from './coder-training-form';

export interface VariableGrouping {
  manual: { control: TrainingVariableForm; index: number }[];
  bundles: { bundle: VariableBundle; variables: { control: TrainingVariableForm; index: number }[] }[];
}

export function groupTrainingVariables(controls: TrainingVariableForm[], availableBundles: VariableBundle[], caseOrderingMode: 'continuous' | 'alternating'): VariableGrouping {
  const manualVariables: { control: TrainingVariableForm; index: number }[] = [];
  const bundleGroups: { [bundleId: number]: { bundle: VariableBundle; variables: { control: TrainingVariableForm; index: number }[] } } = {};

  controls.forEach((control, index) => {
    const bundleId = control.controls.bundleId.value;
    const bundleName = control.controls.bundleName.value;

    if (bundleId && bundleName) {
      const bundleModeFromControl = control.controls.bundleCaseOrderingMode.value as 'continuous' | 'alternating' | null;
      if (!bundleGroups[bundleId]) {
        const bundle = availableBundles.find(b => b.id === bundleId);
        bundleGroups[bundleId] = {
          bundle: {
            id: bundleId,
            name: bundleName,
            createdAt: bundle?.createdAt || new Date(),
            updatedAt: bundle?.updatedAt || new Date(),
            description: bundle?.description,
            variables: bundle?.variables || [],
            caseOrderingMode: bundleModeFromControl || bundle?.caseOrderingMode || caseOrderingMode || 'continuous'
          },
          variables: []
        };
      }
      if (!bundleGroups[bundleId].bundle.caseOrderingMode && bundleModeFromControl) {
        bundleGroups[bundleId].bundle.caseOrderingMode = bundleModeFromControl;
      }
      bundleGroups[bundleId].variables.push({ control: control, index });
    } else {
      manualVariables.push({ control: control, index });
    }
  });

  return {
    manual: manualVariables,
    bundles: Object.values(bundleGroups)
  };
}

export function markTrainingVariableOverlaps(controls: TrainingVariableForm[]): void {
  const bundleVariables = new Set<string>();

  controls.forEach(control => {
    if (control.controls.bundleId.value) {
      const varId = control.controls.variableId.value;
      const unitId = control.controls.unitId.value;
      if (varId && unitId) {
        bundleVariables.add(`${unitId}::${varId}`);
      }
    }
  });

  controls.forEach(control => {
    if (!control.controls.bundleId.value) {
      const varId = control.controls.variableId.value;
      const unitId = control.controls.unitId.value;
      const key = `${unitId}::${varId}`;
      const isOverlapping = bundleVariables.has(key);

      const currentWarning = control.controls.overlapWarning.value;
      if (currentWarning !== isOverlapping) {
        control.get('overlapWarning')?.setValue(isOverlapping);
      }
    }
  });
}
