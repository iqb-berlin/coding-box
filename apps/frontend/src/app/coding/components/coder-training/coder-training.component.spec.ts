import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormGroup } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { CoderTrainingComponent } from './coder-training.component';
import { CoderService } from '../../services/coder.service';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';

const createDependencyMock = (): Record<string, jest.Mock> => new Proxy({} as Record<string, jest.Mock>, {
  get(target, property: string) {
    if (!target[property]) {
      target[property] = jest.fn().mockReturnValue(of({ success: true, message: 'ok', jobsCreated: 1 }));
    }
    return target[property];
  }
}) as Record<string, jest.Mock>;

describe('CoderTrainingComponent', () => {
  let fixture: ComponentFixture<CoderTrainingComponent>;
  let component: CoderTrainingComponent;
  let coderService: Record<string, jest.Mock>;
  let variableBundleService: Record<string, jest.Mock>;
  let codingJobBackendService: Record<string, jest.Mock>;
  let codingTrainingBackendService: Record<string, jest.Mock>;

  beforeEach(async () => {
    coderService = createDependencyMock();
    codingJobBackendService = createDependencyMock();
    codingTrainingBackendService = createDependencyMock();
    variableBundleService = createDependencyMock();

    coderService.getCoders.mockReturnValue(of([
      { id: 1, name: 'Coder 1', username: 'coder1' },
      { id: 2, name: 'Coder 2', username: 'coder2' }
    ]));
    codingJobBackendService.getCodingIncompleteVariables.mockReturnValue(of([
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        responseCount: 10,
        uniqueCasesAfterAggregation: 8,
        uniqueCasesAfterAggregationWithDeriveError: 9,
        deriveErrorResponseCount: 2
      },
      { unitName: 'UNIT2', variableId: 'VAR2', responseCount: 4 },
      {
        unitName: 'UNIT3', variableId: 'DERIVED', responseCount: 6, uniqueCasesAfterAggregation: 6, isDerived: true
      }
    ]));
    codingTrainingBackendService.getCoderTrainings.mockReturnValue(of([{
      id: 99,
      workspace_id: 1,
      label: 'Other',
      created_at: new Date('2026-05-13T09:00:00'),
      updated_at: new Date('2026-05-13T09:00:00'),
      jobsCount: 1
    }]));
    variableBundleService.getBundles.mockReturnValue(of({
      bundles: [
        {
          id: 5,
          name: 'Bundle',
          description: 'Bundle description',
          variables: [
            { unitName: 'UNIT2', variableId: 'VAR2' },
            { unitName: 'UNIT3', variableId: 'DERIVED' }
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
          caseOrderingMode: 'alternating'
        },
        {
          id: 6,
          name: 'Derived Bundle',
          description: 'Derived only',
          variables: [
            { unitName: 'UNIT3', variableId: 'DERIVED' }
          ],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      total: 2
    }));

    await TestBed.configureTestingModule({
      imports: [
        CoderTrainingComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: CoderService, useValue: coderService },
        { provide: VariableBundleService, useValue: variableBundleService },
        { provide: CodingJobBackendService, useValue: codingJobBackendService },
        { provide: CodingTrainingBackendService, useValue: codingTrainingBackendService },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: BackendMessageTranslatorService, useValue: { translateMessage: jest.fn((message: string) => message) } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoderTrainingComponent);
    component = fixture.componentInstance;
    component.availableVariables = [
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        responseCount: 10,
        uniqueCasesAfterAggregation: 8,
        uniqueCasesAfterAggregationWithDeriveError: 9,
        deriveErrorResponseCount: 2
      },
      { unitName: 'UNIT2', variableId: 'VAR2', responseCount: 4 },
      {
        unitName: 'UNIT3', variableId: 'DERIVED', responseCount: 6, uniqueCasesAfterAggregation: 6, isDerived: true
      }
    ] as never;
    component.availableBundles = [
      {
        id: 5,
        name: 'Bundle',
        description: 'Bundle description',
        variables: [
          { unitName: 'UNIT2', variableId: 'VAR2' },
          { unitName: 'UNIT3', variableId: 'DERIVED' }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        caseOrderingMode: 'alternating'
      },
      {
        id: 6,
        name: 'Derived Bundle',
        description: 'Derived only',
        variables: [
          { unitName: 'UNIT3', variableId: 'DERIVED' }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ] as never;
    component.coders = [
      { id: 1, name: 'Coder 1', username: 'coder1' },
      { id: 2, name: 'Coder 2', username: 'coder2' }
    ] as never;
  });

  afterEach(() => {
    TestBed.inject(SessionRecoveryService).clearAllDrafts();
  });

  it('covers the common training selection workflow', () => {
    component.ngOnInit();
    component.addVariable('VAR', 'UNIT', 3);
    component.onVariableChange('VAR2', 0);
    component.onVariablesSelectionChange(['UNIT::VAR', 'UNIT2::VAR2']);
    component.addBundleVariables(5, 2, 'alternating');
    component.onBundleSelectionChange([5]);
    component.updateBundleSampleCount(5, 2);
    component.updateBundleCaseOrderingMode(5, 'continuous');

    component.toggleCoderSelection(component.coders[0]);
    component.selectAllCoders();
    component.trainingForm.get('trainingLabel')?.setValue('Training');

    expect(component.isCoderSelected(component.coders[0])).toBe(true);
    expect(component.getSelectedCoders()).toHaveLength(2);
    expect(component.hasAtLeastOneVariableSelected()).toBe(true);
    expect(component.getTotalSamples()).toBeGreaterThan(0);
    expect(component.getBundleName(5)).toBe('Bundle');
    expect(component.getBundleSampleCount(5)).toBeGreaterThan(0);
    expect(component.selectedBundleArray).toContain(5);
    expect(component.selectedManualVariableIds).toContain('VAR');
    expect(component.groupedVariables).toBeDefined();
    expect(component.getVariablesGroupedByBundle().bundles).toBeDefined();
    expect(component.trackByCoderId(0, component.coders[0])).toBe(1);
    expect(component.canStartTraining()).toBe(true);

    component.onStartTraining();

    expect(codingTrainingBackendService.createCoderTrainingJobs).toHaveBeenCalled();
  });

  it('keeps the bundle sample input mounted while updating its value', () => {
    component.onBundleSelectionChange([5]);
    fixture.detectChanges();
    const bundleGroup = component.groupedVariables.bundles[0];
    const sampleInput = fixture.nativeElement.querySelector(
      '.bundle-sample-field input'
    ) as HTMLInputElement;
    sampleInput.focus();
    sampleInput.value = '3';

    sampleInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.groupedVariables.bundles[0]).toBe(bundleGroup);
    expect(
      fixture.nativeElement.querySelector('.bundle-sample-field input')
    ).toBe(sampleInput);
    expect(document.activeElement).toBe(sampleInput);
    expect(
      component.variablesFormArray.controls
        .filter(control => control.get('bundleId')?.value === 5)
        .map(control => control.get('sampleCount')?.value)
    ).toEqual([3, 3]);
  });

  it('renders coder selection as toggle cards without checkboxes', () => {
    fixture.detectChanges();

    const firstCoderCard = fixture.nativeElement.querySelector('.coder-grid .coder-item') as HTMLElement;

    expect(fixture.nativeElement.querySelector('.coder-grid mat-checkbox')).toBeNull();
    expect(firstCoderCard.classList.contains('selected')).toBe(false);
    expect(firstCoderCard.querySelector('.coder-login')).toBeNull();

    firstCoderCard.click();
    fixture.detectChanges();

    const selectedCoderCard = fixture.nativeElement.querySelector('.coder-grid .coder-item') as HTMLElement;

    expect(component.isCoderSelected(component.coders[0])).toBe(true);
    expect(selectedCoderCard.classList.contains('selected')).toBe(true);
    expect(selectedCoderCard.querySelector('.selected-icon')).not.toBeNull();
  });

  it('covers removal, validation and error paths', () => {
    coderService.getCoders.mockReturnValueOnce(throwError(() => new Error('load failed')));
    component.loadCoders();
    component.addBundleVariables(999);
    component.addBundleVariables(5, 0);
    component.addVariable('VAR', 'UNIT', 99);

    const manualGroup = { control: component.variablesFormArray.at(0) } as never;
    expect(component.isManualVariableInsufficient(manualGroup)).toBe(true);
    expect(component.getAvailableCount(manualGroup)).toBe(8);
    expect(component.hasInsufficientCases({ variables: [manualGroup] })).toBe(true);
    expect(component.isVariableSelected('VAR')).toBe(true);

    component.removeVariable(0);
    component.deselectAllCoders();
    component.removeBundle(5);
    component.onBundleRemoved(5);
    component.onClose();
    component.ngOnDestroy();

    expect(component.canStartTraining()).toBe(false);
  });

  it('includes derived variables by default and marks them', () => {
    expect(component.includeDerivedVariables).toBe(true);
    expect(component.getDerivedVariablesCount()).toBe(1);
    expect(component.isVariableDerived({ unitName: 'UNIT3', variableId: 'DERIVED' })).toBe(true);
    expect(component.getBundleDerivedVariablesCount(component.availableBundles[0])).toBe(1);

    component.addVariable('DERIVED', 'UNIT3', 2);

    expect(component.getSelectedDerivedVariablesCount()).toBe(1);
    expect(component.isControlDerived(component.variablesFormArray.at(0) as never)).toBe(true);
  });

  it('warns about duplicate training labels without blocking the workflow', () => {
    component.availableTrainings = [
      {
        id: 10,
        workspace_id: 1,
        label: 'Training',
        created_at: new Date('2026-05-13T10:00:00'),
        updated_at: new Date('2026-05-13T10:00:00'),
        jobsCount: 2
      }
    ];
    component.selectAllCoders();
    component.addVariable('VAR', 'UNIT', 1);
    component.trainingForm.get('trainingLabel')?.setValue('  Training  ');

    expect(component.hasDuplicateTrainingLabel()).toBe(true);
    expect(component.getDuplicateTrainingLabelWarning()).toContain('ID 10');
    expect(component.getDuplicateTrainingLabelWarning()).toContain('trotzdem erstellt');
    expect(component.canStartTraining()).toBe(true);
  });

  it('formats reference training options with stable disambiguation data', () => {
    const training = {
      id: 33,
      workspace_id: 1,
      label: 'Duplicate Label',
      created_at: new Date('2026-05-13T11:36:00'),
      updated_at: new Date('2026-05-13T11:36:00'),
      jobsCount: 2
    };

    expect(component.getTrainingOptionTitle(training)).toBe('Duplicate Label · ID 33');
    expect(component.getTrainingOptionMeta(training)).toContain('2 Jobs');
  });

  it('removes derived variables when they are excluded', () => {
    component.onVariablesSelectionChange(['UNIT::VAR', 'UNIT3::DERIVED']);

    expect(component.variablesFormArray.length).toBe(2);

    component.trainingForm.get('includeDerivedVariables')?.setValue(false);

    expect(component.includeDerivedVariables).toBe(false);
    expect(component.variablesFormArray.length).toBe(1);
    expect(component.variablesFormArray.at(0).get('variableId')?.value).toBe('VAR');
    expect(component.getSelectedDerivedVariablesCount()).toBe(0);
    expect(component.manualVariablesSelectControl.value).toEqual(['UNIT::VAR']);
  });

  it('selects all currently filtered manual variables and respects the derived filter', () => {
    component.variableFilterCtrl.setValue('VAR2');

    component.selectAllManualVariables();

    expect(component.manualVariablesSelectControl.value).toEqual(['UNIT2::VAR2']);
    expect(component.selectedManualVariableIds).toEqual(['VAR2']);

    component.variableFilterCtrl.setValue('');
    component.trainingForm.get('includeDerivedVariables')?.setValue(false);

    component.selectAllManualVariables();

    expect(new Set(component.manualVariablesSelectControl.value || [])).toEqual(new Set(['UNIT::VAR', 'UNIT2::VAR2']));
    expect(component.getSelectedDerivedVariablesCount()).toBe(0);
    expect(component.hasSelectableManualVariables()).toBe(false);
  });

  it('clears only manual variables and keeps bundle variables selected', () => {
    component.onVariablesSelectionChange(['UNIT::VAR']);
    component.onBundleSelectionChange([5]);

    expect(component.getManualVariablesCount()).toBe(1);
    expect(component.getBundleVariablesCount()).toBe(2);

    component.clearManualVariables();

    expect(component.getManualVariablesCount()).toBe(0);
    expect(component.getBundleVariablesCount()).toBe(2);
    expect(component.selectedBundleArray).toContain(5);
    expect(component.variablesFormArray.controls.every(control => control.get('bundleId')?.value === 5)).toBe(true);
  });

  it('keeps derived toggle synchronized after bulk selection and submits only included variables', () => {
    component.selectAllManualVariables();

    expect(component.getSelectedVariablesCount()).toBe(3);
    expect(component.getSelectedDerivedVariablesCount()).toBe(1);

    component.trainingForm.get('includeDerivedVariables')?.setValue(false);

    expect(component.getSelectedVariablesCount()).toBe(2);
    expect(component.getSelectedDerivedVariablesCount()).toBe(0);
    expect(new Set(component.manualVariablesSelectControl.value || [])).toEqual(new Set(['UNIT::VAR', 'UNIT2::VAR2']));

    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('Bulk Derived');

    component.onStartTraining();

    expect(codingTrainingBackendService.createCoderTrainingJobs).toHaveBeenCalledWith(
      1,
      [component.coders[0]],
      [
        { variableId: 'VAR', unitId: 'UNIT', sampleCount: 8 },
        { variableId: 'VAR2', unitId: 'UNIT2', sampleCount: 4 }
      ],
      'Bulk Derived',
      undefined,
      [
        { variableId: 'VAR', unitName: 'UNIT', sampleCount: 8 },
        { variableId: 'VAR2', unitName: 'UNIT2', sampleCount: 4 }
      ],
      [],
      'continuous',
      'oldest_first',
      undefined,
      undefined,
      false,
      true,
      false
    );
  });

  it('removes derived-only bundle selections when derived variables are excluded', () => {
    component.onBundleSelectionChange([6]);

    expect(component.variablesFormArray.length).toBe(1);
    expect(component.selectedBundleArray).toContain(6);

    component.trainingForm.get('includeDerivedVariables')?.setValue(false);
    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('Derived disabled');

    expect(component.variablesFormArray.length).toBe(0);
    expect(component.selectedBundleArray).not.toContain(6);
    expect(component.canStartTraining()).toBe(false);
    expect(component.getFirstValidationMessage()).toBe('Mindestens eine Variable ausgewählt');
  });

  it('requires a reference mode when reference trainings are selected', () => {
    component.addVariable('VAR', 'UNIT', 2);
    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('Reference validation');

    expect(component.canStartTraining()).toBe(true);

    component.trainingForm.get('referenceTrainingIds')?.setValue([99]);

    expect(component.hasValidReferenceMode()).toBe(false);
    expect(component.canStartTraining()).toBe(false);

    component.trainingForm.get('referenceMode')?.setValue('same');

    expect(component.hasValidReferenceMode()).toBe(true);
    expect(component.canStartTraining()).toBe(true);

    component.trainingForm.get('referenceTrainingIds')?.setValue([]);

    expect(component.trainingForm.get('referenceMode')?.value).toBeNull();
    expect(component.hasValidReferenceMode()).toBe(true);
  });

  it('shows edit action labels and consistent summary counts', () => {
    component.editTraining = { id: 1, label: 'Existing training' } as never;
    component.addVariable('VAR', 'UNIT', 2);
    component.onBundleSelectionChange([5]);

    expect(component.getDialogTitle()).toBe('Kodierer-Schulung bearbeiten');
    expect(component.getPrimaryActionLabel()).toBe('Schulung aktualisieren');
    expect(component.getManualVariablesCount()).toBe(1);
    expect(component.getBundleVariablesCount()).toBe(2);
    expect(component.getSelectedVariablesCount()).toBe(3);
    expect(component.getSelectedBundleCount()).toBe(1);
    expect(component.hasBundleOrderingOverrides()).toBe(false);

    component.updateBundleCaseOrderingMode(5, 'alternating');

    expect(component.hasBundleOrderingOverrides()).toBe(true);
    expect(component.getBundleOrderingDetails()).toContain('Bundle: Abwechselnd');

    component.isLoading = true;

    expect(component.getPrimaryActionLabel()).toBe('Schulung wird aktualisiert...');
  });

  it('populates saved edit settings even when no variables or bundles are available', () => {
    codingJobBackendService.getCodingIncompleteVariables.mockReturnValueOnce(of([]));
    variableBundleService.getBundles.mockReturnValueOnce(of({ bundles: [], total: 0 }));
    component.editTraining = {
      id: 80,
      workspace_id: 1,
      label: 'Saved empty training',
      case_ordering_mode: 'alternating',
      case_selection_mode: 'random',
      reference_training_ids: [99],
      reference_mode: 'same',
      suppress_general_instructions: true,
      assigned_coders: [2],
      assigned_variables: [],
      assigned_variable_bundles: [],
      jobsCount: 1,
      created_at: new Date(),
      updated_at: new Date()
    };

    component.ngOnInit();

    expect(component.trainingForm.get('trainingLabel')?.value).toBe('Saved empty training');
    expect(component.trainingForm.get('caseOrderingMode')?.value).toBe('alternating');
    expect(component.trainingForm.get('caseSelectionMode')?.value).toBe('random');
    expect(component.trainingForm.get('referenceTrainingIds')?.value).toEqual([99]);
    expect(component.trainingForm.get('referenceMode')?.value).toBe('same');
    expect(component.trainingForm.get('suppressGeneralInstructions')?.value).toBe(true);
    expect(component.isCoderSelected(component.coders[1])).toBe(true);
  });

  it('keeps saved manual variables when bundle loading fails while editing', () => {
    variableBundleService.getBundles.mockReturnValueOnce(throwError(() => new Error('bundle load failed')));
    component.editTraining = {
      id: 81,
      workspace_id: 1,
      label: 'Manual variables only',
      case_ordering_mode: 'continuous',
      assigned_coders: [1],
      assigned_variables: [
        {
          unitName: 'UNIT',
          variableId: 'VAR',
          sampleCount: 3
        }
      ],
      assigned_variable_bundles: [],
      jobsCount: 1,
      created_at: new Date(),
      updated_at: new Date()
    };

    component.ngOnInit();

    expect(component.trainingForm.get('trainingLabel')?.value).toBe('Manual variables only');
    expect(component.variablesFormArray.length).toBe(1);
    expect(component.variablesFormArray.at(0).get('unitId')?.value).toBe('UNIT');
    expect(component.variablesFormArray.at(0).get('variableId')?.value).toBe('VAR');
    expect(component.variablesFormArray.at(0).get('sampleCount')?.value).toBe(3);
  });

  it('preserves saved bundle ordering when editing and updating a training', () => {
    component.editTraining = {
      id: 77,
      workspace_id: 1,
      label: 'Existing training',
      case_ordering_mode: 'continuous',
      assigned_coders: [1],
      assigned_variables: [],
      assigned_variable_bundles: [
        {
          id: 5,
          name: 'Bundle',
          sampleCount: 4,
          caseOrderingMode: 'alternating'
        }
      ],
      jobsCount: 1,
      created_at: new Date(),
      updated_at: new Date()
    } as never;

    (component as unknown as { populateFormFromTraining: () => void }).populateFormFromTraining();

    expect(component.getSelectedBundleCount()).toBe(1);
    expect(component.getBundleOrderingOverrides()).toEqual([
      { name: 'Bundle', label: 'Abwechselnd' }
    ]);
    expect(component.variablesFormArray.at(0).get('bundleCaseOrderingMode')?.value).toBe('alternating');

    component.onVariablesSelectionChange(['UNIT::VAR']);
    component.onStartTraining();

    expect(codingTrainingBackendService.updateCoderTraining).toHaveBeenCalled();
    const updateCall = codingTrainingBackendService.updateCoderTraining.mock.calls[0];
    expect(updateCall[7]).toEqual([
      {
        id: 5,
        name: 'Bundle',
        sampleCount: 4,
        caseOrderingMode: 'alternating',
        variables: [
          { unitName: 'UNIT2', variableId: 'VAR2', sampleCount: 4 },
          { unitName: 'UNIT3', variableId: 'DERIVED', sampleCount: 4 }
        ]
      }
    ]);
    expect(updateCall[8]).toBe('continuous');
  });

  it('preserves saved case selection and reference options when editing a training', () => {
    component.editTraining = {
      id: 78,
      workspace_id: 1,
      label: 'Reference training',
      case_ordering_mode: 'continuous',
      case_selection_mode: 'random_per_testgroup',
      reference_training_ids: [99],
      reference_mode: 'different',
      assigned_coders: [1],
      assigned_variables: [
        {
          unitName: 'UNIT',
          variableId: 'VAR',
          sampleCount: 2
        }
      ],
      assigned_variable_bundles: [],
      jobsCount: 1,
      created_at: new Date(),
      updated_at: new Date()
    } as never;

    (component as unknown as { populateFormFromTraining: () => void }).populateFormFromTraining();

    expect(component.trainingForm.get('caseSelectionMode')?.value).toBe('random_per_testgroup');
    expect(component.trainingForm.get('referenceTrainingIds')?.value).toEqual([99]);
    expect(component.trainingForm.get('referenceMode')?.value).toBe('different');

    component.onStartTraining();

    expect(codingTrainingBackendService.updateCoderTraining).toHaveBeenCalled();
    const updateCall = codingTrainingBackendService.updateCoderTraining.mock.calls[0];
    expect(updateCall[9]).toBe('random_per_testgroup');
    expect(updateCall[10]).toEqual([99]);
    expect(updateCall[11]).toBe('different');
  });

  it('submits an empty reference list when references are cleared while editing', () => {
    component.editTraining = {
      id: 79,
      workspace_id: 1,
      label: 'Clear references',
      case_ordering_mode: 'continuous',
      case_selection_mode: 'oldest_first',
      reference_training_ids: [99],
      reference_mode: 'same',
      assigned_coders: [1],
      assigned_variables: [
        {
          unitName: 'UNIT',
          variableId: 'VAR',
          sampleCount: 2
        }
      ],
      assigned_variable_bundles: [],
      jobsCount: 1,
      created_at: new Date(),
      updated_at: new Date()
    } as never;

    (component as unknown as { populateFormFromTraining: () => void }).populateFormFromTraining();

    component.trainingForm.get('referenceTrainingIds')?.setValue([]);
    component.onStartTraining();

    expect(codingTrainingBackendService.updateCoderTraining).toHaveBeenCalled();
    const updateCall = codingTrainingBackendService.updateCoderTraining.mock.calls[0];
    expect(updateCall[10]).toEqual([]);
    expect(updateCall[11]).toBeUndefined();
  });

  it('skips derived variables from bundles when disabled and submits only included variables', () => {
    component.trainingForm.get('includeDerivedVariables')?.setValue(false);
    component.onBundleSelectionChange([5]);
    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('No Derived');

    expect(component.variablesFormArray.length).toBe(1);
    expect(component.variablesFormArray.at(0).get('variableId')?.value).toBe('VAR2');
    expect(component.canStartTraining()).toBe(true);

    component.onStartTraining();

    expect(codingTrainingBackendService.createCoderTrainingJobs).toHaveBeenCalledWith(
      1,
      [component.coders[0]],
      [{ variableId: 'VAR2', unitId: 'UNIT2', sampleCount: 4 }],
      'No Derived',
      undefined,
      [],
      [
        {
          id: 5,
          name: 'Bundle',
          sampleCount: 4,
          caseOrderingMode: 'continuous',
          variables: [
            { unitName: 'UNIT2', variableId: 'VAR2', sampleCount: 4 }
          ]
        }
      ],
      'continuous',
      'oldest_first',
      undefined,
      undefined,
      false,
      true,
      false
    );
  });

  it('submits manual variables and variable bundles together for training jobs', () => {
    component.trainingForm.get('includeDerivedVariables')?.setValue(false);
    component.onVariablesSelectionChange(['UNIT::VAR']);
    component.onBundleSelectionChange([5]);
    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('Mixed Selection');

    expect(component.getManualVariablesCount()).toBe(1);
    expect(component.getBundleVariablesCount()).toBe(1);
    expect(component.canStartTraining()).toBe(true);

    component.onStartTraining();

    expect(codingTrainingBackendService.createCoderTrainingJobs).toHaveBeenCalledWith(
      1,
      [component.coders[0]],
      [
        { variableId: 'VAR', unitId: 'UNIT', sampleCount: 8 },
        { variableId: 'VAR2', unitId: 'UNIT2', sampleCount: 4 }
      ],
      'Mixed Selection',
      undefined,
      [
        { variableId: 'VAR', unitName: 'UNIT', sampleCount: 8 }
      ],
      [
        {
          id: 5,
          name: 'Bundle',
          sampleCount: 4,
          caseOrderingMode: 'continuous',
          variables: [
            { unitName: 'UNIT2', variableId: 'VAR2', sampleCount: 4 }
          ]
        }
      ],
      'continuous',
      'oldest_first',
      undefined,
      undefined,
      false,
      true,
      false
    );
  });

  it('submits DERIVE_ERROR opt-in for selected training variables', () => {
    component.onVariablesSelectionChange(['UNIT::VAR']);
    const variableControl = component.variablesFormArray.at(0) as FormGroup;
    component.setDeriveErrorIncludedForControl(variableControl, true);
    expect(component.getAvailableCount({ control: variableControl })).toBe(9);
    component.toggleCoderSelection(component.coders[0]);
    component.trainingForm.get('trainingLabel')?.setValue('Derive opt-in');

    component.onStartTraining();

    expect(codingTrainingBackendService.createCoderTrainingJobs).toHaveBeenCalledWith(
      1,
      [component.coders[0]],
      [{
        variableId: 'VAR',
        unitId: 'UNIT',
        sampleCount: 8,
        includeDeriveError: true
      }],
      'Derive opt-in',
      undefined,
      [{
        variableId: 'VAR',
        unitName: 'UNIT',
        sampleCount: 8,
        includeDeriveError: true
      }],
      [],
      'continuous',
      'oldest_first',
      undefined,
      undefined,
      false,
      true,
      false
    );
  });

  it('preserves bundle ordering overrides when importing a job definition', () => {
    component.availableBundles = [
      {
        id: 5,
        name: 'Bundle',
        description: 'Bundle description',
        variables: [
          { unitName: 'UNIT2', variableId: 'VAR2' }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ] as never;

    (component as unknown as {
      importJobDefinitionSelections: (
        jobDef: {
          assignedVariables?: never[];
          assignedVariableBundles: Array<{
            id: number;
            name: string;
            caseOrderingMode: 'continuous' | 'alternating';
            variables?: Array<{ unitName: string; variableId: string; includeDeriveError?: boolean }>;
          }>;
        },
        defaultSampleCount: number
      ) => void;
    }).importJobDefinitionSelections({
      assignedVariables: [],
      assignedVariableBundles: [
        {
          id: 5,
          name: 'Bundle',
          caseOrderingMode: 'alternating',
          variables: [{ unitName: 'UNIT2', variableId: 'VAR2', includeDeriveError: true }]
        }
      ]
    }, 2);

    expect(component.getSelectedBundleCount()).toBe(1);
    expect(component.getBundleOrderingOverrides()).toEqual([
      { name: 'Bundle', label: 'Abwechselnd' }
    ]);
    expect(component.variablesFormArray.at(0).get('bundleCaseOrderingMode')?.value).toBe('alternating');
    expect(component.variablesFormArray.at(0).get('includeDeriveError')?.value).toBe(true);
  });

  it('restores an active training draft after reauthentication', () => {
    const sessionRecoveryService = TestBed.inject(SessionRecoveryService);
    sessionRecoveryService.clearAllDrafts();

    component.ngOnInit();
    component.trainingForm.patchValue({
      trainingLabel: 'Recovered training',
      caseOrderingMode: 'alternating',
      caseSelectionMode: 'random',
      showScore: true,
      allowComments: false,
      suppressGeneralInstructions: true,
      includeDerivedVariables: true,
      referenceTrainingIds: [99],
      referenceMode: 'same'
    });
    component.toggleCoderSelection(component.coders[1]);
    component.onVariablesSelectionChange(['UNIT::VAR']);
    component.setDeriveErrorIncludedForControl(component.variablesFormArray.at(0) as FormGroup, true);
    component.onBundleSelectionChange([5]);
    component.updateBundleSampleCount(5, 3);
    component.updateBundleCaseOrderingMode(5, 'continuous');
    component.variableFilterCtrl.setValue('VAR', { emitEvent: false });
    component.bundleFilterCtrl.setValue('Derived', { emitEvent: false });

    sessionRecoveryService.captureRegisteredDrafts();
    expect(sessionRecoveryService.peekDraft('coder-training-active-state')).toEqual(expect.objectContaining({
      workspaceId: 1,
      mode: 'create',
      selectedCoderIds: [2],
      selectedBundleIds: [5],
      variableFilter: 'VAR',
      bundleFilter: 'Derived'
    }));

    fixture.destroy();
    fixture = TestBed.createComponent(CoderTrainingComponent);
    component = fixture.componentInstance;
    let restoredFilteredVariableKeys: string[] = [];
    let restoredFilteredBundleNames: string[] = [];
    component.filteredVariables$.subscribe(variables => {
      restoredFilteredVariableKeys = variables.map(variable => `${variable.unitName}::${variable.variableId}`);
    });
    component.filteredBundles$.subscribe(bundles => {
      restoredFilteredBundleNames = bundles.map(bundle => bundle.name);
    });
    component.ngOnInit();

    expect(component.trainingForm.get('trainingLabel')?.value).toBe('Recovered training');
    expect(component.trainingForm.get('caseOrderingMode')?.value).toBe('alternating');
    expect(component.trainingForm.get('caseSelectionMode')?.value).toBe('random');
    expect(component.trainingForm.get('showScore')?.value).toBe(true);
    expect(component.trainingForm.get('allowComments')?.value).toBe(false);
    expect(component.trainingForm.get('suppressGeneralInstructions')?.value).toBe(true);
    expect(component.trainingForm.get('referenceTrainingIds')?.value).toEqual([99]);
    expect(component.trainingForm.get('referenceMode')?.value).toBe('same');
    expect(component.selectedCoders.has(2)).toBe(true);
    expect(component.selectedBundleArray).toEqual([5]);
    expect(component.manualVariablesSelectControl.value).toEqual(['UNIT::VAR']);
    expect(component.variableFilterCtrl.value).toBe('VAR');
    expect(component.bundleFilterCtrl.value).toBe('Derived');
    expect(restoredFilteredVariableKeys).toEqual(['UNIT::VAR']);
    expect(restoredFilteredBundleNames).toEqual(['Derived Bundle']);
    expect(component.variablesFormArray.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: expect.objectContaining({
          unitId: 'UNIT',
          variableId: 'VAR',
          includeDeriveError: true
        })
      }),
      expect.objectContaining({
        value: expect.objectContaining({
          bundleId: 5,
          sampleCount: 3,
          bundleCaseOrderingMode: 'continuous'
        })
      })
    ]));
  });
});
