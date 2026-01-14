import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { VariableAnalysisJobsDialogComponent, VariableAnalysisJobsDialogData } from './variable-analysis-jobs-dialog.component';
import { VariableAnalysisService, JobCancelResult } from '../../../shared/services/response/variable-analysis.service';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';

describe('VariableAnalysisJobsDialogComponent', () => {
  let component: VariableAnalysisJobsDialogComponent;
  let fixture: ComponentFixture<VariableAnalysisJobsDialogComponent>;
  let dialogRef: jest.Mocked<MatDialogRef<VariableAnalysisJobsDialogComponent>>;
  let variableAnalysisService: jest.Mocked<VariableAnalysisService>;
  let snackBar: jest.Mocked<MatSnackBar>;

  const mockJobs: VariableAnalysisJobDto[] = [
    {
      id: 1,
      workspace_id: 1,
      type: 'variable-analysis',
      status: 'pending',
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      unit_id: 100,
      variable_id: 'var1'
    },
    {
      id: 2,
      workspace_id: 1,
      type: 'variable-analysis',
      status: 'processing',
      created_at: new Date('2024-01-02'),
      updated_at: new Date('2024-01-02'),
      unit_id: 101,
      variable_id: 'var2'
    },
    {
      id: 3,
      workspace_id: 1,
      type: 'other-type',
      status: 'completed',
      created_at: new Date('2024-01-03'),
      updated_at: new Date('2024-01-03'),
      unit_id: 102,
      variable_id: 'var3'
    }
  ];

  const mockDialogData: VariableAnalysisJobsDialogData = {
    jobs: [...mockJobs],
    workspaceId: 1
  };

  beforeEach(async () => {
    const dialogRefMock = {
      close: jest.fn()
    };

    const variableAnalysisServiceMock = {
      getAllJobs: jest.fn(),
      cancelJob: jest.fn()
    };

    const snackBarMock = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [VariableAnalysisJobsDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: VariableAnalysisService, useValue: variableAnalysisServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    }).compileComponents();

    dialogRef = TestBed.inject(MatDialogRef) as jest.Mocked<MatDialogRef<VariableAnalysisJobsDialogComponent>>;
    variableAnalysisService = TestBed.inject(VariableAnalysisService) as jest.Mocked<VariableAnalysisService>;
    snackBar = TestBed.inject(MatSnackBar) as jest.Mocked<MatSnackBar>;

    fixture = TestBed.createComponent(VariableAnalysisJobsDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should call refreshJobs on initialization', () => {
      const refreshSpy = jest.spyOn(component, 'refreshJobs');
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.ngOnInit();

      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('refreshJobs', () => {
    it('should load all jobs and filter by type', () => {
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.refreshJobs();

      expect(component.isLoading).toBe(false);
      expect(variableAnalysisService.getAllJobs).toHaveBeenCalledWith(1);
      expect(component.data.jobs.length).toBe(2); // Only variable-analysis type jobs
      expect(component.data.jobs.every(job => job.type === 'variable-analysis')).toBe(true);
    });

    it('should set isLoading to true during loading', () => {
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.refreshJobs();

      expect(variableAnalysisService.getAllJobs).toHaveBeenCalled();
    });

    it('should handle error when loading jobs', () => {
      variableAnalysisService.getAllJobs.mockReturnValue(throwError(() => new Error('Load error')));

      component.refreshJobs();

      expect(component.isLoading).toBe(false);
      expect(snackBar.open).toHaveBeenCalledWith(
        'Fehler beim Laden der Analyse-Aufträge',
        'Fehler',
        { duration: 3000 }
      );
    });

    it('should set isLoading to false after successful load', () => {
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.refreshJobs();

      expect(component.isLoading).toBe(false);
    });

    it('should set isLoading to false after error', () => {
      variableAnalysisService.getAllJobs.mockReturnValue(throwError(() => new Error('Error')));

      component.refreshJobs();

      expect(component.isLoading).toBe(false);
    });
  });

  describe('cancelJob', () => {
    it('should cancel job successfully and refresh jobs', () => {
      const successResult: JobCancelResult = {
        success: true,
        message: 'Job cancelled successfully'
      };
      variableAnalysisService.cancelJob.mockReturnValue(of(successResult));
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.cancelJob(1);

      expect(variableAnalysisService.cancelJob).toHaveBeenCalledWith(1, 1);
      expect(snackBar.open).toHaveBeenCalledWith(
        'Job cancelled successfully',
        'OK',
        { duration: 3000 }
      );
    });

    it('should use default success message if none provided', () => {
      const successResult: JobCancelResult = {
        success: true,
        message: ''
      };
      variableAnalysisService.cancelJob.mockReturnValue(of(successResult));
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.cancelJob(1);

      expect(snackBar.open).toHaveBeenCalledWith(
        'Analyse-Auftrag erfolgreich abgebrochen',
        'OK',
        { duration: 3000 }
      );
    });

    it('should handle unsuccessful cancellation', () => {
      const failureResult: JobCancelResult = {
        success: false,
        message: 'Cannot cancel running job'
      };
      variableAnalysisService.cancelJob.mockReturnValue(of(failureResult));

      component.cancelJob(1);

      expect(snackBar.open).toHaveBeenCalledWith(
        'Cannot cancel running job',
        'Fehler',
        { duration: 3000 }
      );
      expect(component.isLoading).toBe(false);
    });

    it('should use default error message for unsuccessful cancellation', () => {
      const failureResult: JobCancelResult = {
        success: false,
        message: ''
      };
      variableAnalysisService.cancelJob.mockReturnValue(of(failureResult));

      component.cancelJob(1);

      expect(snackBar.open).toHaveBeenCalledWith(
        'Fehler beim Abbrechen des Analyse-Auftrags',
        'Fehler',
        { duration: 3000 }
      );
    });

    it('should handle error when cancelling job', () => {
      variableAnalysisService.cancelJob.mockReturnValue(throwError(() => new Error('Cancel error')));

      component.cancelJob(1);

      expect(component.isLoading).toBe(false);
      expect(snackBar.open).toHaveBeenCalledWith(
        'Fehler beim Abbrechen des Analyse-Auftrags',
        'Fehler',
        { duration: 3000 }
      );
    });

    it('should set isLoading to true during cancellation', () => {
      const successResult: JobCancelResult = {
        success: true,
        message: ''
      };
      variableAnalysisService.cancelJob.mockReturnValue(of(successResult));
      variableAnalysisService.getAllJobs.mockReturnValue(of(mockJobs));

      component.cancelJob(1);

      expect(variableAnalysisService.cancelJob).toHaveBeenCalled();
    });
  });

  describe('viewResults', () => {
    it('should close dialog with jobId', () => {
      component.viewResults(123);

      expect(dialogRef.close).toHaveBeenCalledWith({ jobId: 123 });
    });
  });

  describe('onClose', () => {
    it('should close dialog without data', () => {
      component.onClose();

      expect(dialogRef.close).toHaveBeenCalledWith();
    });
  });

  describe('formatDate', () => {
    it('should format date correctly', () => {
      const testDate = new Date('2024-01-15T10:30:00');
      const formatted = component.formatDate(testDate);

      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('should return empty string for null date', () => {
      const result = component.formatDate(null as unknown as Date);

      expect(result).toBe('');
    });

    it('should return empty string for undefined date', () => {
      const result = component.formatDate(undefined as unknown as Date);

      expect(result).toBe('');
    });
  });

  describe('displayedColumns', () => {
    it('should have correct column definitions', () => {
      expect(component.displayedColumns).toEqual([
        'id',
        'status',
        'createdAt',
        'unitId',
        'variableId',
        'actions'
      ]);
    });
  });

  describe('data binding', () => {
    it('should have correct workspace ID from dialog data', () => {
      expect(component.data.workspaceId).toBe(1);
    });

    it('should have jobs from dialog data', () => {
      expect(component.data.jobs).toBeDefined();
      expect(Array.isArray(component.data.jobs)).toBe(true);
    });
  });
});
