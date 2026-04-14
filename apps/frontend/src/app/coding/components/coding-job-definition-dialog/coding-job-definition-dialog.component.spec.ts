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
import { of } from 'rxjs';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CodingJobDefinitionDialogComponent, CodingJobDefinitionDialogData } from './coding-job-definition-dialog.component';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';
import { SERVER_URL } from '../../../injection-tokens';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
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
      unitName: 'Unit 2', variableId: 'Var 2', responseCount: 5, availableCases: 0, uniqueCasesAfterAggregation: 5
    },
    {
      unitName: 'Unit 3', variableId: 'Var 3', responseCount: 8, availableCases: 4, uniqueCasesAfterAggregation: 8
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

  beforeEach(async () => {
    mockCodingJobBackendService = {
      getJobDefinitions: jest.fn().mockReturnValue(of([
        {
          id: 100,
          assignedVariables: [{ unitName: 'Unit 2', variableId: 'Var 2', responseCount: 5 }],
          maxCodingCases: 5
        },
        {
          id: 101,
          assignedVariables: [{ unitName: 'Unit 3', variableId: 'Var 3', responseCount: 8 }],
          maxCodingCases: 4
        }
      ])),
      getCodingIncompleteVariables: jest.fn().mockReturnValue(of(mockVariables)),
      getVariableBundles: jest.fn().mockReturnValue(of(mockBundles)),
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

  it('should initialize form with default values', () => {
    createComponent();
    expect(component.codingJobForm).toBeDefined();
    expect(component.codingJobForm.get('durationSeconds')?.value).toBe(1);
    expect(component.codingJobForm.get('caseOrderingMode')?.value).toBe('continuous');
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

    it('should update definition when in definition mode and editing', fakeAsync(() => {
      createComponent({ mode: 'definition', isEdit: true, jobDefinitionId: 555 });
      component.selectedCoders.select(mockCoders[0]);
      component.selectedVariables.select(mockVariables[0]);

      (mockCodingJobBackendService.updateJobDefinition as jest.Mock).mockReturnValue(of({ id: 555 }));

      component.onSubmit();
      tick();

      expect(mockCodingJobBackendService.updateJobDefinition).toHaveBeenCalledWith(1, 555, expect.any(Object));
      expect(mockDialogRef.close).toHaveBeenCalled();
    }));
  });

  it('should not load coders by job id when editing a definition and should keep assigned coder selection', () => {
    const definitionAsCodingJob = {
      id: 555,
      assignedCoders: [1]
    } as Partial<CodingJob>;

    createComponent({
      mode: 'definition',
      isEdit: true,
      jobDefinitionId: 555,
      codingJob: definitionAsCodingJob as CodingJob
    });

    expect(mockCoderService.getCodersByJobId).not.toHaveBeenCalled();
    expect(component.selectedCoders.selected.map(coder => coder.id)).toEqual([1]);
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
      (mockDistributedCodingService.createDistributedCodingJobs as jest.Mock).mockReturnValue(of({ success: true, jobs: [] }));

      await component.onSubmit();

      expect(mockMatDialog.open).toHaveBeenCalled();
      expect(mockDistributedCodingService.createDistributedCodingJobs).toHaveBeenCalled();
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
});
