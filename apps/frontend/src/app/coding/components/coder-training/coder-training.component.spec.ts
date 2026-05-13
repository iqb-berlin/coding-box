import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { CoderTrainingComponent } from './coder-training.component';
import { CoderService } from '../../services/coder.service';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { AppService } from '../../../core/services/app.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';

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
  let codingJobBackendService: Record<string, jest.Mock>;
  let codingTrainingBackendService: Record<string, jest.Mock>;

  beforeEach(async () => {
    coderService = createDependencyMock();
    codingJobBackendService = createDependencyMock();
    codingTrainingBackendService = createDependencyMock();
    const variableBundleService = createDependencyMock();

    coderService.getCoders.mockReturnValue(of([
      { id: 1, name: 'Coder 1', username: 'coder1' },
      { id: 2, name: 'Coder 2', username: 'coder2' }
    ]));
    codingJobBackendService.getCodingIncompleteVariables.mockReturnValue(of([
      {
        unitName: 'UNIT', variableId: 'VAR', responseCount: 10, uniqueCasesAfterAggregation: 8
      },
      { unitName: 'UNIT2', variableId: 'VAR2', responseCount: 4 },
      {
        unitName: 'UNIT3', variableId: 'DERIVED', responseCount: 6, uniqueCasesAfterAggregation: 6, isDerived: true
      }
    ]));
    codingTrainingBackendService.getCoderTrainings.mockReturnValue(of([{ id: 99, label: 'Other' }]));
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
        }
      ],
      total: 1
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
        unitName: 'UNIT', variableId: 'VAR', responseCount: 10, uniqueCasesAfterAggregation: 8
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
      }
    ] as never;
    component.coders = [
      { id: 1, name: 'Coder 1', username: 'coder1' },
      { id: 2, name: 'Coder 2', username: 'coder2' }
    ] as never;
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
          caseOrderingMode: 'continuous'
        }
      ],
      'continuous',
      'oldest_first',
      undefined,
      undefined
    );
  });
});
