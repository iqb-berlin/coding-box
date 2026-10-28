import { createCodingJobForm } from './coding-job-definition-form';
import {
  DefinitionRecoverySelection, hasRecoverableDefinitionState, matchesDefinitionRecoveryContext, recoverBundle, recoverVariable
} from './job-definition-recovery';
import { CodingJobDefinitionRecoveryDraft } from './coding-job-definition.models';

describe('job definition recovery rules', () => {
  const selection: DefinitionRecoverySelection = {
    variables: [],
    bundles: [],
    coderCount: 0,
    unitNameFilter: '',
    variableIdFilter: '',
    bundleNameFilter: '',
    availabilityFilter: 'all',
    trainingRequiredFilter: 'all'
  };
  const draft: CodingJobDefinitionRecoveryDraft = {
    ...selection,
    workspaceId: 5,
    mode: 'definition',
    isEdit: true,
    jobDefinitionId: 7,
    formValue: {},
    doubleCodingMode: 'absolute',
    selectedVariables: [],
    selectedVariableBundles: [],
    selectedCoderConfigs: []
  };

  it('requires the same workspace, definition and edit mode, and excludes read-only dialogs', () => {
    const data = { mode: 'definition' as const, isEdit: true, jobDefinitionId: 7 };
    expect(matchesDefinitionRecoveryContext(draft, data, 5)).toBe(true);
    expect(matchesDefinitionRecoveryContext(draft, data, 6)).toBe(false);
    expect(matchesDefinitionRecoveryContext(draft, { ...data, jobDefinitionId: 8 }, 5)).toBe(false);
    expect(matchesDefinitionRecoveryContext(draft, { ...data, isEdit: false }, 5)).toBe(false);
    expect(matchesDefinitionRecoveryContext(draft, { ...data, readOnly: true }, 5)).toBe(false);
  });

  it('captures meaningful form and filter edits but skips pristine empty definitions', () => {
    const data = { mode: 'definition' as const, isEdit: false };
    const form = createCodingJobForm(data);
    expect(hasRecoverableDefinitionState(data, form, selection)).toBe(false);
    expect(hasRecoverableDefinitionState(data, form, { ...selection, availabilityFilter: 'partial' })).toBe(true);
    form.patchValue({ description: 'draft' });
    form.markAsDirty();
    expect(hasRecoverableDefinitionState(data, form, selection)).toBe(true);
  });

  it('retains current metrics and bundle membership while restoring ordering and derive-error choices', () => {
    const variable = { unitName: 'UNIT', variableId: 'V', availableCases: 8 };
    expect(recoverVariable({ ...variable, includeDeriveError: true }, [variable])).toEqual({ ...variable, includeDeriveError: true });
    expect(recoverVariable({ unitName: 'MISSING', variableId: 'V' }, [])).toEqual({ unitName: 'MISSING', variableId: 'V', includeDeriveError: false });
    const bundle = {
      id: 1, name: 'current', variables: [variable], createdAt: new Date(), updatedAt: new Date()
    };
    const recovered = recoverBundle({
      id: 1, name: 'old', caseOrderingMode: 'alternating', variables: [{ ...variable, includeDeriveError: true }]
    }, [bundle]);
    expect(recovered).toMatchObject({ name: 'current', caseOrderingMode: 'alternating', variables: [{ ...variable, includeDeriveError: true }] });
    expect(bundle.variables[0]).toBe(variable);
  });
});
