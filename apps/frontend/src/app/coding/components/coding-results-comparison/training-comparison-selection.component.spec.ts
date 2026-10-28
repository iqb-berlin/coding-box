import { FormControl } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { TrainingComparisonSelectionComponent } from './training-comparison-selection.component';
import { CoderTraining } from '../../models/coder-training.model';

it('preserves the checkbox and keyboard focus when training objects are refreshed', async () => {
  TestBed.configureTestingModule({ imports: [TrainingComparisonSelectionComponent, TranslateModule.forRoot()] });
  const fixture = TestBed.createComponent(TrainingComparisonSelectionComponent);
  const training: CoderTraining = {
    id: 7,
    workspace_id: 5,
    label: 'Training',
    jobsCount: 1,
    created_at: new Date(),
    updated_at: new Date()
  };
  const inputs = {
    mode: 'between-trainings',
    trainings: [training],
    filteredTrainings: [training],
    selectedTrainings: [7],
    betweenCoders: [],
    withinCoders: [],
    betweenControl: new FormControl<string[]>([]),
    withinControl: new FormControl<number[]>([])
  };
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;
  checkbox.focus();
  expect(document.activeElement).toBe(checkbox);
  fixture.componentRef.setInput('filteredTrainings', [{ ...training, label: 'Updated training' }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBe(checkbox);
  expect(document.activeElement).toBe(checkbox);
  expect(checkbox.checked).toBe(true);
  expect(fixture.nativeElement.textContent).toContain('Updated training');
});
