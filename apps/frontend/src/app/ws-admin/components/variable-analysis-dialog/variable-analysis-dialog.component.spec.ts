import { provideZonelessChangeDetection } from '@angular/core';
import { delay } from 'rxjs/operators';
import {
  ComponentFixture,
  TestBed
} from '@angular/core/testing';
import {
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialog
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
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
        status: 'VALUE_CHANGED',
        value: 'Val1',
        subform: ''
      },
      {
        id: 2,
        unitid: 10,
        variableid: 'VAR1',
        status: 'VALUE_CHANGED',
        value: 'Val1',
        subform: ''
      },
      {
        id: 3,
        unitid: 10,
        variableid: 'VAR2',
        status: 'VALUE_CHANGED',
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
      ),
      setVariableAnalysisGuardRunning: jest.fn(),
      trackVariableAnalysisGuardUntilComplete: jest.fn()
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
        TranslateModule.forRoot(),
        VariableAnalysisDialogComponent
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { ...mockDialogData } },
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

  it.each(['provided', 'loaded'])('allows choosing the first code analysis with %s empty jobs', source => {
    fixture.destroy();
    component.data.responses = [];
    component.data.jobs = source === 'provided' ? [] : undefined;
    mockVariableAnalysisService.getAllJobs.mockReturnValue(of([]));
    mockVariableAnalysisService.createAnalysisJob.mockReturnValue(new Subject<VariableAnalysisJobDto>());
    fixture = TestBed.createComponent(VariableAnalysisDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(mockVariableAnalysisService.createAnalysisJob).not.toHaveBeenCalled();
    expect(component.activeJob()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.analysis-options mat-select').getAttribute('aria-disabled')).toBe('false');

    component.newAnalysisMode.set('codes');
    component.newCodingVersion.set('v2');
    fixture.detectChanges();
    fixture.nativeElement.querySelectorAll('.top-actions button')[1].click();

    expect(mockVariableAnalysisService.createAnalysisJob).toHaveBeenCalledTimes(1);
    expect(mockVariableAnalysisService.createAnalysisJob).toHaveBeenCalledWith(
      1, 10, undefined, { analysisMode: 'codes', codingVersion: 'v2' }
    );
  });

  it('should keep tracking the response-analysis guard after destroy while a job is active', () => {
    expect(component.activeJob()).toBeDefined();

    component.ngOnDestroy();

    expect(
      mockVariableAnalysisService.trackVariableAnalysisGuardUntilComplete
    ).toHaveBeenCalledWith(1);
  });

  describe('analyzeVariables', () => {
    it('renders a truncated empty response as empty and retains its flag in the local projection', () => {
      const preview = `${' '.repeat(500)}... [truncated 1000 chars, md5:test]`;
      component.data.analysisResults = {
        total: 1,
        variableCombos: [{
          unitId: 10, unitName: 'UNIT', variableId: 'VAR', totalCount: 2, validCount: 1, emptyCount: 1
        }],
        frequencies: {
          '10:VAR': [
            {
              unitId: 10, variableId: 'VAR', value: preview, count: 1, percentage: 50, isEmptyValue: true
            },
            {
              unitId: 10, variableId: 'VAR', value: `${preview}x`, count: 1, percentage: 50, isEmptyValue: false
            }
          ]
        }
      };
      component.analyzeVariables();
      fixture.detectChanges();

      const cells = fixture.nativeElement.querySelectorAll('td.mat-column-value');
      expect(cells).toHaveLength(2);
      expect(cells[0].querySelector('.empty-value')?.textContent).toContain('variable-analysis.empty-value');
      expect(cells[1].querySelector('.empty-value')).toBeNull();
      expect(component.analysisRows()[0]).toMatchObject({ isEmptyValue: true, validOccurrenceCount: 0 });
      expect(component.analysisRows()[1]).toMatchObject({ isEmptyValue: false, validOccurrenceCount: 1 });
    });

    it('should calculate frequencies from responses if no analysisResults provided', () => {
      component.analyzeVariables();

      const comboKey = '0:VAR1';
      expect(component.variableFrequencies()[comboKey]).toBeDefined();
      expect(component.variableFrequencies()[comboKey][0].value).toBe('Val1');
      expect(component.variableFrequencies()[comboKey][0].count).toBe(2);
      expect(component.variableFrequencies()[comboKey][0].percentage).toBe(
        (2 / 2) * 100
      );
      expect(component.variableFrequencies()[comboKey][0].percentageValid).toBe(
        100
      );
      expect(
        component.allVariableCombos().find(combo => combo.variableId === 'VAR1')
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
      expect(component.variableFrequencies()[comboKey]).toBeDefined();
      expect(component.variableFrequencies()[comboKey][0].value).toBe('Result1');
    });
  });

  describe('filterVariables', () => {
    it('should filter variables based on searchText', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
      component.onSearchChange({
        target: { value: 'VAR1' }
      } as unknown as Event);
      jest.advanceTimersByTime(300);
      jest.useRealTimers();

      expect(component.variableCombos().length).toBe(1);
      expect(component.variableCombos()[0].variableId).toBe('VAR1');
    });

    it('should render filtered analysis table rows', async () => {
      const getAnalysisTableText = (): string => (
        fixture.nativeElement.querySelector('.analysis-table')?.textContent || ''
      );

      component.data.analysisResults = undefined;
      component.analyzeVariables();
      fixture.detectChanges();
      let tableText = getAnalysisTableText();

      expect(tableText).toContain('VAR1');
      expect(tableText).toContain('Val1');

      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
      component.onSearchChange({
        target: { value: 'VAR2' }
      } as unknown as Event);
      jest.advanceTimersByTime(300);
      jest.useRealTimers();
      fixture.detectChanges();
      tableText = getAnalysisTableText();

      expect(component.analysisRows().map(row => row.variableId)).toEqual([
        'VAR2'
      ]);
      expect(tableText).toContain('VAR2');
      expect(tableText).toContain('Val2');
      expect(tableText).not.toContain('VAR1');
    });

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

      expect(component.analysisRows().map(row => row.value)).toEqual([
        'beta',
        'alpha',
        'missing'
      ]);
    });
  });

  describe('empty state', () => {
    it('should distinguish no analysis from filtered server-side results', () => {
      component.data.analysisResults = undefined;
      component.allVariableCombos.set([]);
      component.activeJob.set(undefined);
      component.isStartingJob.set(false);

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
      expect(component.jobs().length).toBe(1);
    });

    it('should show error snackbar on failure', () => {
      mockVariableAnalysisService.getAllJobs.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.refreshJobs();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should not clear the response-analysis guard when the initial job load fails', () => {
      fixture.destroy();
      mockVariableAnalysisService.getAllJobs.mockReturnValue(
        throwError(() => new Error('network error'))
      );
      mockVariableAnalysisService.setVariableAnalysisGuardRunning.mockClear();
      mockVariableAnalysisService
        .trackVariableAnalysisGuardUntilComplete
        .mockClear();

      const failingFixture = TestBed.createComponent(
        VariableAnalysisDialogComponent
      );
      failingFixture.detectChanges();
      failingFixture.destroy();

      expect(
        mockVariableAnalysisService.setVariableAnalysisGuardRunning
      ).not.toHaveBeenCalledWith(1, false);
      expect(
        mockVariableAnalysisService.trackVariableAnalysisGuardUntilComplete
      ).not.toHaveBeenCalled();
    });
  });

  describe('startNewAnalysis', () => {
    it('should call service and refresh jobs', () => {
      component.activeJob.set(undefined);
      component.startNewAnalysis();
      expect(
        mockVariableAnalysisService.createAnalysisJob
      ).toHaveBeenCalledWith(1, 10, undefined, { analysisMode: 'values', codingVersion: undefined });
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalled();
    });

    it('should keep the response-analysis guard active if refreshing jobs fails after starting analysis', () => {
      const startedJob: VariableAnalysisJobDto = {
        ...mockJobs[0],
        id: 2,
        status: 'pending'
      };
      component.activeJob.set(undefined);
      component.jobs.set([]);
      mockVariableAnalysisService.createAnalysisJob.mockReturnValueOnce(
        of(startedJob)
      );
      mockVariableAnalysisService.getAllJobs.mockClear();
      mockVariableAnalysisService.getAllJobs.mockReturnValueOnce(
        throwError(() => new Error('network error'))
      );
      mockVariableAnalysisService.setVariableAnalysisGuardRunning.mockClear();

      component.startNewAnalysis();

      expect(component.activeJob()).toEqual(startedJob);
      expect(mockVariableAnalysisService.getAllJobs).toHaveBeenCalledTimes(1);
      expect(
        mockVariableAnalysisService.setVariableAnalysisGuardRunning
      ).toHaveBeenCalledWith(1, true);
      expect(
        mockVariableAnalysisService.setVariableAnalysisGuardRunning
      ).not.toHaveBeenCalledWith(1, false);
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
      expect(component.isLoading()).toBe(true);

      component.deleteJob(1);

      expect(component.isLoading()).toBe(false);
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
      expect(component.currentPage()).toBe(0);
    });

    it('reloads server-side results when schema code visibility changes', () => {
      component.viewJobResults(1);
      mockVariableAnalysisService.getAnalysisResultsPage.mockClear();

      component.includeSchemaCodes.set(true);
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

    it('marks observed answers from the schema without marking zero-count placeholders', () => {
      component.data.analysisResults = {
        variableCombos: [{
          unitId: 10, unitName: 'Unit 10', variableId: 'VAR1', totalCount: 2
        }],
        frequencies: {
          '10:VAR1': [
            {
              unitId: 10, variableId: 'VAR1', value: 'Hai', count: 2, percentage: 100, score: 1, code: 0, isFromSchema: true
            },
            {
              unitId: 10, variableId: 'VAR1', value: '', count: 0, percentage: 0, isSchemaOnly: true
            }
          ]
        },
        total: 1
      };
      component.analyzeVariables();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.schema-chip')).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('.mat-column-code').textContent).toContain('variable-analysis.code-column');
      expect(fixture.nativeElement.querySelector('.schema-chip').closest('tr').querySelector('.mat-column-code').textContent.trim()).toBe('0');
      expect(component.analysisRows().find(row => row.value === 'Hai')).toMatchObject({
        isFromSchema: true, count: 2, score: 1, code: 0
      });
    });

    it('asks for a new analysis and clears old results when the evaluation has changed', () => {
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValue(throwError(() => ({
        error: { code: 'VARIABLE_ANALYSIS_OUTDATED' }
      })));
      component.viewJobResults(1);
      expect(mockSnackBar.open).toHaveBeenLastCalledWith('variable-analysis.results-outdated', 'error.error_title', { duration: 3000 });
      expect(component.analysisRows()).toEqual([]);
      expect(component.canExportAnalysisResults()).toBe(false);
    });

    it('reloads server-side results when sorting changes', () => {
      component.viewJobResults(1);
      mockVariableAnalysisService.getAnalysisResultsPage.mockClear();

      component.onSortChange({ active: 'count', direction: 'desc' });

      expect(component.sortBy()).toBe('count');
      expect(component.sortDirection()).toBe('desc');
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

    it('should dismiss stale loading snackbars without applying stale results', async () => {
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
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
      component.onSearchChange({
        target: { value: 'VAR' }
      } as unknown as Event);
      jest.advanceTimersByTime(300);
      jest.useRealTimers();

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
    });
  });

  describe('downloadAnalysisResults', () => {
    it.each(['csv', 'xlsx'] as const)('keeps the original mode and coding run in a delayed %s export after viewing another job', format => {
      const page: VariableAnalysisResultPageDto = {
        variableCombos: [{
          unitId: 10, unitName: 'UNIT', variableId: 'VAR', analysisMode: 'codes', codingVersion: 'v2'
        }],
        frequencies: {},
        total: 1,
        unfilteredTotal: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1
      };
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValueOnce(of(page));
      component.viewJobResults(1);
      const exportResponse = new Subject<Blob>();
      const exportMethod = format === 'csv' ?
        mockVariableAnalysisService.exportAnalysisResultsAsCsv :
        mockVariableAnalysisService.exportAnalysisResultsAsXlsx;
      exportMethod.mockReturnValue(exportResponse);
      const saveSpy = jest.spyOn(component as unknown as { saveBlob(blob: Blob, name: string): void }, 'saveBlob').mockImplementation(jest.fn());

      component.downloadAnalysisResults(format);
      mockVariableAnalysisService.getAnalysisResultsPage.mockReturnValueOnce(of({
        ...page,
        variableCombos: [{
          unitId: 10, unitName: 'UNIT', variableId: 'VAR', analysisMode: 'values'
        }]
      }));
      component.viewJobResults(2);
      const blob = new Blob(['code result']);
      exportResponse.next(blob);
      exportResponse.complete();

      expect(exportMethod).toHaveBeenCalledWith(1, 1, expect.any(Object));
      expect(saveSpy).toHaveBeenCalledWith(blob, expect.stringMatching(new RegExp(`^variable-analysis-1-codes-v2-.*\\.${format}$`)));
    });

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
      component.searchText.set('VAR');
      component.onlyWithEmptyValues.set(true);

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
  it('renders a delayed server response without another user action', async () => {
    const backend = TestBed.inject(VariableAnalysisService);
    const response = backend.getAllJobs(1).pipe(delay(30));
    jest.spyOn(backend, 'getAllJobs').mockReturnValue(response);
    fixture.destroy();
    fixture = TestBed.createComponent(VariableAnalysisDialogComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    await new Promise<void>(resolve => { setTimeout(resolve, 80); });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('variable-analysis.analysis-running');
  });
  it('starts a code analysis for the selected run without changing the displayed result mode', () => {
    component.activeJob.set(undefined);
    component.newAnalysisMode.set('codes');
    component.newCodingVersion.set('v2');
    component.startNewAnalysis();
    expect(mockVariableAnalysisService.createAnalysisJob).toHaveBeenCalledWith(1, 10, undefined, { analysisMode: 'codes', codingVersion: 'v2' });
    expect(component.resultAnalysisMode()).toBe('values');
  });

  it('shows code labels, zero scores, missing counts and one status summary per variable', () => {
    component.data.analysisResults = {
      total: 1,
      variableCombos: [{
        unitId: 10, unitName: 'UNIT', variableId: 'VAR', analysisMode: 'codes', codingVersion: 'v2', totalCount: 3, validCount: 2, invalidCount: 1, emptyCount: 0, statusCounts: [{ status: 5, count: 2, percentage: 200 / 3 }]
      }],
      frequencies: {
        '10:VAR': [
          {
            unitId: 10, variableId: 'VAR', value: '0', label: 'Incorrect', score: 0, count: 1, percentage: 100 / 3
          },
          {
            unitId: 10, variableId: 'VAR', value: '1', label: 'Correct', count: 1, percentage: 100 / 3
          }
        ]
      }
    };
    component.analyzeVariables();
    fixture.detectChanges();
    expect(component.resultCodingVersion()).toBe('v2');
    expect(fixture.nativeElement.querySelector('th.mat-column-value').textContent).toContain('variable-analysis.code-column');
    expect(fixture.nativeElement.querySelector('td.mat-column-score').textContent.trim()).toBe('0');
    expect(fixture.nativeElement.querySelector('td.mat-column-invalidCount').textContent.trim()).toBe('1');
    const columns = Array.from(fixture.nativeElement.querySelectorAll('.analysis-table th') as NodeListOf<HTMLElement>);
    expect(columns.findIndex(cell => cell.classList.contains('mat-column-invalidCount'))).toBeLessThan(columns.findIndex(cell => cell.classList.contains('mat-column-value')));
    expect(fixture.nativeElement.querySelector('th.mat-column-code')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.variable-status-entry')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('.analysis-table .mat-column-statusSummary')).toHaveLength(0);
    component.data.analysisResults.variableCombos[0].analysisMode = 'values';
    component.analyzeVariables();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('td.mat-column-score').textContent.trim()).toBe('0');
    expect(fixture.nativeElement.querySelector('th.mat-column-code')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('th.mat-column-value').textContent).toContain('variable-analysis.value-category-column');
  });

  it.each(['v1', 'v2', 'v3'] as const)('renders special zero codes separately from regular zero for %s', codingVersion => {
    component.data.analysisResults = {
      total: 1,
      variableCombos: [{
        unitId: 10,
        unitName: 'UNIT',
        variableId: 'VAR',
        analysisMode: 'codes',
        codingVersion,
        totalCount: 3,
        validCount: 2,
        invalidCount: 1,
        distinctValueCount: 3,
        emptyCount: 0
      }],
      frequencies: {
        '10:VAR': [
          {
            unitId: 10, variableId: 'VAR', value: '0', label: 'Richtig', score: 1, count: 1, validOccurrenceCount: 1, percentage: 100 / 3
          },
          {
            unitId: 10, variableId: 'VAR', value: '0 (INTENDED_INCOMPLETE)', label: 'Unvollständig', score: 0, count: 1, validOccurrenceCount: 1, percentage: 100 / 3
          },
          {
            unitId: 10, variableId: 'VAR', value: '0 (INVALID)', label: 'Ungültig', score: 0, count: 1, validOccurrenceCount: 0, percentage: 100 / 3
          }
        ]
      }
    };
    component.analyzeVariables();
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.analysis-table tbody tr') as NodeListOf<HTMLElement>);
    const cell = (row: HTMLElement, column: string) => row.querySelector(`.mat-column-${column}`)?.textContent?.trim();
    expect(rows.map(row => ['value', 'label', 'score', 'count', 'validOccurrenceCount', 'percentageValid'].map(column => cell(row, column)))).toEqual([
      ['0', 'Richtig', '1', '1', '1', '50.0%'],
      ['0 (INTENDED_INCOMPLETE)', 'Unvollständig', '0', '1', '1', '50.0%'],
      ['0 (INVALID)', 'Ungültig', '0', '1', '0', '0.0%']
    ]);
    expect(component.resultCodingVersion()).toBe(codingVersion);
    expect(component.analysisRows().every(row => !row.isSchemaOnly)).toBe(true);
  });

  it.each(['null', 'NULL', ' null '])('preserves the literal answer %s in the local response preview', value => {
    component.data.analysisResults = undefined;
    component.data.responses = [
      {
        id: 1, unitid: 10, variableid: 'VAR', value, status: 'VALUE_CHANGED', subform: ''
      },
      {
        id: 2, unitid: 10, variableid: 'VAR', value: '', status: 'VALUE_CHANGED', subform: ''
      }
    ];
    component.analyzeVariables();
    expect(component.allVariableCombos()[0]).toMatchObject({
      totalCount: 2, validCount: 1, invalidCount: 1, emptyCount: 1
    });
    expect(component.variableFrequencies()['0:VAR'].find(row => row.value === value)).toMatchObject({
      count: 1, validOccurrenceCount: 1, percentageTotal: 50, percentageValid: 100
    });
  });

  it('uses the same raw-value validity rules for the local response preview', () => {
    component.data.analysisResults = undefined;
    component.data.responses = [
      {
        id: 1, unitid: 10, variableid: 'VAR', value: 'A', status: 'VALUE_CHANGED', subform: ''
      },
      {
        id: 2, unitid: 10, variableid: 'VAR', value: 'A', status: 'INVALID', subform: ''
      },
      {
        id: 3, unitid: 10, variableid: 'VAR', value: '   ', status: 'VALUE_CHANGED', subform: ''
      }
    ];
    component.analyzeVariables();
    expect(component.allVariableCombos()[0]).toMatchObject({
      totalCount: 3, validCount: 1, invalidCount: 2, emptyCount: 1
    });
    expect(component.variableFrequencies()['0:VAR'].find(row => row.value === 'A')).toMatchObject({ count: 2, validOccurrenceCount: 1, percentageValid: 100 });
  });
});
