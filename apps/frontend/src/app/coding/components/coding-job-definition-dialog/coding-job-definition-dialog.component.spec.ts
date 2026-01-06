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
import { of, throwError } from 'rxjs';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CodingJobDefinitionDialogComponent, CodingJobDefinitionDialogData } from './coding-job-definition-dialog.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { Variable } from '../../models/coding-job.model';
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
      getVariableBundles: jest.fn().mockReturnValue(of([])),
      updateCodingJob: jest.fn(),
      createJobDefinition: jest.fn(),
      createCodingJob: jest.fn()
    } as Partial<BackendService>;

    mockAppService = {
      selectedWorkspaceId: 1
    };

    mockCoderService = {
      getCoders: jest.fn().mockReturnValue(of(mockCoders)),
      getCodersByJobId: jest.fn().mockReturnValue(of([]))
    };

    mockCodingJobService = {
      assignCoder: jest.fn(),
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

    fixture = TestBed.createComponent(CodingJobDefinitionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with default values', () => {
    expect(component.codingJobForm).toBeDefined();
    expect(component.codingJobForm.get('durationSeconds')?.value).toBe(1);
    expect(component.codingJobForm.get('caseOrderingMode')?.value).toBe('continuous');
  });

  it('should load variables and coders on init', () => {
    expect(mockBackendService.getCodingIncompleteVariables).toHaveBeenCalledWith(1, undefined);
    expect(mockCoderService.getCoders).toHaveBeenCalled();
    expect(component.variables.length).toBe(2);
    expect(component.availableCoders.length).toBe(2);
  });

  it('should filter variables based on unit name', fakeAsync(() => {
    component.unitNameFilter = 'Unit 1';
    component.applyFilter();
    tick();
    expect(mockBackendService.getCodingIncompleteVariables).toHaveBeenCalledWith(1, 'Unit 1');
  }));

  it('should calculate total coding cases correctly', () => {
    component.selectedVariables.select(mockVariables[0]);
    expect(component.getTotalCodingCases()).toBe(10);

    component.selectedVariables.select(mockVariables[1]);
    expect(component.getTotalCodingCases()).toBe(15); // Sum of response counts (10 + 5) since no definitions exist
  });

  it('should validate form before submission', async () => {
    component.codingJobForm.patchValue({ durationSeconds: 0 }); // Invalid
    await component.onSubmit();
    expect(mockBackendService.createJobDefinition).not.toHaveBeenCalled();
  });

  it('should require at least one coder for definition mode', async () => {
    component.selectedCoders.clear();
    component.selectedVariables.select(mockVariables[0]);
    await component.onSubmit();
    expect(mockSnackBar.open).toHaveBeenCalledWith('coding-job-definition-dialog.validation.coder-required', 'common.close', expect.any(Object));
  });

  it('should require at least one variable or bundle for definition mode', async () => {
    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.clear();
    component.selectedVariableBundles.clear();
    await component.onSubmit();
    expect(mockSnackBar.open).toHaveBeenCalledWith('coding-job-definition-dialog.validation.variable-or-bundle-required', 'common.close', expect.any(Object));
  });

  it('should handle submission for new job definition', async () => {
    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);
    const mockCreatedJob = { id: 100 };
    (mockBackendService.createJobDefinition as jest.Mock).mockReturnValue(of(mockCreatedJob));

    await component.onSubmit();

    expect(mockBackendService.createJobDefinition).toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(mockCreatedJob);
  });

  it('should handle submission error for new job definition', async () => {
    component.selectedCoders.select(mockCoders[0]);
    component.selectedVariables.select(mockVariables[0]);
    (mockBackendService.createJobDefinition as jest.Mock).mockReturnValue(throwError(() => new Error('Server error')));

    await component.onSubmit();

    expect(mockSnackBar.open).toHaveBeenCalledWith('coding-job-definition-dialog.snackbars.error-creating-definition', 'common.close', expect.any(Object));
  });
});
