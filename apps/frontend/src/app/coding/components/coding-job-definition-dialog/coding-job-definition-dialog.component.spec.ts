import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { EventEmitter } from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CodingJobDefinitionDialogComponent, CodingJobDefinitionDialogData } from './coding-job-definition-dialog.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { CodingJob, Variable, VariableBundle } from '../../models/coding-job.model';
import { Coder } from '../../models/coder.model';

describe('CodingJobDefinitionDialogComponent', () => {
  let component: CodingJobDefinitionDialogComponent;
  let fixture: ComponentFixture<CodingJobDefinitionDialogComponent>;
  let mockBackendService: Partial<BackendService>;
  let mockAppService: Partial<AppService>;
  let mockCoderService: Partial<CoderService>;
  let mockCodingJobService: Partial<CodingJobService>;
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
      unitName: 'Unit 1', variableId: 'Var 1', responseCount: 10, availableCases: 10
    },
    {
      unitName: 'Unit 2', variableId: 'Var 2', responseCount: 5, availableCases: 0
    },
    {
      unitName: 'Unit 3', variableId: 'Var 3', responseCount: 8, availableCases: 4
    }
  ];

  const mockBundles: VariableBundle[] = [
    {
      id: 1,
      name: 'Bundle 1',
      createdAt: new Date(),
      updatedAt: new Date(),
      variables: [
        { unitName: 'Unit 1', variableId: 'Var 1' }
      ]
    }
  ];

  const mockCoders: Coder[] = [
    { id: 1, name: 'Coder 1' },
    { id: 2, name: 'Coder 2' }
  ];

  beforeEach(async () => {
    mockBackendService = {
      getJobDefinitions: jest.fn().mockReturnValue(of([])),
      getCodingIncompleteVariables: jest.fn().mockReturnValue(of(mockVariables)),
      getVariableBundles: jest.fn().mockReturnValue(of(mockBundles)),
      updateCodingJob: jest.fn(),
      createJobDefinition: jest.fn(),
      createCodingJob: jest.fn(),
      updateJobDefinition: jest.fn(),
      createDistributedCodingJobs: jest.fn()
    } as unknown as Partial<BackendService>;

    mockAppService = {
      selectedWorkspaceId: 1
    };

    mockCoderService = {
      getCoders: jest.fn().mockReturnValue(of(mockCoders)),
      getCodersByJobId: jest.fn().mockReturnValue(of([]))
    };

    mockCodingJobService = {
      assignCoder: jest.fn().mockReturnValue(of(true)),
      jobsCreatedEvent: new EventEmitter<void>()
    } as Partial<CodingJobService>;

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
        { provide: BackendService, useValue: mockBackendService },
        { provide: AppService, useValue: mockAppService },
        { provide: CoderService, useValue: mockCoderService },
        { provide: CodingJobService, useValue: mockCodingJobService },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockData },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockMatDialog }
      ]
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

  it('should initialize form with default values', () => {
    createComponent();
    expect(component.codingJobForm).toBeDefined();
    expect(component.codingJobForm.get('durationSeconds')?.value).toBe(1);
    expect(component.codingJobForm.get('caseOrderingMode')?.value).toBe('continuous');
  });

  it('should load variables and coders on init', () => {
    createComponent();
    expect(mockBackendService.getCodingIncompleteVariables).toHaveBeenCalledWith(1, undefined);
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

  describe('Mode: Job (Create/Edit)', () => {
    it('should submit create calling createCodingJob and assignCoder when 1 variable selected', fakeAsync(() => {
      createComponent({ mode: 'job', isEdit: false });

      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]); // Only 1 variable

      const mockCreatedJob = { id: 101, name: 'New Job' };
      (mockBackendService.createCodingJob as jest.Mock).mockReturnValue(of(mockCreatedJob));

      component.onSubmit();
      tick();

      expect(mockBackendService.createCodingJob).toHaveBeenCalledWith(1, expect.objectContaining({
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

      (mockBackendService.updateCodingJob as jest.Mock).mockReturnValue(of(existingJob));

      component.onSubmit();
      tick();

      expect(mockBackendService.updateCodingJob).toHaveBeenCalledWith(
        1,
        202,
        expect.objectContaining({ assignedCoders: [2] })
      );
      expect(mockCodingJobService.assignCoder).toHaveBeenCalledWith(202, 2);
      expect(mockDialogRef.close).toHaveBeenCalled();
    }));

    it('should update definition when in definition mode and editing', fakeAsync(() => {
      createComponent({ mode: 'definition', isEdit: true, jobDefinitionId: 555 });
      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]);

      (mockBackendService.updateJobDefinition as jest.Mock).mockReturnValue(of({ id: 555 }));

      component.onSubmit();
      tick();

      expect(mockBackendService.updateJobDefinition).toHaveBeenCalledWith(1, 555, expect.any(Object));
      expect(mockDialogRef.close).toHaveBeenCalled();
    }));
  });

  describe('Bulk Creation', () => {
    it('should open bulk creation dialog when mode=job and >1 variables selected', async () => {
      createComponent({ mode: 'job', isEdit: false });

      // Select 2 variables
      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]);
      component.selectedVariables.select(mockVariables[2]);

      const mockBulkResult = { confirmed: true, jobs: [] };
      const dialogRefMock = {
        afterClosed: () => of(mockBulkResult)
      };
      (mockMatDialog.open as jest.Mock).mockReturnValue(dialogRefMock);
      (mockBackendService.createDistributedCodingJobs as jest.Mock).mockReturnValue(of({ success: true, jobs: [] }));

      await component.onSubmit();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockBackendService.createDistributedCodingJobs).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ bulkJobCreation: true }));
    });
  });

  it('should validate maxCodingCases against selected input', () => {
    createComponent();
    component.selectedVariables.select(mockVariables[0]); // 10 cases
    component.selectedVariables.select(mockVariables[2]); // 4 cases
    // Total 14

    // Set limit
    component.codingJobForm.patchValue({ maxCodingCases: 5 });

    expect(component.getTotalCodingCases()).toBe(5);

    component.codingJobForm.patchValue({ maxCodingCases: 100 });
    expect(component.getTotalCodingCases()).toBe(14);
  });
});
