import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { VariableBundleDialogComponent, VariableBundleGroupDialogData } from './variable-bundle-dialog.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { Variable } from '../../models/coding-job.model';

describe('VariableBundleDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<VariableBundleDialogComponent>;
  let variables: Subject<Variable[]>;
  let close: jest.Mock;

  const availableVariables: Variable[] = [
    { unitName: 'FirstUnit', variableId: 'V1', responseCount: 1 },
    { unitName: 'SecondUnit', variableId: 'V2', responseCount: 1 }
  ];

  const createComponent = async (data: VariableBundleGroupDialogData): Promise<void> => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(VariableBundleDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 20); });
  };

  const filterBy = async (placeholder: string, text: string): Promise<void> => {
    const input = fixture.nativeElement.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 350); });
    await fixture.whenStable();
  };

  const buttonByText = (text: string): HTMLButtonElement => Array.from(
    fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
  ).find(button => button.textContent?.includes(text))!;

  beforeEach(async () => {
    variables = new Subject<Variable[]>();
    close = jest.fn();
    await TestBed.configureTestingModule({
      imports: [VariableBundleDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { isEdit: false } },
        { provide: CodingJobBackendService, useValue: { getCodingIncompleteVariables: () => variables } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } }
      ]
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it.each(['Enter', ' '])('preserves native keyboard behavior of a nested checkbox with %p', async key => {
    await createComponent({ isEdit: false, preloadedIncompleteVariables: availableVariables });
    const checkbox = fixture.nativeElement.querySelector('.variable-card input[type="checkbox"]') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    checkbox.dispatchEvent(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.selectedVariables.selected).toEqual([]);
    checkbox.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedVariables.selected).toEqual([availableVariables[0]]);
  });

  it('updates filtered cards after the debounce and selects only visible variables', async () => {
    await createComponent({ isEdit: false, preloadedIncompleteVariables: availableVariables });
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(2);

    await filterBy('Filter nach Aufgaben-ID', 'FirstUnit');
    expect(fixture.componentInstance.dataSource.filteredData).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.variable-card').textContent).toContain('FirstUnit_V1');

    buttonByText('Alle auswählen').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedVariables.selected).toEqual([availableVariables[0]]);
    expect(fixture.nativeElement.querySelector('.selection-count').textContent).toContain('1 von 1');
    expect(fixture.nativeElement.querySelector('.variable-card').classList.contains('selected')).toBe(true);
    fixture.componentInstance.onSubmit();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ variables: [availableVariables[0]] }));
  });

  it('updates the variable filter and restores the cards when filters are cleared', async () => {
    await createComponent({ isEdit: false, preloadedIncompleteVariables: availableVariables });
    await filterBy('Filter nach Variablen-ID', 'V2');
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.variable-card').textContent).toContain('SecondUnit_V2');

    await filterBy('Filter nach Variablen-ID', 'missing');
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(0);
    buttonByText('Alle auswählen').click();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedVariables.selected).toHaveLength(0);

    buttonByText('Filter zurücksetzen').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(2);
  });

  it('renders a delayed variable response without another interaction', async () => {
    await createComponent({ isEdit: false });
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    variables.next(availableVariables);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(2);
  });

  it('keeps a valid bundle open when applying, clearing or resetting filters', async () => {
    await createComponent({ isEdit: false, preloadedIncompleteVariables: availableVariables });
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLDivElement>('.variable-card')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.bundleGroupForm.valid).toBe(true);

    await filterBy('Filter nach Aufgaben-ID', 'FirstUnit');
    buttonByText('Filter anwenden').click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!.click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();

    await filterBy('Filter nach Variablen-ID', 'V1');
    element.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!.click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    buttonByText('Filter zurücksetzen').click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.variable-card')).toHaveLength(2);
    expect(fixture.componentInstance.selectedVariables.selected).toEqual([availableVariables[0]]);

    buttonByText('Erstellen').click();
    await fixture.whenStable();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ variables: [availableVariables[0]] }));
  });

  it('renders an empty state after a delayed empty response', async () => {
    await createComponent({ isEdit: false });
    variables.next([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state').textContent).toContain('Keine Variablen verfügbar');
  });

  it('removes the loading indicator after a delayed variable request error', async () => {
    await createComponent({ isEdit: false });
    variables.error(new Error('Network failed'));
    await fixture.whenStable();
    expect(fixture.componentInstance.isLoadingVariableAnalysis()).toBe(false);
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
  });
});
