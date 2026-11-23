import {
  ComponentFixture, TestBed
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CodebookExportComponent } from '@iqb/ngx-coding-components/codebook-export';
import { DatePipe } from '@angular/common';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  of, throwError, Subject
} from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { ExportCodingBookComponent } from './export-coding-book.component';
import { CodingExportService } from '../../services/coding-export.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { CodebookJobDefinitionPickerDialogComponent } from './codebook-job-definition-picker-dialog.component';

describe('ExportCodingBookComponent', () => {
  let component: ExportCodingBookComponent;
  let fixture: ComponentFixture<ExportCodingBookComponent>;
  let exportService: jest.Mocked<CodingExportService>;
  let codingJobBackendService: jest.Mocked<CodingJobBackendService>;
  let missingsProfileService: jest.Mocked<MissingsProfileService>;
  let fileService: jest.Mocked<FileService>;
  let appService: jest.Mocked<AppService>;
  let matDialog: jest.Mocked<MatDialog>;
  let workspaceChanges: Subject<number>;
  let dialogClosing: Subject<void>;
  let closeDialog: jest.Mock;

  const mockUnits = [
    {
      id: 1,
      unitId: 'unit1',
      fileName: 'test1.vocs',
      data: JSON.stringify({
        variableCodings: [{ id: 'VAR1', alias: 'PUBLIC1' }]
      })
    },
    {
      id: 2,
      unitId: 'unit2',
      fileName: 'test2.vocs',
      data: JSON.stringify({
        variableCodings: [
          { id: 'VAR2' },
          { id: 'OTHER_VAR' }
        ]
      })
    },
    {
      id: 3,
      unitId: 'unit3',
      fileName: 'test3.vocs',
      data: JSON.stringify({
        variableCodings: [{ id: 'VAR3' }]
      })
    }
  ];

  const mockMissingsProfiles = [
    { id: 1, label: 'Profile 1' },
    { id: 2, label: 'Profile 2' }
  ];

  const mockJobDefinitions = [
    {
      id: 10,
      assignedVariables: [{ unitName: 'unit1', variableId: 'PUBLIC1' }],
      assignedVariableBundles: [
        {
          id: 5,
          name: 'Bundle',
          createdAt: new Date(),
          updatedAt: new Date(),
          variables: [{ unitName: 'unit2', variableId: 'STALE_VAR' }]
        }
      ]
    }
  ];

  const mockVariableBundles = [
    {
      id: 5,
      name: 'Bundle',
      createdAt: new Date(),
      updatedAt: new Date(),
      variables: [{ unitName: 'unit3', variableId: 'VAR3' }]
    },
    {
      id: 8,
      name: 'Bundle 2',
      createdAt: new Date(),
      updatedAt: new Date(),
      variables: [{ unitName: 'unit2', variableId: 'VAR2' }]
    },
    {
      id: 7,
      name: 'Bundle 1',
      createdAt: new Date(),
      updatedAt: new Date(),
      variables: [{ unitName: 'unit1', variableId: 'VAR1' }]
    }
  ];

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    const exportServiceMock = {
      getCodingBook: jest.fn(),
      startCodebookJob: jest.fn(),
      getCodebookJobStatus: jest.fn(),
      downloadCodebookFile: jest.fn()
    };

    const codingJobBackendServiceMock = {
      getJobDefinitions: jest.fn(),
      getVariableBundles: jest.fn()
    };

    const missingsProfileServiceMock = {
      getMissingsProfiles: jest.fn()
    };

    const fileServiceMock = {
      getUnitsWithFileIds: jest.fn()
    };

    workspaceChanges = new Subject<number>();
    dialogClosing = new Subject<void>();
    closeDialog = jest.fn(() => dialogClosing.next());

    const appServiceMock = {
      selectedWorkspaceId$: workspaceChanges,
      selectedWorkspaceId: 1 as number | null,
      dataLoading: false as boolean | number
    };

    const matDialogMock = {
      open: jest.fn(() => ({
        afterClosed: () => of(undefined)
      }))
    };

    const translateServiceMock = {
      instant: jest.fn((key: string) => key),
      get: jest.fn((key: string) => of(key)),
      stream: jest.fn((key: string) => of(key)),
      use: jest.fn(() => of({})),
      setDefaultLang: jest.fn(),
      addLangs: jest.fn(),
      getLangs: jest.fn(() => []),
      currentLang: 'en',
      onLangChange: new Subject(),
      onTranslationChange: new Subject(),
      onDefaultLangChange: new Subject()
    };

    await TestBed.configureTestingModule({
      imports: [ExportCodingBookComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: closeDialog, beforeClosed: () => dialogClosing } },
        { provide: CodingExportService, useValue: exportServiceMock },
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock },
        { provide: MissingsProfileService, useValue: missingsProfileServiceMock },
        { provide: FileService, useValue: fileServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: MatDialog, useValue: matDialogMock },
        DatePipe
      ]
    }).compileComponents();

    exportService = TestBed.inject(CodingExportService) as jest.Mocked<CodingExportService>;
    codingJobBackendService = TestBed.inject(CodingJobBackendService) as jest.Mocked<CodingJobBackendService>;
    missingsProfileService = TestBed.inject(MissingsProfileService) as jest.Mocked<MissingsProfileService>;
    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;
    appService = TestBed.inject(AppService) as jest.Mocked<AppService>;
    matDialog = TestBed.inject(MatDialog) as jest.Mocked<MatDialog>;

    // Setup default mock returns
    fileService.getUnitsWithFileIds.mockReturnValue(of(mockUnits));
    codingJobBackendService.getJobDefinitions.mockReturnValue(of(mockJobDefinitions));
    codingJobBackendService.getVariableBundles.mockReturnValue(of(mockVariableBundles));
    missingsProfileService.getMissingsProfiles.mockReturnValue(of(mockMissingsProfiles));
    fixture = TestBed.createComponent(ExportCodingBookComponent);
    component = fixture.componentInstance;
    (component as unknown as { dialog: MatDialog }).dialog = matDialog;
  });

  beforeAll(() => {
    if (typeof window.URL.createObjectURL === 'undefined') {
      Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(), configurable: true, writable: true });
    }
    if (typeof window.URL.revokeObjectURL === 'undefined') {
      Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true, writable: true });
    }
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should initialize component and load data', () => {
      fixture.detectChanges();

      expect(fileService.getUnitsWithFileIds).toHaveBeenCalledWith(1);
      expect(codingJobBackendService.getJobDefinitions).toHaveBeenCalledWith(1);
      expect(codingJobBackendService.getVariableBundles).toHaveBeenCalledWith(1);
      expect(missingsProfileService.getMissingsProfiles).toHaveBeenCalledWith(1);
      expect(component.availableUnits().length).toBe(3);
      expect(component.availableJobDefinitions().length).toBe(1);
      expect(component.availableVariableBundles().map(bundle => bundle.id)).toEqual([5, 7, 8]);
      expect(component.missingsProfiles().length).toBe(3); // includes default empty profile
    });
  });

  describe('loadUnitsWithFileIds', () => {
    it('should load the units for the shared form', () => {
      fixture.detectChanges();

      expect(component.availableUnits()).toEqual([
        {
          unitId: 1,
          unitKey: 'unit1',
          unitName: 'test1.vocs',
          unitAlias: null,
          unitData: mockUnits[0].data
        },
        {
          unitId: 2,
          unitKey: 'unit2',
          unitName: 'test2.vocs',
          unitAlias: null,
          unitData: mockUnits[1].data
        },
        {
          unitId: 3,
          unitKey: 'unit3',
          unitName: 'test3.vocs',
          unitAlias: null,
          unitData: mockUnits[2].data
        }
      ]);
      expect(component.isLoading()).toBe(false);
    });

    it('should handle empty units response', () => {
      fileService.getUnitsWithFileIds.mockReturnValue(of([]));

      fixture.detectChanges();

      expect(component.availableUnits()).toEqual([]);
      expect(component.isLoading()).toBe(false);
    });

    it('should handle error when loading units', () => {
      fileService.getUnitsWithFileIds.mockReturnValue(throwError(() => new Error('Load error')));

      fixture.detectChanges();

      expect(component.isLoading()).toBe(false);
      expect(component.availableUnits()).toEqual([]);
    });

    it('should not load units if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      fileService.getUnitsWithFileIds.mockClear();

      fixture.detectChanges();

      expect(fileService.getUnitsWithFileIds).not.toHaveBeenCalled();
    });
  });

  describe('loadMissingsProfiles', () => {
    it('should load missings profiles with default empty profile', () => {
      fixture.detectChanges();

      expect(component.missingsProfiles()).toEqual([
        { id: 0, label: '' },
        { id: 1, label: 'Profile 1' },
        { id: 2, label: 'Profile 2' }
      ]);
      expect(component.selectedMissingsProfile()).toBe(0);
    });

    it('should handle error when loading profiles', () => {
      missingsProfileService.getMissingsProfiles.mockReturnValue(throwError(() => new Error('Load error')));

      fixture.detectChanges();

      // Should still have default profile
      expect(component.missingsProfiles()).toEqual([{ id: 0, label: '' }]);
    });

    it('should not load profiles if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      missingsProfileService.getMissingsProfiles.mockClear();

      fixture.detectChanges();

      expect(missingsProfileService.getMissingsProfiles).not.toHaveBeenCalled();
    });
  });

  describe('quick filters', () => {
    it('should select units from the selected job definition', () => {
      fixture.detectChanges();

      component.onJobDefinitionFilterChange(10);

      expect(component.contentOptions().jobDefinitionId).toBe(10);
      expect(component.unitList()).toEqual([1, 3]);
    });

    it('should clear unit selection when the job definition filter is removed', () => {
      fixture.detectChanges();
      component.onJobDefinitionFilterChange(10);

      component.onJobDefinitionFilterChange(null);

      expect(component.contentOptions().jobDefinitionId).toBeNull();
      expect(component.unitList()).toEqual([]);
    });

    it('should update training requirement filter option', () => {
      component.onTrainingRequirementChange('required');

      expect(component.contentOptions().trainingRequirement).toBe('required');
    });

    it('should select units from selected variable bundles', () => {
      fixture.detectChanges();

      component.onVariableBundleFilterChange([8]);

      expect(component.contentOptions().variableBundleIds).toEqual([8]);
      expect(component.unitList()).toEqual([2]);
    });

    it('should clear unit selection when the variable bundle filter is removed', () => {
      fixture.detectChanges();
      component.onVariableBundleFilterChange([8]);

      component.onVariableBundleFilterChange([]);

      expect(component.contentOptions().variableBundleIds).toEqual([]);
      expect(component.unitList()).toEqual([]);
    });

    it('should intersect job definition and variable bundle quick filter unit selections', () => {
      fixture.detectChanges();

      component.onJobDefinitionFilterChange(10);
      component.onVariableBundleFilterChange([7]);

      expect(component.unitList()).toEqual([1]);
    });

    it('should clear unit selection if quick filters share only a unit but no variable', () => {
      fixture.detectChanges();

      component.availableJobDefinitions.set([{
        id: 11,
        assignedVariables: [{ unitName: 'unit2', variableId: 'OTHER_VAR' }],
        assignedVariableBundles: []
      }]);

      component.onJobDefinitionFilterChange(11);
      component.onVariableBundleFilterChange([8]);

      expect(component.unitList()).toEqual([]);
    });

    it('should open job definition picker with precomputed options and apply selected definition', () => {
      fixture.detectChanges();
      matDialog.open.mockReturnValue({
        afterClosed: () => of(10)
      } as ReturnType<MatDialog['open']>);

      component.openJobDefinitionPicker();

      expect(matDialog.open).toHaveBeenCalledWith(
        CodebookJobDefinitionPickerDialogComponent,
        expect.objectContaining({
          width: '960px',
          data: expect.objectContaining({
            selectedJobDefinitionId: null,
            options: expect.arrayContaining([
              expect.objectContaining({ id: 10 })
            ])
          })
        })
      );
      expect(component.selectedJobDefinitionId()).toBe(10);
      expect(component.contentOptions().jobDefinitionId).toBe(10);
    });

    it('should keep current job definition when picker is cancelled', () => {
      fixture.detectChanges();
      component.onJobDefinitionFilterChange(10);
      matDialog.open.mockReturnValue({
        afterClosed: () => of(undefined)
      } as ReturnType<MatDialog['open']>);

      component.openJobDefinitionPicker();

      expect(component.selectedJobDefinitionId()).toBe(10);
      expect(component.contentOptions().jobDefinitionId).toBe(10);
    });

    it('should not open job definition picker while job definitions are loading', () => {
      component.isLoadingJobDefinitions.set(true);

      component.openJobDefinitionPicker();

      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('should not load job definitions if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      codingJobBackendService.getJobDefinitions.mockClear();

      fixture.detectChanges();

      expect(codingJobBackendService.getJobDefinitions).not.toHaveBeenCalled();
    });

    it('should not load variable bundles if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      codingJobBackendService.getVariableBundles.mockClear();

      fixture.detectChanges();

      expect(codingJobBackendService.getVariableBundles).not.toHaveBeenCalled();
    });
  });

  describe('formatUnitName', () => {
    it('should remove .vocs extension', () => {
      expect(component.formatUnitName('test.vocs')).toBe('test');
      expect(component.formatUnitName('TEST.VOCS')).toBe('TEST');
    });

    it('should return original name if no .vocs extension', () => {
      expect(component.formatUnitName('test.txt')).toBe('test.txt');
      expect(component.formatUnitName('test')).toBe('test');
    });

    it('should handle empty or null strings', () => {
      expect(component.formatUnitName('')).toBe('');
    });
  });

  describe('exportCodingBook', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.unitList.set([1, 2]);
      component.selectedMissingsProfile.set(1);
    });

    it('should start a codebook job with correct parameters', () => {
      exportService.startCodebookJob.mockReturnValue(of({ jobId: '123', message: 'ok' }));
      exportService.getCodebookJobStatus.mockReturnValue(of({ status: 'pending', progress: 0 }));

      component.exportCodingBook();

      expect(exportService.startCodebookJob).toHaveBeenCalledWith(
        1,
        '1',
        { ...component.contentOptions(), missingsProfile: '1' },
        [1, 2]
      );
      expect(component.jobState().status).toBe('pending');
      jest.advanceTimersByTime(1500);
      expect(exportService.getCodebookJobStatus).toHaveBeenCalledWith(1, '123');
    });

    it('should not export if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;

      component.exportCodingBook();

      expect(exportService.startCodebookJob).not.toHaveBeenCalled();
    });

    it('should not export if no units selected', () => {
      component.unitList.set([]);

      component.exportCodingBook();

      expect(exportService.startCodebookJob).not.toHaveBeenCalled();
    });

    it('should handle job start error', () => {
      exportService.startCodebookJob.mockReturnValue(throwError(() => new Error('Start error')));

      component.exportCodingBook();

      expect(component.jobState().status).toBe('failed');
      expect(component.jobState().error).toBe('Failed to start codebook generation job');
    });

    it('should set status to pending when starting', () => {
      exportService.startCodebookJob.mockReturnValue(of({ jobId: '456', message: 'ok' }));
      exportService.getCodebookJobStatus.mockReturnValue(of({ status: 'pending', progress: 0 }));

      component.exportCodingBook();

      expect(component.jobState().progress).toBe(0);
    });
  });

  it('keeps host scope filters when the shared form requests an export', () => {
    component.selectedJobDefinitionId.set(10);
    component.selectedVariableBundleIds.set([5]);
    component.onTrainingRequirementChange('required');
    exportService.startCodebookJob.mockReturnValue(new Subject());
    component.onSharedExport({
      selectedUnits: [2],
      missingsProfileId: 1,
      contentOptions: { ...component.contentOptions(), exportFormat: 'json' }
    });
    component.onSharedExport({
      selectedUnits: [1],
      missingsProfileId: 2,
      contentOptions: { ...component.contentOptions(), exportFormat: 'docx' }
    });
    expect(exportService.startCodebookJob).toHaveBeenCalledTimes(1);
    expect(exportService.startCodebookJob).toHaveBeenCalledWith(1, '1', expect.objectContaining({
      exportFormat: 'json', trainingRequirement: 'required', jobDefinitionId: 10, variableBundleIds: [5]
    }), [2]);
  });

  it.each(['required', 'not-required'] as const)('preserves %s from filter change through the rendered shared form to job start', trainingRequirement => {
    fixture.detectChanges();
    const shared = fixture.debugElement.query(By.directive(CodebookExportComponent)).componentInstance as CodebookExportComponent;
    shared.contentOptions.trainingRequirement = trainingRequirement;
    expect(shared.showGroupColumn).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('coding.variable-bundle-filter');
    expect(fixture.nativeElement.querySelector('mat-select[multiple]')).toBeNull();
    fixture.detectChanges();
    shared.toggleAll();
    exportService.startCodebookJob.mockReturnValue(new Subject());
    shared.exportCodingBook();
    expect(exportService.startCodebookJob).toHaveBeenCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ trainingRequirement }),
      expect.arrayContaining([1])
    );
  });

  it('does not overlap slow status requests and cancels them when the dialog closes', () => {
    const status = new Subject<{ status: string; progress: number }>();
    exportService.startCodebookJob.mockReturnValue(of({ jobId: 'job', message: 'ok' }));
    exportService.getCodebookJobStatus.mockReturnValue(status);
    component.unitList.set([1]); component.exportCodingBook();
    jest.advanceTimersByTime(4500);
    expect(exportService.getCodebookJobStatus).toHaveBeenCalledTimes(1);
    expect(status.observed).toBe(true);
    fixture.destroy();
    expect(status.observed).toBe(false);
    jest.advanceTimersByTime(4500);
    expect(exportService.getCodebookJobStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps export locked until the completed job has been downloaded', () => {
    exportService.startCodebookJob.mockReturnValue(of({ jobId: 'job', message: 'ok' }));
    exportService.getCodebookJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }));
    const download = new Subject<Blob>();
    exportService.downloadCodebookFile.mockReturnValue(download);
    component.unitList.set([1]); component.exportCodingBook(); jest.advanceTimersByTime(1500);
    component.exportCodingBook();
    expect(component.jobState().status).toBe('processing');
    expect(exportService.startCodebookJob).toHaveBeenCalledTimes(1);
    fixture.destroy(); expect(download.observed).toBe(false);
  });

  it('cancels the old export and closes the dialog at the first workspace change', () => {
    const start = new Subject<{ jobId: string; message: string }>();
    exportService.startCodebookJob.mockReturnValue(start);
    fixture.detectChanges();
    component.unitList.set([1]);
    component.exportCodingBook();
    expect(start.observed).toBe(true);

    appService.selectedWorkspaceId = 2;
    workspaceChanges.next(2);
    appService.selectedWorkspaceId = 1;
    workspaceChanges.next(1);
    start.next({ jobId: 'old-job', message: 'ok' });
    component.exportCodingBook();
    jest.advanceTimersByTime(3000);

    expect(start.observed).toBe(false);
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(exportService.startCodebookJob).toHaveBeenCalledTimes(1);
    expect(exportService.getCodebookJobStatus).not.toHaveBeenCalled();
  });

  describe('contentOptions', () => {
    it('should have default content options', () => {
      expect(component.contentOptions()).toEqual({
        exportFormat: 'docx',
        missingsProfile: '',
        hasOnlyManualCoding: true,
        hasGeneralInstructions: true,
        hasDerivedVars: true,
        hasOnlyVarsWithCodes: true,
        hasClosedVars: true,
        codeLabelToUpper: true,
        showScore: true,
        hideItemVarRelation: true,
        trainingRequirement: 'all',
        jobDefinitionId: null,
        variableBundleIds: []
      });
    });
  });
});
