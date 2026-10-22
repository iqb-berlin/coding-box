import {
  FormBuilder, FormControl, FormGroup, Validators
} from '@angular/forms';
import { CodingJob } from '../../models/coding-job.model';

export interface CodingJobFormValue {
  durationSeconds: number;
  maxCodingCases: number | null;
  doubleCodingAbsolute: number;
  doubleCodingPercentage: number;
  caseOrderingMode: 'continuous' | 'alternating';
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
  name?: string;
  description?: string;
  missingsProfileId?: number;
  status?: string;
}

export type CodingJobForm = FormGroup<{
  [Key in keyof CodingJobFormValue]: FormControl<Exclude<CodingJobFormValue[Key], undefined>>;
}>;

interface CodingJobFormOptions {
  mode: 'definition' | 'job';
  isEdit: boolean;
  job?: Partial<CodingJob>;
  readOnly?: boolean;
  lockStatus?: boolean;
}

/** One independent form per dialog; optional controls follow the editing mode. */
export function createCodingJobForm({
  mode, isEdit, job, readOnly = false, lockStatus = false
}: CodingJobFormOptions): CodingJobForm {
  const fb = new FormBuilder().nonNullable;
  const form: CodingJobForm = fb.group({
    durationSeconds: [job?.durationSeconds || 1, [Validators.min(1)]],
    maxCodingCases: fb.control<number | null>(job?.maxCodingCases || null, [Validators.min(1)]),
    doubleCodingAbsolute: [job?.doubleCodingAbsolute ?? 0, [Validators.min(0)]],
    doubleCodingPercentage: [job?.doubleCodingPercentage ?? 0, [Validators.min(0), Validators.max(100)]],
    caseOrderingMode: fb.control<'continuous' | 'alternating'>(job?.caseOrderingMode || 'continuous', [Validators.required]),
    showScore: [job?.showScore ?? mode !== 'definition'],
    allowComments: [job?.allowComments ?? true],
    suppressGeneralInstructions: [job?.suppressGeneralInstructions ?? false]
  });

  if (mode === 'definition') {
    form.addControl('name', fb.control(job?.name || '', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(255)]));
    form.addControl('description', fb.control(job?.description || ''));
    form.addControl('missingsProfileId', fb.control(job?.missingsProfileId ?? job?.missings_profile_id ?? 0, [Validators.min(0)]));
  }
  if (isEdit) {
    form.addControl('status', fb.control(job?.status || (mode === 'definition' ? 'draft' : 'pending'), [Validators.required]));
  }
  if (lockStatus) form.controls.status?.disable({ emitEvent: false });
  if (readOnly) form.disable({ emitEvent: false });
  return form;
}
