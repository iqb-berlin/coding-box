import {
  ComponentFixture, TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { VariableAnalysisDialogComponent, VariableAnalysisData } from './variable-analysis-dialog.component';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';

describe('VariableAnalysisDialogComponent', () => {
  let component: VariableAnalysisDialogComponent;
  let fixture: ComponentFixture<VariableAnalysisDialogComponent>;
  let mockDialogRef: jest.Mocked<MatDialogRef<VariableAnalysisDialogComponent>>;
  let mockVariableAnalysisService: jest.Mocked<VariableAnalysisService>;
  let mockSnackBar: jest.Mocked<MatSnackBar>;
  let mockDialog: jest.Mocked<MatDialog>;

  const mockJobs: VariableAnalysisJobDto[] = [
    {
      id: 1,
      workspace_id: 1,
      type: 'variable-analysis',
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      unit_id: 10,
      variable_id: 'VAR1'
    }
  ];

  const mockDialogData: VariableAnalysisData = {
    unitId: 10,
    title: 'Test Unit',
    workspaceId: 1,
    responses: [
      {
        id: 1, unitid: 10, variableid: 'VAR1', status: 'VALUE', value: 'Val1', subform: ''
      },
      {
        id: 2, unitid: 10, variableid: 'VAR1', status: 'VALUE', value: 'Val1', subform: ''
      },
      {
        id: 3, unitid: 10, variableid: 'VAR2', status: 'VALUE', value: 'Val2', subform: ''
      }
    ]
  };

  beforeEach(async () => {
    mockDialogRef = {
      close: jest.fn()
    } as unknown as jest.Mocked<MatDialogRef<VariableAnalysisDialogComponent>>;

    mockVariableAnalysisService = {
      getAllJobs: jest.fn().mockReturnValue(of(mockJobs)),
      createAnalysisJob: jest.fn().mockReturnValue(of(mockJobs[0])),
      cancelJob: jest.fn().mockReturnValue(of({ success: true })),
      deleteJob: jest.fn().mockReturnValue(of({ success: true })),
      getAnalysisResults: jest.fn().mockReturnValue(of({ variableCombos: [], frequencies: {}, total: 0 }))
    } as unknown as jest.Mocked<VariableAnalysisService>;

    mockSnackBar = {
      open: jest.fn().mockReturnValue({ dismiss: jest.fn() })
    } as unknown as jest.Mocked<MatSnackBar>;

    mockDialog = {
      open: jest.fn().mockReturnValue({
        afterClosed: jest.fn().mockReturnValue(of(true))
      })
    } as unknown as jest.Mocked<MatDialog>;

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        VariableAnalysisDialogComponent
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: VariableAnalysisService, useValue: mockVariableAnalysisService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: MatDialog, useValue: mockDialog }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VariableAnalysisDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('analyzeVariables', () => {
    it('should calculate frequencies from responses if no analysisResults provided', () => {
      component.analyzeVariables();

      const comboKey = '0:VAR1';
      expect(component.variableFrequencies[comboKey]).toBeDefined();
      expect(component.variableFrequencies[comboKey][0].value).toBe('Val1');
      expect(component.variableFrequencies[comboKey][0].count).toBe(2);
      expect(component.variableFrequencies[comboKey][0].percentage).toBe((2 / 2) * 100);
    });

    it('should use analysisResults if provided', () => {
      component.data.analysisResults = {
        variableCombos: [{ unitId: 10, unitName: 'Unit 10', variableId: 'VAR1' }],
        frequencies: {
          '10:VAR1': [{
            unitId: 10, variableId: 'VAR1', value: 'Result1', count: 5, percentage: 50
          }]
        },
        total: 10
      };

      component.analyzeVariables();

      const comboKey = '10:VAR1';
      expect(component.variableFrequencies[comboKey]).toBeDefined();
      expect(component.variableFrequencies[comboKey][0].value).toBe('Result1');
    });
  });

  describe('filterVariables', () => {
    it('should filter variables based on searchText', fakeAsync(() => {
      component.onSearchChange({ target: { value: 'VAR1' } } as unknown as Event);
      tick(300);

      expect(component.variableCombos.length).toBe(1);
      expect(component.variableCombos[0].variableId).toBe('VAR1');
    }));
  });

  describe('refreshJobs', () => {
    it('should load jobs from service', () => {
      component.refreshJobs();
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalledWith(1);
      expect(component.jobs.length).toBe(1);
    });

    it('should show error snackbar on failure', () => {
      mockVariableAnalysisService.getAllJobs.mockReturnValue(throwError(() => new Error('error')));
      component.refreshJobs();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('startNewAnalysis', () => {
    it('should call service and refresh jobs', () => {
      component.startNewAnalysis();
      expect(mockVariableAnalysisService.createAnalysisJob).toHaveBeenCalledWith(1, 10);
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalled();
    });
  });

  describe('cancelJob', () => {
    it('should call service and refresh jobs', () => {
      component.cancelJob(1);
      expect(mockVariableAnalysisService.cancelJob).toHaveBeenCalledWith(1, 1);
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalled();
    });
  });

  describe('deleteJob', () => {
    it('should open confirm dialog and call service if confirmed', () => {
      component.deleteJob(1);
      expect(mockDialog.open).toHaveBeenCalled();
      expect(mockVariableAnalysisService.deleteJob).toHaveBeenCalledWith(1, 1);
    });
  });

  describe('viewJobResults', () => {
    it('should load results and call analyzeVariables', () => {
      const mockResults = { variableCombos: [], frequencies: {}, total: 0 };
      mockVariableAnalysisService.getAnalysisResults.mockReturnValue(of(mockResults));
      const analyzeSpy = jest.spyOn(component, 'analyzeVariables');

      component.viewJobResults(1);

      expect(mockVariableAnalysisService.getAnalysisResults).toHaveBeenCalledWith(1, 1);
      expect(analyzeSpy).toHaveBeenCalled();
    });
  });
});
