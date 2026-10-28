import { CodingJobForm } from './coding-job-definition-form';
import {
  CodingJobDefinitionDialogData, CodingJobDefinitionRecoveryDraft,
  CodingJobDefinitionRecoveryVariable, CodingJobDefinitionRecoveryBundle
} from './coding-job-definition.models';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { variableUsageKey } from './job-variable-selection';

export interface DefinitionRecoverySelection {
  variables: Variable[];
  bundles: VariableBundle[];
  coderCount: number;
  unitNameFilter: string;
  variableIdFilter: string;
  bundleNameFilter: string;
  availabilityFilter: CodingJobDefinitionRecoveryDraft['availabilityFilter'];
  trainingRequiredFilter: CodingJobDefinitionRecoveryDraft['trainingRequiredFilter'];
}

export function matchesDefinitionRecoveryContext(
  draft: CodingJobDefinitionRecoveryDraft, data: CodingJobDefinitionDialogData, workspaceId: number
): boolean {
  if (data.mode !== 'definition' || data.readOnly === true) {
    return false;
  }
  if (draft.workspaceId !== workspaceId) {
    return false;
  }
  if (draft.mode !== data.mode || draft.isEdit !== data.isEdit) {
    return false;
  }
  if (draft.isEdit) {
    return draft.jobDefinitionId === data.jobDefinitionId;
  }

  return true;
}

export function hasRecoverableDefinitionState(
  data: CodingJobDefinitionDialogData, form: CodingJobForm, selection: DefinitionRecoverySelection
): boolean {
  if (data.isEdit) {
    return true;
  }

  const formValue = form.getRawValue();
  const hasFormChanges = form.dirty && (
    (formValue.name?.trim().length ?? 0) > 0 ||
    (formValue.description?.trim().length ?? 0) > 0 ||
    formValue.durationSeconds !== 1 ||
    formValue.maxCodingCases !== null ||
    (formValue.doubleCodingAbsolute ?? 0) !== 0 ||
    (formValue.doubleCodingPercentage ?? 0) !== 0 ||
    formValue.caseOrderingMode !== 'continuous' ||
    formValue.showScore !== false ||
    formValue.allowComments !== true ||
    formValue.suppressGeneralInstructions === true ||
    (formValue.missingsProfileId ?? 0) !== 0
  );

  return selection.variables.length > 0 ||
    selection.bundles.length > 0 ||
    selection.coderCount > 0 ||
    selection.unitNameFilter.trim().length > 0 ||
    selection.variableIdFilter.trim().length > 0 ||
    selection.bundleNameFilter.trim().length > 0 ||
    selection.availabilityFilter !== 'all' ||
    selection.trainingRequiredFilter !== 'all' ||
    hasFormChanges;
}

export function recoverVariable(savedVariable: CodingJobDefinitionRecoveryVariable, variables: Variable[]): Variable {
  const variable = variables.find(candidate => (
    candidate.unitName === savedVariable.unitName &&
    candidate.variableId === savedVariable.variableId
  ));
  if (variable) {
    const recovered = { ...variable, includeDeriveError: savedVariable.includeDeriveError === true };
    return recovered;
  }

  return {
    unitName: savedVariable.unitName,
    variableId: savedVariable.variableId,
    includeDeriveError: savedVariable.includeDeriveError === true
  };
}

export function recoverBundle(savedBundle: CodingJobDefinitionRecoveryBundle, bundles: VariableBundle[]): VariableBundle {
  const bundle = bundles.find(candidate => candidate.id === savedBundle.id);
  if (!bundle) {
    return {
      ...savedBundle,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  const savedVariablesByKey = new Map(
    savedBundle.variables.map(variable => [
      variableUsageKey(variable.unitName, variable.variableId),
      variable
    ])
  );
  return {
    ...bundle,
    caseOrderingMode: savedBundle.caseOrderingMode,
    variables: bundle.variables.map(variable => ({
      ...variable,
      includeDeriveError: savedVariablesByKey.get(
        variableUsageKey(variable.unitName, variable.variableId)
      )?.includeDeriveError === true
    }))
  };
}
