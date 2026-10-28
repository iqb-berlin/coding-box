import { createCodingJobForm } from './coding-job-definition-form';

describe('coding job form rules', () => {
  it('creates definition-only controls and preserves the job display defaults', () => {
    const definition = createCodingJobForm({ mode: 'definition', isEdit: false });
    const job = createCodingJobForm({ mode: 'job', isEdit: false });

    expect(definition.controls.name).toBeDefined();
    expect(definition.controls.status).toBeUndefined();
    expect(definition.controls.showScore.value).toBe(false);
    expect(job.controls.name).toBeUndefined();
    expect(job.controls.missingsProfileId).toBeUndefined();
    expect(job.controls.showScore.value).toBe(true);
  });

  it.each(['', '   ', 'x'.repeat(256)])('rejects an invalid definition name: %p', name => {
    const form = createCodingJobForm({ mode: 'definition', isEdit: false });
    form.controls.name!.setValue(name);
    expect(form.controls.name!.invalid).toBe(true);
  });

  it('accepts a nonempty name at the length limit', () => {
    const form = createCodingJobForm({ mode: 'definition', isEdit: false });
    form.controls.name!.setValue('x'.repeat(255));
    expect(form.valid).toBe(true);
  });

  it('keeps optional case limits and validates numerical boundaries', () => {
    const form = createCodingJobForm({ mode: 'job', isEdit: false });
    expect(form.controls.maxCodingCases.valid).toBe(true);
    form.patchValue({
      durationSeconds: 0, maxCodingCases: 0, doubleCodingAbsolute: -1, doubleCodingPercentage: 101
    });
    expect(form.controls.durationSeconds.hasError('min')).toBe(true);
    expect(form.controls.maxCodingCases.hasError('min')).toBe(true);
    expect(form.controls.doubleCodingAbsolute.hasError('min')).toBe(true);
    expect(form.controls.doubleCodingPercentage.hasError('max')).toBe(true);
    form.patchValue({
      durationSeconds: 1, maxCodingCases: null, doubleCodingAbsolute: 0, doubleCodingPercentage: 100
    });
    expect(form.valid).toBe(true);
    form.controls.doubleCodingPercentage.setValue(-1);
    expect(form.controls.doubleCodingPercentage.hasError('min')).toBe(true);
  });

  it('retains explicit false values and prefers the current profile field, including zero', () => {
    const form = createCodingJobForm({
      mode: 'definition',
      isEdit: true,
      job: {
        name: 'Definition', showScore: false, allowComments: false, missingsProfileId: 0, missings_profile_id: 7
      }
    });
    expect(form.controls.missingsProfileId!.value).toBe(0);
    expect(form.controls.showScore.value).toBe(false);
    expect(form.controls.allowComments.value).toBe(false);
    expect(form.controls.status!.value).toBe('draft');
    const legacy = createCodingJobForm({ mode: 'definition', isEdit: true, job: { missings_profile_id: 7 } });
    expect(legacy.controls.missingsProfileId!.value).toBe(7);
  });

  it.each(['durationSeconds', 'maxCodingCases', 'doubleCodingAbsolute'] as const)(
    'rejects fractional counts in %s before submitting the API request', field => {
      const form = createCodingJobForm({ mode: 'job', isEdit: false });
      form.controls[field].setValue(1.5);
      expect(form.controls[field].invalid).toBe(true);
      form.controls[field].setValue(1);
      form.controls.doubleCodingPercentage.setValue(25.5);
      expect(form.valid).toBe(true);
    }
  );

  it('locks only status while keeping it in the payload and other fields editable', () => {
    const form = createCodingJobForm({
      mode: 'job', isEdit: true, lockStatus: true, job: { status: 'active' }
    });
    expect(form.controls.status!.disabled).toBe(true);
    expect(form.value.status).toBeUndefined();
    expect(form.getRawValue().status).toBe('active');
    expect(form.controls.durationSeconds.enabled).toBe(true);
    expect(createCodingJobForm({ mode: 'job', isEdit: true }).controls.status!.value).toBe('pending');
  });

  it('disables a read-only form without losing its payload', () => {
    const form = createCodingJobForm({
      mode: 'definition', isEdit: true, readOnly: true, job: { name: 'Approved' }
    });
    expect(form.disabled).toBe(true);
    expect(Object.values(form.controls).every(control => control.disabled)).toBe(true);
    expect(form.getRawValue().name).toBe('Approved');
  });

  it('keeps instances independent and resets to typed initial values', () => {
    const form = createCodingJobForm({ mode: 'job', isEdit: false });
    const other = createCodingJobForm({ mode: 'job', isEdit: false });
    form.patchValue({ durationSeconds: 12, allowComments: false });
    expect(other.controls.durationSeconds.value).toBe(1);
    form.reset();
    expect(form.controls.durationSeconds.value).toBe(1);
    expect(form.controls.allowComments.value).toBe(true);
    expect(form.controls.maxCodingCases.value).toBeNull();
  });
});
