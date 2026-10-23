import {
  FormBuilder, FormControl, FormGroup, Validators
} from '@angular/forms';
import type { ImportOptions } from '../../../shared/services/file/import.service';
import type { TestResultsOverwriteMode } from '../../../../../../../api-dto/files/import-options.dto';

interface TestCenterLoginFormValue {
  name: string;
  pw: string;
  testCenter: number | '';
  testCenterIndividual: string;
}

type TestCenterImportFormValue = ImportOptions & { workspace: string; responseOverwriteMode: TestResultsOverwriteMode };
export type TestCenterLoginForm = FormGroup<{ [Key in keyof TestCenterLoginFormValue]: FormControl<TestCenterLoginFormValue[Key]> }>;
export type TestCenterImportForm = FormGroup<{ [Key in keyof TestCenterImportFormValue]: FormControl<TestCenterImportFormValue[Key]> }>;

const importOptionKeys: (keyof ImportOptions)[] = [
  'responses', 'definitions', 'units', 'player', 'codings', 'logs', 'testTakers', 'booklets', 'metadata'
];
const fileOptionKeys: (keyof ImportOptions)[] = ['definitions', 'units', 'player', 'codings', 'booklets', 'testTakers', 'metadata'];

export function createTestCenterLoginForm(): TestCenterLoginForm {
  const fb = new FormBuilder().nonNullable;
  return fb.group({
    name: fb.control('', [Validators.required, Validators.minLength(1)]),
    pw: fb.control('', [Validators.required, Validators.minLength(1)]),
    testCenter: fb.control<number | ''>('', [Validators.required]),
    testCenterIndividual: fb.control({ value: '', disabled: true }, [Validators.required])
  });
}

export function createTestCenterImportForm(): TestCenterImportForm {
  const fb = new FormBuilder().nonNullable;
  return fb.group({
    workspace: fb.control('', [Validators.required]),
    responses: fb.control(false),
    definitions: fb.control(false),
    units: fb.control(false),
    player: fb.control(false),
    codings: fb.control(false),
    logs: fb.control(false),
    responseOverwriteMode: fb.control<TestResultsOverwriteMode>('skip'),
    testTakers: fb.control(false),
    booklets: fb.control(false),
    metadata: fb.control(false)
  });
}

export function updateIndividualTestCenterControl(form: TestCenterLoginForm, testCenter: number): void {
  if (testCenter === 6) form.controls.testCenterIndividual.enable();
  else form.controls.testCenterIndividual.disable();
}

export function selectTestCenterImportOptions(form: TestCenterImportForm, importType: string): void {
  const keys: (keyof ImportOptions)[] = importType === 'testResults' ? ['responses', 'logs'] : fileOptionKeys;
  keys.forEach(key => form.controls[key].setValue(true));
}

export function clearTestCenterImportOptions(form: TestCenterImportForm): void {
  importOptionKeys.forEach(key => form.controls[key].setValue(false));
}
