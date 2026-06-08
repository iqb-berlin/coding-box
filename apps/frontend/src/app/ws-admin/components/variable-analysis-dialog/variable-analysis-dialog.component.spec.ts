import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick
} from '@angular/core/testing';
import {
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialog
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import {
  VariableAnalysisDialogComponent,
  VariableAnalysisData
} from './variable-analysis-dialog.component';
import {
  VariableAnalysisResultPageDto,
  VariableAnalysisService
} from '../../../shared/services/response/variable-analysis.service';
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
        id: 1,
        unitid: 10,
        variableid: 'VAR1',
        status: 'VALUE',
        value: 'Val1',
        subform: ''
      },
      {
        id: 2,
        unitid: 10,
        variableid: 'VAR1',
        status: 'VALUE',
        value: 'Val1',
        subform: ''
      },
      {
        id: 3,
        unitid: 10,
        variableid: 'VAR2',
        status: 'VALUE',
        value: 'Val2',
        subform: ''
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
      exportAnalysisResultsAsCsv: jest.fn().mockReturnValue(
        of(new Blob(['csv'], { type: 'text/csv' }))
      ),
      exportAnalysisResultsAsXlsx: jest.fn().mockReturnValue(
        of(new Blob(['xlsx'], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }))
      ),
      getAnalysisResults: jest
        .fn()
        .mockReturnValue(of({ variableCombos: [], frequencies: {}, total: 0 })),
      getAnalysisResultsPage: jest.fn().mockReturnValue(
        of({
          variableCombos: [],
          frequencies: {},
          total: 0,
          unfilteredTotal: 0,
          page: 1,
          pageSize: 50,
          totalPages: 0
        })
      )
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
        {
          provide: VariableAnalysisService,
          useValue: mockVariableAnalysisService
        },
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
      expect(component.variableFrequencies[comboKey][0].percentage).toBe(
        (2 / 2) * 100
      );
      expect(component.variableFrequencies[comboKey][0].percentageValid).toBe(
        100
      );
      expect(
        component.allVariableCombos.find(combo => combo.variableId === 'VAR1')
      ).toEqual(expect.objectContaining({
        totalCount: 2,
        validCount: 2,
        invalidCount: 0
      }));
    });

    it('should use analysisResults if provided', () => {
      component.data.analysisResults = {
        variableCombos: [
          { unitId: 10, unitName: 'Unit 10', variableId: 'VAR1' }
        ],
        frequencies: {
          '10:VAR1': [
            {
              unitId: 10,
              variableId: 'VAR1',
              value: 'Result1',
              count: 5,
              percentage: 50
            }
          ]
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
      component.onSearchChange({
        target: { value: 'VAR1' }
      } as unknown as Event);
      tick(300);

      expect(component.variableCombos.length).toBe(1);
      expect(component.variableCombos[0].variableId).toBe('VAR1');
    }));

    it('should render filtered analysis table rows', fakeAsync(() => {
      const getAnalysisTableText = (): string => (
        fixture.nativeElement.querySelector('.analysis-table')?.textContent || ''
      );

      component.data.analysisResults = undefined;
      component.analyzeVariables();
      fixture.detectChanges();
      let tableText = getAnalysisTableText();

      expect(tableText).toContain('VAR1');
      expect(tableText).toContain('Val1');

      component.onSearchChange({
        target: { value: 'VAR2' }
      } as unknown as Event);
      tick(300);
      fixture.detectChanges();
      tableText = getAnalysisTableText();

      expect(component.analysisRows.map(row => row.variableId)).toEqual([
        'VAR2'
      ]);
      expect(tableText).toContain('VAR2');
      expect(tableText).toContain('Val2');
      expect(tableText).not.toContain('VAR1');
    }));

    it('should keep rows with missing labels last when sorting descending', () => {
      component.data.analysisResults = {
        variableCombos: [
          { unitId: 10, unitName: 'Unit 10', variableId: 'VAR1' }
        ],
        frequencies: {
          '10:VAR1': [
            {
              unitId: 10,
              variableId: 'VAR1',
              value: 'missing',
              count: 1,
              percentage: 33.3
            },
            {
              unitId: 10,
              variableId: 'VAR1',
              value: 'alpha',
              label: 'Alpha',
              count: 1,
              percentage: 33.3
            },
            {
              unitId: 10,
              variableId: 'VAR1',
              value: 'beta',
              label: 'Beta',
              count: 1,
              percentage: 33.3
            }
          ]
        },
        total: 1
      };

      component.analyzeVariables();
      component.onSortChange({ active: 'label', direction: 'desc' });

      expect(component.analysisRows.map(row => row.value)).toEqual([
        'beta',
        'alpha',
        'missing'
      ]);
    });
  });

  describe('empty state', () => {
    it('should distinguish no analysis from filtered server-side results', () => {
      component.data.analysisResults = undefined;
      component.allVariableCombos = [];
      component.activeJob = undefined;
      component.isStartingJob = false;

      expect(component.getEmptyStateMessageKey()).toBe(
        'variable-analysis.no-results-yet'
      );
      expect(component.shouldShowStartAnalysisButton()).toBe(true);

      component.data.analysisResults = {
        variableCombos: [],
        frequencies: {},
        total: 0,
        unfilteredTotal: 3,
        page: 1,
        pageSize: 50,
        totalPages: 0
      };

      expect(component.getEmptyStateMessageKey()).toBe(
        'variable-analysis.no-variables-found'
      );
      expect(component.shouldShowStartAnalysisButton()).toBe(false);
    });
  });

  describe('status labels', () => {
    it('should use centralized response status labels', () => {
      expect(component.getStatusLabel(8)).toBe('CODING_INCOMPLETE');
      expect(component.getStatusLabel('4')).toBe('DERIVE_ERROR');
      expect(component.getStatusLabel('4abc')).toBe('4abc');
    });
  });

  describe('refreshJobs', () => {
    it('should load jobs from service', () => {
      component.refreshJobs();
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalledWith(1);
      expect(component.jobs.length).toBe(1);
    });

    it('should show error snackbar on failure', () => {
      mockVariableAnalysisService.getAllJobs.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.refreshJobs();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('startNewAnalysis', () => {
    it('should call service and refresh jobs', () => {
      component.activeJob = undefined;
      component.startNewAnalysis();
      expect(
        mockVariableAnalysisService.createAnalysisJob
      ).toHaveBeenCalledWith(1, 10);
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

    it('should stop loading when deleting the job currently loading results', () => {
      const pendingResults = new Subject<VariableAnalysisResultPageDto>();
      const dismissLoadingResults = jest.fn();
      mockSnackBar.open.mockReturnValueOnce({
        dismiss: dismissLoadingResults
      } as never);
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValue(
        pendingResults
      );

      component.viewJobResults(1);
      expect(component.isLoading).toBe(true);

      component.deleteJob(1);

      expect(component.isLoading).toBe(false);
      expect(component.data.analysisResults).toBeUndefined();
      expect(dismissLoadingResults).toHaveBeenCalled();
    });
  });

  describe('viewJobResults', () => {
    it('should load results and call analyzeVariables', () => {
      const mockResults = {
        variableCombos: [],
        frequencies: {},
        total: 0,
        unfilteredTotal: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0
      };
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValue(
        of(mockResults)
      );
      const analyzeSpy = jest.spyOn(component, 'analyzeVariables');

      component.viewJobResults(1);

      expect(
        mockVariableAnalysisService.getAnalysisResultsPage
      ).toHaveBeenCalledWith(1, 1, {
        page: 1,
        pageSize: 50,
        search: '',
        onlyEmpty: false,
        includeSchemaCodes: false,
        sortBy: 'unitName',
        sortDirection: 'asc'
      });
      expect(analyzeSpy).toHaveBeenCalled();
    });

    it('uses the pageable row total for server-side pagination limits', () => {
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValue(
        of({
          variableCombos: [],
          frequencies: {},
          total: 25,
          unfilteredTotal: 25,
          rows: [
            {
              unitId: 1,
              unitName: 'Unit 1',
              variableId: 'VAR1',
              value: 'A',
              count: 10,
              percentage: 100,
              totalCount: 10,
              emptyCount: 0,
              emptyPercentage: 0,
              distinctValueCount: 1,
              hiddenValueCount: 0,
              statusSummary: ''
            }
          ],
          rowTotal: 1000,
          pageableRowTotal: 100,
          maxPage: 2,
          page: 1,
          pageSize: 50,
          totalPages: 2
        })
      );

      component.viewJobResults(1);
      fixture.detectChanges();

      expect(component.getTotalFilteredVariables()).toBe(100);
      expect(component.hasLimitedPageableRows()).toBe(true);
      expect(component.getPageableRowLimitInfoParams()).toEqual({
        pageable: 100,
        total: 1000,
        maxPage: 2
      });
      expect(
        fixture.nativeElement.querySelector('.page-window-message')
      ).not.toBeNull();
      expect(component.currentPage).toBe(0);
    });

    it('reloads server-side results when schema code visibility changes', () => {
      component.viewJobResults(1);
      mockVariableAnalysisService.getAnalysisResultsPage.mockClear();

      component.includeSchemaCodes = true;
      component.onSchemaCodesToggleChange();

      expect(
        mockVariableAnalysisService.getAnalysisResultsPage
      ).toHaveBeenCalledWith(1, 1, {
        page: 1,
        pageSize: 50,
        search: '',
        onlyEmpty: false,
        includeSchemaCodes: true,
        sortBy: 'unitName',
        sortDirection: 'asc'
      });
    });

    it('reloads server-side results when sorting changes', () => {
      component.viewJobResults(1);
      mockVariableAnalysisService.getAnalysisResultsPage.mockClear();

      component.onSortChange({ active: 'count', direction: 'desc' });

      expect(component.sortBy).toBe('count');
      expect(component.sortDirection).toBe('desc');
      expect(
        mockVariableAnalysisService.getAnalysisResultsPage
      ).toHaveBeenCalledWith(1, 1, {
        page: 1,
        pageSize: 50,
        search: '',
        onlyEmpty: false,
        includeSchemaCodes: false,
        sortBy: 'count',
        sortDirection: 'desc'
      });
    });

    it('should dismiss stale loading snackbars without applying stale results', fakeAsync(() => {
      const firstResults = new Subject<VariableAnalysisResultPageDto>();
      const secondResults = new Subject<VariableAnalysisResultPageDto>();
      const firstDismiss = jest.fn();
      mockSnackBar.open.mockReturnValueOnce({
        dismiss: firstDismiss
      } as never);
      mockVariableAnalysisService.getAnalysisResultsPage
        .mockReturnValueOnce(firstResults)
        .mockReturnValueOnce(secondResults);

      component.viewJobResults(1);
      component.onSearchChange({
        target: { value: 'VAR' }
      } as unknown as Event);
      tick(300);

      firstResults.next({
        variableCombos: [],
        frequencies: {},
        total: 1,
        unfilteredTotal: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1
      });

      expect(firstDismiss).toHaveBeenCalled();
      expect(component.data.analysisResults?.total).not.toBe(1);
    }));
  });

  describe('downloadAnalysisResults', () => {
    it('should export the current completed analysis with active filters', () => {
      Object.defineProperty(window.URL, 'createObjectURL', {
        value: jest.fn().mockReturnValue('blob:variable-analysis'),
        writable: true
      });
      Object.defineProperty(window.URL, 'revokeObjectURL', {
        value: jest.fn(),
        writable: true
      });
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(jest.fn());

      component.viewJobResults(1);
      component.searchText = 'VAR';
      component.onlyWithEmptyValues = true;

      expect(component.canExportAnalysisResults()).toBe(true);
      component.downloadAnalysisResults('csv');

      expect(
        mockVariableAnalysisService.exportAnalysisResultsAsCsv
      ).toHaveBeenCalledWith(1, 1, {
        search: 'VAR',
        onlyEmpty: true,
        includeSchemaCodes: false
      });
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
        'blob:variable-analysis'
      );

      clickSpy.mockRestore();
    });
  });
});
