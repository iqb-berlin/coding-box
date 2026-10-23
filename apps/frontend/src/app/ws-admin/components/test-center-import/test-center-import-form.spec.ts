import {
  clearTestCenterImportOptions, createTestCenterImportForm, createTestCenterLoginForm,
  selectTestCenterImportOptions, updateIndividualTestCenterControl
} from './test-center-import-form';

describe('test center form rules', () => {
  it('requires credentials and a server but leaves the individual URL disabled initially', () => {
    const form = createTestCenterLoginForm();
    expect(form.invalid).toBe(true);
    expect(form.controls.testCenterIndividual.disabled).toBe(true);
    form.patchValue({ name: 'user', pw: 'password', testCenter: 1 });
    expect(form.valid).toBe(true);
  });

  it('requires an individual server URL only in the corresponding server mode', () => {
    const form = createTestCenterLoginForm();
    form.patchValue({ name: 'user', pw: 'password', testCenter: 6 });
    updateIndividualTestCenterControl(form, 6);
    expect(form.controls.testCenterIndividual.hasError('required')).toBe(true);
    form.controls.testCenterIndividual.setValue('https://testcenter.example');
    expect(form.valid).toBe(true);
    form.controls.testCenter.setValue(1);
    updateIndividualTestCenterControl(form, 1);
    expect(form.value.testCenterIndividual).toBeUndefined();
    expect(form.getRawValue().testCenterIndividual).toBe('https://testcenter.example');
    updateIndividualTestCenterControl(form, 6);
    expect(form.controls.testCenterIndividual.value).toBe('https://testcenter.example');
  });

  it('selects result options without replacing file selections or import context', () => {
    const form = createTestCenterImportForm();
    form.patchValue({ workspace: 'workspace-a', responseOverwriteMode: 'replace', units: true });
    selectTestCenterImportOptions(form, 'testResults');
    expect(form.getRawValue()).toEqual(expect.objectContaining({
      workspace: 'workspace-a', responseOverwriteMode: 'replace', units: true, responses: true, logs: true, player: false
    }));
  });

  it('selects all file types while retaining result options', () => {
    const form = createTestCenterImportForm();
    form.controls.responses.setValue(true);
    selectTestCenterImportOptions(form, 'files');
    const { workspace, responseOverwriteMode, ...options } = form.getRawValue();
    expect(workspace).toBe('');
    expect(responseOverwriteMode).toBe('skip');
    expect(options).toEqual({
      responses: true,
      logs: false,
      definitions: true,
      units: true,
      player: true,
      codings: true,
      booklets: true,
      testTakers: true,
      metadata: true
    });
  });

  it('clears only the option flags, preserving workspace and overwrite policy', () => {
    const form = createTestCenterImportForm();
    form.patchValue({ workspace: 'workspace-a', responseOverwriteMode: 'replace' });
    selectTestCenterImportOptions(form, 'files');
    selectTestCenterImportOptions(form, 'testResults');
    clearTestCenterImportOptions(form);
    const { workspace, responseOverwriteMode, ...options } = form.getRawValue();
    expect(workspace).toBe('workspace-a');
    expect(responseOverwriteMode).toBe('replace');
    expect(Object.values(options).every(value => value === false)).toBe(true);
  });

  it('keeps instances independent and resets typed defaults', () => {
    const form = createTestCenterImportForm();
    const other = createTestCenterImportForm();
    form.patchValue({ workspace: 'workspace-a', responses: true });
    expect(other.controls.responses.value).toBe(false);
    form.reset();
    expect(form.controls.workspace.value).toBe('');
    expect(form.controls.workspace.hasError('required')).toBe(true);
    expect(form.controls.responses.value).toBe(false);
    expect(form.controls.responseOverwriteMode.value).toBe('skip');
  });
});
