import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { CodingJobDefinitionDialogComponent } from './coding-job-definition-dialog.component';
import { Variable } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService, DistributionCalculationResponse } from '../../services/distributed-coding.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';

describe('CodingJobDefinitionDialogComponent in zoneless mode', () => {
  let fixture: ComponentFixture<CodingJobDefinitionDialogComponent>;
  let preview: Subject<DistributionCalculationResponse>;
  let calculateDistribution: jest.Mock;

  beforeEach(async () => {
    preview = new Subject<DistributionCalculationResponse>();
    calculateDistribution = jest.fn().mockReturnValue(preview.asObservable());
    // Each of six people has a response to all three variables in the bundle.
    const variables: Variable[] = ['V1', 'V2', 'V3'].map(variableId => ({
      unitName: 'U1',
      variableId,
      responseCount: 6,
      availableCases: 6,
      uniqueCasesAfterAggregation: 6,
      deriveErrorResponseCount: 2,
      availableCasesWithDeriveError: 8,
      uniqueCasesAfterAggregationWithDeriveError: 8
    }));

    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        FormBuilder,
        { provide: MAT_DIALOG_DATA, useValue: { isEdit: false, mode: 'definition' } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, needsReAuthentication: false } },
        {
          provide: CodingJobBackendService,
          useValue: {
            getJobDefinitions: () => of([]),
            getCodingIncompleteVariables: () => of(variables),
            getManualCodingScopeSummary: () => of(null),
            getVariableBundles: () => of([{ id: 1, name: 'Three variables per person', variables }])
          }
        },
        { provide: DistributedCodingService, useValue: { calculateDistribution } },
        { provide: CoderService, useValue: { getCoders: () => of([{ id: 1, name: 'Coder' }]) } },
        { provide: CodingJobService, useValue: { jobsCreatedEvent: new Subject<void>() } },
        { provide: TestPersonCodingService, useValue: { autoCodingCompleted$: new Subject<void>() } },
        { provide: MissingsProfileService, useValue: { getMissingsProfiles: () => of([]) } },
        { provide: WorkspaceSettingsService, useValue: { getIncludeDeriveErrorInManualCoding: () => of(false) } },
        {
          provide: SessionRecoveryService,
          useValue: {
            restore$: new Subject<void>(),
            registerProvider: () => () => undefined,
            peekDraft: () => null
          }
        }
      ]
    }).overrideComponent(CodingJobDefinitionDialogComponent, {
      set: {
        imports: [],
        template: `
          <button id="select-bundle" (click)="toggleBundleSelection(variableBundles()[0])">Select bundle</button>
          <button id="select-coder" (click)="masterCoderToggle()">Select coder</button>
          <span id="cases">{{ getTotalCodingCases() }}</span>
          <span id="total-time">{{ getFormattedTotalTime() }}</span>
          <span id="time-per-coder">{{ getFormattedTimePerCoder() }}</span>
          <span id="selected-count">{{ selectedVariableValues().length }}</span>
          <span id="variable-selected">{{ isVariableSelected(variables()[0]) }}</span>
          <span id="availability">{{ variables()[0]?.availableCases }}</span>
          <span id="capacity">{{ availableCoders()[0]?.capacityPercent }}</span>
          <span id="bundle-ordering">{{ variableBundles()[0]?.caseOrderingMode }}</span>
        `
      }
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobDefinitionDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders distinct bundle cases after a delayed preview without another interaction', async () => {
    const selectBundle: HTMLButtonElement = fixture.nativeElement.querySelector('#select-bundle');
    const selectCoder: HTMLButtonElement = fixture.nativeElement.querySelector('#select-coder');
    selectBundle.click();
    selectCoder.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#cases').textContent).toBe('18');

    // Let the selection render and debounce finish before the backend replies.
    await new Promise(resolve => { setTimeout(resolve, 350); });
    await fixture.whenStable();
    expect(calculateDistribution).toHaveBeenCalledTimes(1);
    expect(calculateDistribution.mock.calls[0][5]).toEqual([
      expect.objectContaining({
        id: 1,
        variables: variablesForBundle()
      })
    ]);

    preview.next({
      distribution: { 'bundle:1': { Coder: 18 } },
      doubleCodingInfo: {
        'bundle:1': {
          totalCases: 18,
          distinctCases: 6,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 6,
          codingTasksTotal: 18,
          doubleCodedCasesPerCoder: {}
        }
      },
      aggregationInfo: { 'bundle:1': { uniqueCases: 6, totalResponses: 18 } },
      matchingFlags: [],
      warnings: [],
      tasksPerCoder: { 1: 18 }
    });
    preview.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('#cases').textContent).toBe('6');
    expect(fixture.nativeElement.querySelector('#total-time').textContent).toBe('0:18');
    expect(fixture.nativeElement.querySelector('#time-per-coder').textContent).toBe('0:18');
  });

  it('updates derived and rendered selection state for programmatic SelectionModel changes', async () => {
    const component = fixture.componentInstance;
    const selectedCount = computed(() => component.selectedVariableValues().length);
    expect(selectedCount()).toBe(0);

    component.selectedVariables().select(component.variables()[0]);
    expect(selectedCount()).toBe(1);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#selected-count').textContent).toBe('1');
    expect(fixture.nativeElement.querySelector('#variable-selected').textContent).toBe('true');

    component.selectedVariables().deselect(component.variables()[0]);
    expect(selectedCount()).toBe(0);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#selected-count').textContent).toBe('0');
    expect(fixture.nativeElement.querySelector('#variable-selected').textContent).toBe('false');
  });

  it('preserves derive-error opt-in and binds the selected variable to fresh rows after a backend reload', async () => {
    const component = fixture.componentInstance;
    component.includeDeriveErrorInManualCoding.set(true);
    const previousRow = component.variables()[0];
    const previousSelection = component.selectedVariables();
    component.selectedVariables().select(previousRow);
    component.setDeriveErrorIncluded(previousRow, true);
    const selectedCount = computed(() => component.selectedVariableValues().length);
    expect(selectedCount()).toBe(1);

    component.loadCodingIncompleteVariables(undefined, true);
    const currentRow = component.variables()[0];
    expect(currentRow).not.toBe(previousRow);
    expect(previousRow.includeDeriveError).toBe(false);
    expect(currentRow.includeDeriveError).toBe(true);
    expect(component.selectedVariableValues()).toEqual([currentRow]);
    expect(component.selectedVariableValues()[0]).toBe(currentRow);
    expect(component.selectedVariables().isSelected(currentRow)).toBe(true);

    previousSelection.select(component.variables()[1]);
    expect(selectedCount()).toBe(1);
    component.selectedVariables().deselect(currentRow);
    expect(selectedCount()).toBe(0);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#selected-count').textContent).toBe('0');
  });

  it('publishes immutable availability rows and keeps the current selected row', async () => {
    const component = fixture.componentInstance;
    const previousRows = component.variables();
    const previousRow = previousRows[0];
    component.selectedVariables().select(previousRow);
    const availableCases = computed(() => component.variables()[0].availableCases);
    expect(availableCases()).toBe(6);
    component.existingJobDefinitions.set([{ id: 2, plannedVariableUsage: { 'U1::V1': 2 } }] as never);

    component.applyJobDefinitionUsage();
    expect(availableCases()).toBe(4);
    expect(previousRow.availableCases).toBe(6);
    expect(component.variables()).not.toBe(previousRows);
    expect(component.selectedVariableValues()[0]).toBe(component.variables()[0]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#availability').textContent).toBe('4');
  });

  it('retains coder selection after a capacity update and toggles the current row without duplicates', async () => {
    const component = fixture.componentInstance;
    const previousCoder = component.availableCoders()[0];
    const otherCoder = { id: 2, name: 'Other coder', capacityPercent: 150 };
    component.availableCoders.update(coders => [...coders, { ...otherCoder, capacityPercent: 100 }]);
    component.selectedCoders.select(previousCoder, otherCoder);
    const capacity = computed(() => component.availableCoders()[0].capacityPercent);
    expect(capacity()).toBe(100);

    component.updateCoderCapacityPercent(previousCoder, 50);
    const currentCoder = component.availableCoders()[0];
    expect(capacity()).toBe(50);
    expect(previousCoder.capacityPercent).toBe(100);
    expect(component.selectedCoders.selected[0]).toBe(currentCoder);
    expect(component.selectedCoders.selected[1]).toBe(otherCoder);
    expect(component.getCoderCapacityPercent(component.selectedCoders.selected[1])).toBe(150);
    expect(component.selectedCoders.isSelected(currentCoder)).toBe(true);
    component.selectedCoders.toggle(currentCoder);
    expect(component.selectedCoders.selected).toEqual([otherCoder]);
    component.selectedCoders.select(previousCoder, currentCoder);
    expect(component.selectedCoders.selected).toHaveLength(2);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#capacity').textContent).toBe('50');
  });

  it('retains bundle selection across ordering and backend updates with current row identities', async () => {
    const component = fixture.componentInstance;
    component.toggleBundleSelection(component.variableBundles()[0]);
    const previousBundle = component.variableBundles()[0];
    const ordering = computed(() => component.variableBundles()[0].caseOrderingMode);
    expect(ordering()).toBe('continuous');

    component.setBundleOrderingMode(previousBundle, 'alternating');
    expect(ordering()).toBe('alternating');
    expect(previousBundle.caseOrderingMode).toBe('continuous');
    expect(component.selectedVariableBundles.selected[0]).toBe(component.variableBundles()[0]);
    component.loadVariableBundles();
    const currentBundle = component.variableBundles()[0];
    expect(ordering()).toBe('alternating');
    expect(component.selectedVariableBundles.selected[0]).toBe(currentBundle);
    expect(component.selectedVariableBundles.isSelected(currentBundle)).toBe(true);
    component.toggleBundleSelection(currentBundle);
    expect(component.selectedVariableBundles.selected).toHaveLength(0);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#bundle-ordering').textContent).toBe('alternating');
  });

  function variablesForBundle(): { unitName: string; variableId: string }[] {
    return ['V1', 'V2', 'V3'].map(variableId => ({ unitName: 'U1', variableId }));
  }
});
