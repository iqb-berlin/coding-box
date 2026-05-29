import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { EventEmitter } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogModule
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CodingJobDefinitionDialogComponent, CodingJobDefinitionDialogData } from './coding-job-definition-dialog.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { CodingJob, Variable, VariableBundle } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';

describe('CodingJobDefinitionDialogComponent', () => {
  let component: CodingJobDefinitionDialogComponent;
  let fixture: ComponentFixture<CodingJobDefinitionDialogComponent>;
  let mockCodingJobBackendService: Partial<CodingJobBackendService>;
  let mockDistributedCodingService: Partial<DistributedCodingService>;
  let mockAppService: Partial<AppService>;
  let mockCoderService: Partial<CoderService>;
  let mockCodingJobService: Partial<CodingJobService>;
  let mockMissingsProfileService: Partial<MissingsProfileService>;
  let mockDialogRef: Partial<MatDialogRef<CodingJobDefinitionDialogComponent>>;
  let mockSnackBar: Partial<MatSnackBar>;
  let mockTranslateService: Partial<TranslateService>;
  let mockMatDialog: Partial<MatDialog>;

  const mockData: CodingJobDefinitionDialogData = {
    isEdit: false,
    mode: 'definition'
  };

  const mockVariables: Variable[] = [
    {
      unitName: 'Unit 1', variableId: 'Var 1', responseCount: 10, availableCases: 10, uniqueCasesAfterAggregation: 10
    },
    {
      unitName: 'Unit 2', variableId: 'Var 2', responseCount: 5, availableCases: 5, uniqueCasesAfterAggregation: 5
    },
    {
      unitName: 'Unit 3', variableId: 'Var 3', responseCount: 8, availableCases: 8, uniqueCasesAfterAggregation: 8
    }
  ];

  const mockBundles: VariableBundle[] = [
    {
      id: 1,
      name: 'Bundle 1',
      createdAt: new Date(),
      updatedAt: new Date(),
      variables: [
        { unitName: 'Unit 1', variableId: 'Var 1' },
        { unitName: 'Unit 3', variableId: 'Var 3' }
      ]
    }
  ];

  const mockCoders: Coder[] = [
    { id: 1, name: 'Coder 1' },
    { id: 2, name: 'Coder 2' }
  ];

  const cloneVariables = () => mockVariables.map(variable => ({ ...variable }));
  const cloneBundles = () => mockBundles.map(bundle => ({
    ...bundle,
    variables: bundle.variables.map(variable => ({ ...variable }))
  }));

  beforeEach(async () => {
    mockCodingJobBackendService = {
      getJobDefinitions: jest.fn().mockReturnValue(of([
        {
          id: 100,
          assignedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2', responseCount: 5 }],
          maxCodingCases: 5,
          plannedVariableUsage: { 'Unit 2::Var 2': 5 }
        },
        {
          id: 101,
          assignedVariables: [{ unitName: 'Unit 3', variableId: 'Var 3', responseCount: 8 }],
          maxCodingCases: 4,
          plannedVariableUsage: { 'Unit 3::Var 3': 4 }
        }
      ])),
      getCodingIncompleteVariables: jest.fn().mockImplementation(() => of(cloneVariables())),
      getManualCodingScopeSummary: jest.fn().mockReturnValue(of({
        manualVariableCount: cloneVariables().length,
        manualResponseCount: 18,
        coveredSourceVariableCount: 0,
        coveredSourceResponseCount: 0,
        coveredSourceVariables: []
      })),
      getVariableBundles: jest.fn().mockImplementation(() => of(cloneBundles())),
      updateCodingJob: jest.fn(),
      createJobDefinition: jest.fn(),
      createCodingJob: jest.fn(),
      updateJobDefinition: jest.fn()
    } as unknown as Partial<CodingJobBackendService>;

    mockDistributedCodingService = {
      createDistributedCodingJobs: jest.fn()
    } as unknown as Partial<DistributedCodingService>;

    mockAppService = {
      selectedWorkspaceId: 1
    };

    mockCoderService = {
      getCoders: jest.fn().mockReturnValue(of(mockCoders)),
      getCodersByJobId: jest.fn().mockReturnValue(of([]))
    };

    mockCodingJobService = {
      assignCoder: jest.fn().mockImplementation((jobId: number, coderId: number) => of({ id: jobId, assignedCoders: [coderId] })),
      jobsCreatedEvent: new EventEmitter<void>()
    } as Partial<CodingJobService>;

    mockMissingsProfileService = {
      getMissingsProfiles: jest.fn().mockReturnValue(of([
        { id: 7, label: 'IQB-Standard' },
        { id: 9, label: 'Custom' }
      ]))
    } as Partial<MissingsProfileService>;

    mockDialogRef = {
      close: jest.fn()
    };

    mockSnackBar = {
      open: jest.fn()
    };

    mockTranslateService = {
      instant: jest.fn().mockImplementation((key: string) => key),
      get: jest.fn().mockImplementation((key: string) => of(key)),
      onLangChange: new EventEmitter<unknown>(),
      onTranslationChange: new EventEmitter<unknown>(),
      onDefaultLangChange: new EventEmitter<unknown>()
    } as Partial<TranslateService>;

    mockMatDialog = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CodingJobDefinitionDialogComponent,
        ReactiveFormsModule,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        FormBuilder,
        { provide: CodingJobBackendService, useValue: mockCodingJobBackendService },
        { provide: DistributedCodingService, useValue: mockDistributedCodingService },
        { provide: AppService, useValue: mockAppService },
        { provide: CoderService, useValue: mockCoderService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: MissingsProfileService, useValue: mockMissingsProfileService },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: SERVER_URL, useValue: 'http://localhost:3333/' },
        provideHttpClient()
      ]
    }).overrideComponent(CodingJobDefinitionDialogComponent, {
      remove: {
        imports: [MatDialogModule]
      }
    }).compileComponents();
  });

  const createComponent = (dataOverride?: Partial<CodingJobDefinitionDialogData>) => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { ...mockData, ...dataOverride } });
    fixture = TestBed.createComponent(CodingJobDefinitionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  it('explains why existing job definitions are read-only', () => {
    createComponent({
      isEdit: true,
      mode: 'definition',
      readOnly: true
    });

    expect(fixture.nativeElement.querySelector('.readonly-definition-note')).toBeTruthy();
  });

  it('should initialize form with default values', () => {
    createComponent();
    expect(component.codingJobForm).toBeDefined();
    expect(component.codingJobForm.get('durationSeconds')?.value).toBe(1);
    expect(component.codingJobForm.get('caseOrderingMode')?.value).toBe('continuous');
    expect(component.codingJobForm.get('missingsProfileId')?.value).toBe(7);
    expect(component.codingJobForm.get('showScore')?.value).toBe(false);
    expect(component.codingJobForm.get('allowComments')?.value).toBe(true);
  });

  it('should initialize an edited definition with its camel-case missings profile id', () => {
    createComponent({
      mode: 'definition',
      isEdit: true,
      codingJob: {
        id: 555,
        missingsProfileId: 9
      } as CodingJob
    });

    expect(component.codingJobForm.get('missingsProfileId')?.value).toBe(9);
  });

  it('should load variables and coders on init', () => {
    createComponent();
    expect(mockCodingJobBackendService.getCodingIncompleteVariables).toHaveBeenCalledWith(1, undefined, undefined);
    expect(mockCoderService.getCoders).toHaveBeenCalled();
    expect(component.variables.length).toBe(3);
    expect(component.availableCoders.length).toBe(2);
  });

  it('should apply availability filters correctly', () => {
    createComponent();

    // Default 'all'
    expect(component.dataSource.data.length).toBe(3);

    // Filter 'full' (Unit 1: 10/10)
    component.availabilityFilter = 'full';
    component.applyAvailabilityFilter();
    expect(component.dataSource.data.length).toBe(1);
    expect(component.dataSource.data[0].unitName).toBe('Unit 1');

    // Filter 'none' (Unit 2: 0/5)
    component.availabilityFilter = 'none';
    component.applyAvailabilityFilter();
    expect(component.dataSource.data.length).toBe(1);
    expect(component.dataSource.data[0].unitName).toBe('Unit 2');

    // Filter 'partial' (Unit 3: 4/8)
    component.availabilityFilter = 'partial';
    component.applyAvailabilityFilter();
    expect(component.dataSource.data.length).toBe(1);
    expect(component.dataSource.data[0].unitName).toBe('Unit 3');
  });

  it('should subtract existing definition usage from backend availability without repeated subtraction', () => {
    (mockCodingJobBackendService.getCodingIncompleteVariables as jest.Mock).mockImplementation(() => of([
      {
        unitName: 'Unit X',
        variableId: 'Var X',
        responseCount: 10,
        availableCases: 6,
        uniqueCasesAfterAggregation: 10
      }
    ]));
    (mockCodingJobBackendService.getVariableBundles as jest.Mock).mockImplementation(() => of([]));
    (mockCodingJobBackendService.getJobDefinitions as jest.Mock).mockImplementation(() => of([
      {
        id: 200,
        assignedVariables: [{ unitName: 'Unit X', variableId: 'Var X', responseCount: 10 }],
        maxCodingCases: 4,
        plannedVariableUsage: { 'Unit X::Var X': 4 }
      }
    ]));

    createComponent();

    expect(component.variables[0].availableCases).toBe(2);
    component.applyJobDefinitionUsage();
    expect(component.variables[0].availableCases).toBe(2);
  });

  it('should not subtract planned usage for definitions with already created jobs', () => {
    (mockCodingJobBackendService.getCodingIncompleteVariables as jest.Mock).mockImplementation(() => of([
      {
        unitName: 'Unit X',
        variableId: 'Var X',
        responseCount: 10,
        availableCases: 6,
        uniqueCasesAfterAggregation: 10
      }
    ]));
    (mockCodingJobBackendService.getVariableBundles as jest.Mock).mockImplementation(() => of([]));
    (mockCodingJobBackendService.getJobDefinitions as jest.Mock).mockImplementation(() => of([
      {
        id: 200,
        assignedVariables: [{ unitName: 'Unit X', variableId: 'Var X', responseCount: 10 }],
        maxCodingCases: 4,
        createdJobsCount: 1,
        plannedVariableUsage: { 'Unit X::Var X': 4 }
      }
    ]));

    createComponent();

    expect(component.variables[0].availableCases).toBe(6);
    component.applyJobDefinitionUsage();
    expect(component.variables[0].availableCases).toBe(6);
  });

  it('should deselect individual variables if they are covered by a newly selected bundle', () => {
    createComponent();
    // Select Unit 1 individually
    component.selectedVariables.select(mockVariables[0]);
    expect(component.selectedVariables.isSelected(mockVariables[0])).toBe(true);

    // Helper to find the bundle containing Unit 1
    const bundle = component.variableBundles.find(b => b.name === 'Bundle 1');
    expect(bundle).toBeDefined();

    // Toggle bundle selection
    if (bundle) component.toggleBundleSelection(bundle);

    // Should be deselected individually
    expect(component.selectedVariableBundles.isSelected(bundle!)).toBe(true);
    expect(component.selectedVariables.isSelected(mockVariables[0])).toBe(false);
  });

  it('should set double coding mode without toggling the selected value back', () => {
    createComponent();

    component.codingJobForm.patchValue({ doubleCodingAbsolute: 3, doubleCodingPercentage: 25 });
    component.setDoubleCodingMode('percentage');

    expect(component.doubleCodingMode).toBe('percentage');
    expect(component.codingJobForm.get('doubleCodingAbsolute')?.value).toBe(0);
    expect(component.codingJobForm.get('doubleCodingPercentage')?.value).toBe(25);

    component.setDoubleCodingMode('absolute');

    expect(component.doubleCodingMode).toBe('absolute');
    expect(component.codingJobForm.get('doubleCodingPercentage')?.value).toBe(0);
  });

  it('should validate double coding limits in the reactive form', () => {
    createComponent();

    component.codingJobForm.patchValue({ doubleCodingAbsolute: -1 });
    expect(component.codingJobForm.get('doubleCodingAbsolute')?.invalid).toBe(true);
    expect(component.codingJobForm.invalid).toBe(true);

    component.codingJobForm.patchValue({ doubleCodingAbsolute: 0 });
    component.setDoubleCodingMode('percentage');
    component.codingJobForm.patchValue({ doubleCodingPercentage: 101 });

    expect(component.codingJobForm.get('doubleCodingPercentage')?.invalid).toBe(true);
    expect(component.codingJobForm.invalid).toBe(true);
  });

  it('should mark invalid fields as touched instead of submitting', async () => {
    createComponent();

    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);
    component.codingJobForm.patchValue({ durationSeconds: 0 });

    await component.onSubmit();

    expect(component.codingJobForm.get('durationSeconds')?.touched).toBe(true);
    expect(mockCodingJobBackendService.createJobDefinition).not.toHaveBeenCalled();
  });

  it('should count planned coding jobs using selected items and coders', () => {
    createComponent();
    const bundle = component.variableBundles.find(b => b.name === 'Bundle 1');
    expect(bundle).toBeDefined();

    component.selectedCoders.select(mockCoders[0]);
    component.selectedCoders.select(mockCoders[1]);
    component.selectedVariableBundles.select(bundle!);

    expect(component.getCodingJobCount()).toBe(2);

    component.selectedVariables.select(mockVariables[0]);

    expect(component.getCodingJobCount()).toBe(4);
  });

  it('should distinguish selected effective cases from cases available for new jobs', () => {
    createComponent();

    const unit2 = component.variables.find(variable => variable.unitName === 'Unit 2');
    const unit3 = component.variables.find(variable => variable.unitName === 'Unit 3');
    expect(unit2).toBeDefined();
    expect(unit3).toBeDefined();

    component.selectedVariables.select(unit2!, unit3!);

    expect(component.getSelectedEffectiveCodingCases()).toBe(13);
    expect(component.getDistributableCodingCasesBeforeLimit()).toBe(4);
    expect(component.getUnavailableSelectedCodingCases()).toBe(9);
    expect(component.getTotalCodingCases()).toBe(4);

    component.codingJobForm.patchValue({ maxCodingCases: 3 });

    expect(component.getMaxCasesLimitReduction()).toBe(1);
    expect(component.getTotalCodingCases()).toBe(3);
  });

  it('should ignore duplicate definition submits while saving', () => {
    createComponent();
    const saveSubject = new Subject<unknown>();
    (mockCodingJobBackendService.createJobDefinition as jest.Mock).mockReturnValue(saveSubject.asObservable());

    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);

    component.onSubmit();
    component.onSubmit();

    expect(mockCodingJobBackendService.createJobDefinition).toHaveBeenCalledTimes(1);
    expect(mockCodingJobBackendService.createJobDefinition).toHaveBeenCalledWith(1, expect.objectContaining({
      showScore: false,
      allowComments: true,
      suppressGeneralInstructions: false
    }));
  });

  it('should send selected coder capacity configs when creating a definition', async () => {
    createComponent();
    (mockCodingJobBackendService.createJobDefinition as jest.Mock).mockReturnValue(of({ id: 123 }));

    const coder = component.availableCoders[0];
    component.selectedCoders.select(coder);
    component.updateCoderCapacityPercent(coder, 50);
    component.selectedVariables.select(mockVariables[0]);

    await component.onSubmit();

    expect(mockCodingJobBackendService.createJobDefinition).toHaveBeenCalledWith(1, expect.objectContaining({
      assignedCoders: [1],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 50 }]
    }));
  });

  it('should include DERIVE_ERROR opt-in only for selected definition variables', async () => {
    createComponent();
    (mockCodingJobBackendService.createJobDefinition as jest.Mock).mockReturnValue(of({ id: 123 }));

    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);
    component.setDeriveErrorIncluded(mockVariables[0], true);

    await component.onSubmit();

    expect(mockCodingJobBackendService.createJobDefinition).toHaveBeenCalledWith(1, expect.objectContaining({
      assignedVariables: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        includeDeriveError: true
      }]
    }));
  });

  it('should send the selected missings profile when creating a definition', async () => {
    createComponent();
    (mockCodingJobBackendService.createJobDefinition as jest.Mock).mockReturnValue(of({ id: 123 }));

    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);
    component.codingJobForm.patchValue({ missingsProfileId: 9 });

    await component.onSubmit();

    expect(mockCodingJobBackendService.createJobDefinition).toHaveBeenCalledWith(1, expect.objectContaining({
      missingsProfileId: 9
    }));
  });

  describe('Mode: Job (Create/Edit)', () => {
    it('should submit create calling createCodingJob and assignCoder when 1 variable selected', fakeAsync(() => {
      createComponent({ mode: 'job', isEdit: false });

      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]); // Only 1 variable

      const mockCreatedJob = { id: 101, name: 'New Job' };
      (mockCodingJobBackendService.createCodingJob as jest.Mock).mockReturnValue(of(mockCreatedJob));

      component.onSubmit();
      tick();

      expect(mockCodingJobBackendService.createCodingJob).toHaveBeenCalledWith(1, expect.objectContaining({
        assignedCoders: [1],
        variables: [mockVariables[0]]
      }));
      expect(mockCodingJobService.assignCoder).toHaveBeenCalledWith(101, 1);
      expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ id: 101 }));
    }));

    it('should submit edit calling updateCodingJob and assignCoder', fakeAsync(() => {
      const existingJob: Partial<CodingJob> = {
        id: 202, name: 'Edit Job', variables: [], assignedCoders: []
      };
      createComponent({ mode: 'job', isEdit: true, codingJob: existingJob as CodingJob });

      component.selectedCoders.select(mockCoders[1]); // Change coder
      component.selectedVariables.select(mockVariables[0]);

      (mockCodingJobBackendService.updateCodingJob as jest.Mock).mockReturnValue(of(existingJob));

      component.onSubmit();
      tick();

      expect(mockCodingJobBackendService.updateCodingJob).toHaveBeenCalledWith(
        1,
        202,
        expect.objectContaining({ assignedCoders: [2] })
      );
      expect(mockCodingJobService.assignCoder).toHaveBeenCalledWith(202, 2);
      expect(mockDialogRef.close).toHaveBeenCalled();
    }));

    it('should allow editing a job when its assigned variables are not in the current incomplete list', fakeAsync(() => {
      (mockCodingJobBackendService.getCodingIncompleteVariables as jest.Mock).mockReturnValue(of([]));
      (mockCoderService.getCodersByJobId as jest.Mock).mockReturnValue(of([mockCoders[0]]));
      const existingJob: Partial<CodingJob> = {
        id: 303,
        name: 'Existing Job',
        assignedCoders: [1],
        assignedVariables: [{ unitName: 'Finished Unit', variableId: 'Finished Var' }]
      };
      createComponent({ mode: 'job', isEdit: true, codingJob: existingJob as CodingJob });

      (mockCodingJobBackendService.updateCodingJob as jest.Mock).mockReturnValue(of(existingJob));

      component.onSubmit();
      tick();

      expect(mockCodingJobBackendService.updateCodingJob).toHaveBeenCalledWith(
        1,
        303,
        expect.objectContaining({ assignedCoders: [1] })
      );
      expect(mockSnackBar.open).not.toHaveBeenCalledWith(
        'coding-job-definition-dialog.validation.variable-or-bundle-required',
        'common.close',
        expect.anything()
      );
    }));

    it('should update definition when in definition mode and editing', fakeAsync(() => {
      createComponent({ mode: 'definition', isEdit: true, jobDefinitionId: 555 });
      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]);
      component.codingJobForm.patchValue({
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true
      });

      (mockCodingJobBackendService.updateJobDefinition as jest.Mock).mockReturnValue(of({ id: 555 }));

      component.onSubmit();
      tick();

      expect(mockCodingJobBackendService.updateJobDefinition).toHaveBeenCalledWith(1, 555, expect.objectContaining({
        showScore: true,
        allowComments: false,
        suppressGeneralInstructions: true,
        missingsProfileId: 7
      }));
      expect(mockDialogRef.close).toHaveBeenCalled();
    }));
  });

  it('should not load coders by job id when editing a definition and should keep assigned coder selection', () => {
    const definitionAsCodingJob = {
      id: 555,
      assignedCoders: [1],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 50 }]
    } as Partial<CodingJob>;

    createComponent({
      mode: 'definition',
      isEdit: true,
      jobDefinitionId: 555,
      codingJob: definitionAsCodingJob as CodingJob
    });

    expect(mockCoderService.getCodersByJobId).not.toHaveBeenCalled();
    expect(component.selectedCoders.selected.map(coder => coder.id)).toEqual([1]);
    expect(component.selectedCoders.selected[0].capacityPercent).toBe(50);
  });

  it('should preserve edited coder capacity configs when updating a definition', fakeAsync(() => {
    const definitionAsCodingJob = {
      id: 555,
      assignedCoders: [1],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 50 }]
    } as Partial<CodingJob>;

    createComponent({
      mode: 'definition',
      isEdit: true,
      jobDefinitionId: 555,
      codingJob: definitionAsCodingJob as CodingJob
    });

    component.selectedVariables.select(mockVariables[0]);
    component.updateCoderCapacityPercent(component.selectedCoders.selected[0], 150);
    (mockCodingJobBackendService.updateJobDefinition as jest.Mock).mockReturnValue(of({ id: 555 }));

    component.onSubmit();
    tick();

    expect(mockCodingJobBackendService.updateJobDefinition).toHaveBeenCalledWith(1, 555, expect.objectContaining({
      assignedCoders: [1],
      assignedCoderConfigs: [{ coderId: 1, capacityPercent: 150 }]
    }));
  }));

  it('should restore the DERIVE_ERROR opt-in when editing a definition', () => {
    const definitionAsCodingJob = {
      id: 555,
      assignedVariables: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        includeDeriveError: true
      }]
    } as Partial<CodingJob>;

    createComponent({
      mode: 'definition',
      isEdit: true,
      jobDefinitionId: 555,
      codingJob: definitionAsCodingJob as CodingJob
    });

    const restoredVariable = component.variables.find(variable => variable.unitName === 'Unit 1' && variable.variableId === 'Var 1');

    expect(restoredVariable).toBeDefined();
    expect(component.selectedVariables.selected).toContain(restoredVariable);
    expect(restoredVariable?.includeDeriveError).toBe(true);
  });

  it('should open locked definitions read-only without submitting changes', async () => {
    const definitionAsCodingJob = {
      id: 555,
      assignedCoders: [1],
      assignedVariables: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        availableCases: 10
      }],
      durationSeconds: 60,
      maxCodingCases: 5,
      doubleCodingAbsolute: 2,
      status: 'approved'
    } as Partial<CodingJob>;

    createComponent({
      mode: 'definition',
      isEdit: true,
      jobDefinitionId: 555,
      readOnly: true,
      codingJob: definitionAsCodingJob as CodingJob
    });

    expect(component.isReadOnly).toBe(true);
    expect(component.codingJobForm.disabled).toBe(true);
    expect(component.getTotalCodingCases()).toBe(5);
    expect(component.selectedCoders.selected.map(coder => coder.id)).toEqual([1]);

    component.masterCoderToggle();
    component.setDoubleCodingMode('percentage');
    await component.onSubmit();

    expect(component.selectedCoders.selected.map(coder => coder.id)).toEqual([1]);
    expect(component.doubleCodingMode).toBe('absolute');
    expect(mockCodingJobBackendService.updateJobDefinition).not.toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });

  describe('Bulk Creation', () => {
    it('should open bulk creation dialog when mode=job and >1 variables selected', async () => {
      createComponent({ mode: 'job', isEdit: false });

      // Select 2 variables
      component.selectedCoders.select({ ...mockCoders[0], capacityPercent: 999 });
      component.selectedVariables.select(mockVariables[0]);
      component.selectedVariables.select(mockVariables[2]);
      component.codingJobForm.patchValue({
        caseOrderingMode: 'alternating',
        maxCodingCases: 3
      });

      const mockBulkResult = { confirmed: true, jobs: [] };
      const dialogRefMock = {
        afterClosed: () => of(mockBulkResult)
      };
      (mockMatDialog.open as jest.Mock).mockReturnValue(dialogRefMock);
      (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mockReturnValue(of({ success: true, jobs: [] }));

      await component.onSubmit();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect((mockMatDialog.open as jest.Mock).mock.calls[0][1].data).toMatchObject({
        caseOrderingMode: 'alternating',
        maxCodingCases: 3,
        selectedCoders: [
          expect.objectContaining({ id: 1, capacityPercent: 300 })
        ]
      });
      expect(mockDistributedCodingService.createDistributedCodingJobs).toHaveBeenCalled();
      expect((mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mock.calls[0][2]).toEqual([
        expect.objectContaining({ id: 1, capacityPercent: 300 })
      ]);
      expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ bulkJobCreation: true }));
    });

    it('should open bulk creation dialog when one variable has multiple coders selected', async () => {
      createComponent({ mode: 'job', isEdit: false });

      component.selectedCoders.select(mockCoders[0], mockCoders[1]);
      component.selectedVariables.select(mockVariables[0]);

      const dialogRefMock = {
        afterClosed: () => of({
          confirmed: true,
          showScore: false,
          allowComments: true,
          suppressGeneralInstructions: false
        })
      };
      (mockMatDialog.open as jest.Mock).mockReturnValue(dialogRefMock);
      (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mockReturnValue(of({
        success: true,
        doubleCodingInfo: {},
        distributionByCoderId: {},
        jobs: []
      }));

      await component.onSubmit();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockCodingJobBackendService.createCodingJob).not.toHaveBeenCalled();
      const createCall = (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mock.calls[0];
      expect(createCall[0]).toBe(1);
      expect(createCall[1]).toEqual([mockVariables[0]]);
      expect(createCall[2]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 })
      ]));
      expect(createCall[5]).toEqual([]);
    });

    it('should open bulk creation dialog when a bundle has multiple coders selected', async () => {
      createComponent({ mode: 'job', isEdit: false });

      const bundle = component.variableBundles.find(b => b.name === 'Bundle 1');
      expect(bundle).toBeDefined();

      component.selectedCoders.select(mockCoders[0], mockCoders[1]);
      component.selectedVariableBundles.select(bundle!);

      const dialogRefMock = {
        afterClosed: () => of({
          confirmed: true,
          showScore: false,
          allowComments: true,
          suppressGeneralInstructions: false
        })
      };
      (mockMatDialog.open as jest.Mock).mockReturnValue(dialogRefMock);
      (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mockReturnValue(of({
        success: true,
        doubleCodingInfo: {},
        distributionByCoderId: {},
        jobs: []
      }));

      await component.onSubmit();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockCodingJobBackendService.createCodingJob).not.toHaveBeenCalled();
      const createCall = (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mock.calls[0];
      expect(createCall[0]).toBe(1);
      expect(createCall[1]).toEqual([]);
      expect(createCall[2]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 })
      ]));
      expect(createCall[5]).toEqual([bundle]);
    });
  });

  it('should validate maxCodingCases against selected input', () => {
    createComponent();
    component.selectedVariables.select(component.variables[0]); // 10 cases
    component.selectedVariables.select(component.variables[2]); // 4 cases
    // Total 14

    // Set limit
    component.codingJobForm.patchValue({ maxCodingCases: 5 });

    expect(component.getTotalCodingCases()).toBe(5);

    component.codingJobForm.patchValue({ maxCodingCases: 100 });
    expect(component.getTotalCodingCases()).toBe(14);
  });

  it('should use synchronized availability for bundle variables in total case count', () => {
    createComponent();

    const bundle = component.variableBundles.find(b => b.name === 'Bundle 1');
    expect(bundle).toBeDefined();

    if (bundle) {
      component.selectedVariableBundles.select(bundle);
    }

    // Unit 1 -> 10 available, Unit 3 -> 4 available
    expect(component.getTotalCodingCases()).toBe(14);
  });

  it('should calculate "Time per coder" correctly with double coding', () => {
    createComponent();

    // Select 2 coders
    component.selectedCoders.select(mockCoders[0]);
    component.selectedCoders.select(mockCoders[1]);

    // Select Unit 1 (10 cases)
    component.selectedVariables.select(mockVariables[0]);

    // Set duration to 60 seconds (1 minute per case)
    component.codingJobForm.patchValue({ durationSeconds: 60 });

    // Total cases: 10
    // Total time: 10 * 60 = 600s (10 min)
    // Time per coder: 600 / 2 = 300s (5 min)
    expect(component.getTotalTimeInSeconds()).toBe(600);
    expect(component.getFormattedTotalTime()).toBe('10:00');
    expect(component.getFormattedTimePerCoder()).toBe('5:00');

    // Add double coding (absolute: 2)
    component.doubleCodingMode = 'absolute';
    component.codingJobForm.patchValue({ doubleCodingAbsolute: 2 });

    // Total tasks: 10 (unique) + 2 (double) = 12
    // Total time: 12 * 60 = 720s (12 min)
    // Time per coder: 720 / 2 = 360s (6 min)
    expect(component.getTotalCodingTasks()).toBe(12);
    expect(component.getTotalTimeInSeconds()).toBe(720);
    expect(component.getFormattedTotalTime()).toBe('12:00');
    expect(component.getFormattedTimePerCoder()).toBe('6:00');

    // Switch to percentage (50%)
    component.doubleCodingMode = 'percentage';
    component.codingJobForm.patchValue({ doubleCodingPercentage: 50 });

    // Total tasks: 10 + floor(0.5 * 10) = 15
    // Total time: 15 * 60 = 900s (15 min)
    // Time per coder: 900 / 2 = 450s (7 min 30 sec)
    expect(component.getTotalCodingTasks()).toBe(15);
    expect(component.getFormattedTotalTime()).toBe('15:00');
    expect(component.getFormattedTimePerCoder()).toBe('7:30');
  });

  it('should include coder capacity in the time-per-coder estimate', () => {
    createComponent();

    component.selectedVariables.select(mockVariables[0]);
    component.codingJobForm.patchValue({ durationSeconds: 60 });

    component.selectedCoders.select(
      { ...mockCoders[0], capacityPercent: 100 },
      { ...mockCoders[1], capacityPercent: 100 }
    );
    expect(component.getFormattedTimePerCoder()).toBe('5:00');

    component.selectedCoders.clear();
    component.selectedCoders.select(
      { ...mockCoders[0], capacityPercent: 50 },
      { ...mockCoders[1], capacityPercent: 150 }
    );
    expect(component.getFormattedTimePerCoder()).toBe('7:30');
  });
});
