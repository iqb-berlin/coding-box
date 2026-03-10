import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatePipe } from '@angular/common';
import {
  of, throwError, BehaviorSubject, Subject
} from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { ExportCodingBookComponent } from './export-coding-book.component';
import { CodingExportService } from '../../services/coding-export.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationStateService, ValidationProgress } from '../../services/validation-state.service';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';

describe('ExportCodingBookComponent', () => {
  let component: ExportCodingBookComponent;
  let fixture: ComponentFixture<ExportCodingBookComponent>;
  let exportService: jest.Mocked<CodingExportService>;
  let missingsProfileService: jest.Mocked<MissingsProfileService>;
  let fileService: jest.Mocked<FileService>;
  let appService: jest.Mocked<AppService>;
  let validationStateService: jest.Mocked<ValidationStateService>;

  const mockUnits = [
    {
      id: 1, unitId: 'unit1', fileName: 'test1.vocs', data: 'data1'
    },
    {
      id: 2, unitId: 'unit2', fileName: 'test2.vocs', data: 'data2'
    },
    {
      id: 3, unitId: 'unit3', fileName: 'test3.vocs', data: 'data3'
    }
  ];

  const mockMissingsProfiles = [
    { id: 1, label: 'Profile 1' },
    { id: 2, label: 'Profile 2' }
  ];

  const mockValidationProgress$ = new BehaviorSubject<ValidationProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  });

  const mockValidationResults$ = new BehaviorSubject<ValidateCodingCompletenessResponseDto | null>(null);

  beforeEach(async () => {
    const exportServiceMock = {
      getCodingBook: jest.fn(),
      startCodebookJob: jest.fn(),
      getCodebookJobStatus: jest.fn(),
      downloadCodebookFile: jest.fn()
    };

    const missingsProfileServiceMock = {
      getMissingsProfiles: jest.fn()
    };

    const fileServiceMock = {
      getUnitsWithFileIds: jest.fn()
    };

    const appServiceMock = {
      selectedWorkspaceId: 1 as number | null,
      dataLoading: false as boolean | number
    };

    const validationStateServiceMock = {
      validationProgress$: mockValidationProgress$.asObservable(),
      validationResults$: mockValidationResults$.asObservable(),
      getValidationResults: jest.fn(),
      getValidationProgress: jest.fn()
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
      onLangChange: of({}),
      onTranslationChange: of({}),
      onDefaultLangChange: of({})
    };

    await TestBed.configureTestingModule({
      imports: [ExportCodingBookComponent],
      providers: [
        { provide: CodingExportService, useValue: exportServiceMock },
        { provide: MissingsProfileService, useValue: missingsProfileServiceMock },
        { provide: FileService, useValue: fileServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: ValidationStateService, useValue: validationStateServiceMock },
        { provide: TranslateService, useValue: translateServiceMock },
        DatePipe
      ]
    }).compileComponents();

    exportService = TestBed.inject(CodingExportService) as jest.Mocked<CodingExportService>;
    missingsProfileService = TestBed.inject(MissingsProfileService) as jest.Mocked<MissingsProfileService>;
    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;
    appService = TestBed.inject(AppService) as jest.Mocked<AppService>;
    validationStateService = TestBed.inject(ValidationStateService) as jest.Mocked<ValidationStateService>;

    // Setup default mock returns
    fileService.getUnitsWithFileIds.mockReturnValue(of(mockUnits));
    missingsProfileService.getMissingsProfiles.mockReturnValue(of(mockMissingsProfiles));
    validationStateService.getValidationResults.mockReturnValue(null);
    validationStateService.getValidationProgress.mockReturnValue({
      status: 'idle',
      progress: 0,
      message: ''
    });

    fixture = TestBed.createComponent(ExportCodingBookComponent);
    component = fixture.componentInstance;
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
    mockValidationProgress$.next({ status: 'idle', progress: 0, message: '' });
    mockValidationResults$.next(null);
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should initialize component and load data', () => {
      fixture.detectChanges();

      expect(fileService.getUnitsWithFileIds).toHaveBeenCalledWith(1);
      expect(missingsProfileService.getMissingsProfiles).toHaveBeenCalledWith(1);
      expect(component.availableUnits.length).toBe(3);
      expect(component.missingsProfiles.length).toBe(3); // includes default empty profile
    });

    it('should setup validation state subscriptions', () => {
      fixture.detectChanges();

      expect(component.validationProgress).toEqual({
        status: 'idle',
        progress: 0,
        message: ''
      });
      expect(component.isValidating).toBe(false);
    });

    it('should update validation progress when state changes', () => {
      fixture.detectChanges();

      mockValidationProgress$.next({
        status: 'loading',
        progress: 50,
        message: 'Validating...'
      });

      expect(component.validationProgress?.status).toBe('loading');
      expect(component.isValidating).toBe(true);
    });

    it('should update validation results when available', () => {
      fixture.detectChanges();

      const mockResults: ValidateCodingCompletenessResponseDto = {
        cacheKey: 'test-cache-key',
        results: [],
        total: 100,
        missing: 0,
        currentPage: 1,
        pageSize: 50,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false
      };

      mockValidationResults$.next(mockResults);

      expect(component.validationResults).toEqual(mockResults);
      expect(component.validationCacheKey).toBe('test-cache-key');
    });

    it('should load existing validation results on init', () => {
      const existingResults: ValidateCodingCompletenessResponseDto = {
        cacheKey: 'existing-key',
        results: [],
        total: 50,
        missing: 10,
        currentPage: 1,
        pageSize: 50,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      };

      validationStateService.getValidationResults.mockReturnValue(existingResults);

      fixture.detectChanges();

      expect(component.validationResults).toEqual(existingResults);
    });
  });

  describe('ngOnDestroy', () => {
    it('should complete destroy subject', () => {
      const nextSpy = jest.spyOn((component as unknown as { destroy$: Subject<void> }).destroy$, 'next');
      const completeSpy = jest.spyOn((component as unknown as { destroy$: Subject<void> }).destroy$, 'complete');

      component.ngOnDestroy();

      expect(nextSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });
  });

  describe('loadUnitsWithFileIds', () => {
    it('should load units and setup data source', () => {
      fixture.detectChanges();

      expect(component.availableUnits).toEqual([
        { unitId: 1, unitName: 'test1.vocs', unitAlias: null },
        { unitId: 2, unitName: 'test2.vocs', unitAlias: null },
        { unitId: 3, unitName: 'test3.vocs', unitAlias: null }
      ]);
      expect(component.dataSource.data.length).toBe(3);
      expect(component.isLoading).toBe(false);
    });

    it('should handle empty units response', () => {
      fileService.getUnitsWithFileIds.mockReturnValue(of([]));

      fixture.detectChanges();

      expect(component.availableUnits).toEqual([]);
      expect(component.isLoading).toBe(false);
    });

    it('should handle error when loading units', () => {
      fileService.getUnitsWithFileIds.mockReturnValue(throwError(() => new Error('Load error')));

      fixture.detectChanges();

      expect(component.isLoading).toBe(false);
      expect(component.availableUnits).toEqual([]);
    });

    it('should not load units if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      fileService.getUnitsWithFileIds.mockClear();

      fixture.detectChanges();

      expect(fileService.getUnitsWithFileIds).not.toHaveBeenCalled();
    });

    it('should setup custom filter predicate', () => {
      fixture.detectChanges();

      const filterPredicate = component.dataSource.filterPredicate;
      const testData = { unitId: 1, unitName: 'test.vocs', unitAlias: null };

      expect(filterPredicate(testData, 'test')).toBe(true);
      expect(filterPredicate(testData, 'other')).toBe(false);
    });
  });

  describe('loadMissingsProfiles', () => {
    it('should load missings profiles with default empty profile', () => {
      fixture.detectChanges();

      expect(component.missingsProfiles).toEqual([
        { id: 0, label: '' },
        { id: 1, label: 'Profile 1' },
        { id: 2, label: 'Profile 2' }
      ]);
      expect(component.selectedMissingsProfile).toBe(0);
    });

    it('should handle error when loading profiles', () => {
      missingsProfileService.getMissingsProfiles.mockReturnValue(throwError(() => new Error('Load error')));

      fixture.detectChanges();

      // Should still have default profile
      expect(component.missingsProfiles).toEqual([{ id: 0, label: '' }]);
    });

    it('should not load profiles if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;
      missingsProfileService.getMissingsProfiles.mockClear();

      fixture.detectChanges();

      expect(missingsProfileService.getMissingsProfiles).not.toHaveBeenCalled();
    });
  });

  describe('applyFilter', () => {
    it('should apply filter to data source', () => {
      fixture.detectChanges();

      const event = {
        target: { value: '  Test1  ' }
      } as unknown as Event;

      component.applyFilter(event);

      expect(component.dataSource.filter).toBe('test1');
    });
  });

  describe('toggleUnitSelection', () => {
    it('should add unit to selection list when selected', () => {
      component.toggleUnitSelection(1, true);

      expect(component.unitList).toContain(1);
    });

    it('should not add duplicate units', () => {
      component.unitList = [1];
      component.toggleUnitSelection(1, true);

      expect(component.unitList).toEqual([1]);
    });

    it('should remove unit from selection list when deselected', () => {
      component.unitList = [1, 2, 3];
      component.toggleUnitSelection(2, false);

      expect(component.unitList).toEqual([1, 3]);
    });
  });

  describe('isUnitSelected', () => {
    it('should return true if unit is selected', () => {
      component.unitList = [1, 2, 3];

      expect(component.isUnitSelected(2)).toBe(true);
    });

    it('should return false if unit is not selected', () => {
      component.unitList = [1, 2, 3];

      expect(component.isUnitSelected(4)).toBe(false);
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

  describe('toggleAllUnits', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should select all units when isSelected is true', () => {
      component.toggleAllUnits(true);

      expect(component.unitList).toEqual([1, 2, 3]);
    });

    it('should deselect all units when isSelected is false', () => {
      component.unitList = [1, 2, 3];
      component.toggleAllUnits(false);

      expect(component.unitList).toEqual([]);
    });
  });

  describe('exportCodingBook', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.unitList = [1, 2];
      component.selectedMissingsProfile = 1;
    });

    it('should start a codebook job with correct parameters', () => {
      exportService.startCodebookJob.mockReturnValue(of({ jobId: '123', message: 'ok' }));
      exportService.getCodebookJobStatus.mockReturnValue(of({ status: 'pending', progress: 0 }));

      component.exportCodingBook();

      expect(exportService.startCodebookJob).toHaveBeenCalledWith(
        1,
        '1',
        component.contentOptions,
        [1, 2]
      );
      expect(component.codebookJobId).toBe('123');
      expect(component.codebookJobStatus).toBe('pending');
    });

    it('should not export if no workspace selected', () => {
      (appService.selectedWorkspaceId as number | null) = null;

      component.exportCodingBook();

      expect(exportService.startCodebookJob).not.toHaveBeenCalled();
    });

    it('should not export if no units selected', () => {
      component.unitList = [];

      component.exportCodingBook();

      expect(exportService.startCodebookJob).not.toHaveBeenCalled();
    });

    it('should handle job start error', () => {
      exportService.startCodebookJob.mockReturnValue(throwError(() => new Error('Start error')));

      component.exportCodingBook();

      expect(component.codebookJobStatus).toBe('failed');
      expect(component.codebookJobError).toBe('Failed to start codebook generation job');
    });

    it('should set status to pending when starting', () => {
      exportService.startCodebookJob.mockReturnValue(of({ jobId: '456', message: 'ok' }));
      exportService.getCodebookJobStatus.mockReturnValue(of({ status: 'pending', progress: 0 }));

      component.exportCodingBook();

      expect(component.codebookJobProgress).toBe(0);
    });
  });

  describe('resetCodebookJob', () => {
    it('should reset all codebook job state', () => {
      component.codebookJobId = '123';
      component.codebookJobStatus = 'failed';
      component.codebookJobProgress = 50;
      component.codebookJobError = 'some error';

      component.resetCodebookJob();

      expect(component.codebookJobId).toBeNull();
      expect(component.codebookJobStatus).toBe('idle');
      expect(component.codebookJobProgress).toBe(0);
      expect(component.codebookJobError).toBeNull();
    });
  });

  describe('checkWorkspaceChanges', () => {
    it('should return false', () => {
      expect((component as unknown as { checkWorkspaceChanges: () => boolean }).checkWorkspaceChanges()).toBe(false);
    });
  });

  describe('contentOptions', () => {
    it('should have default content options', () => {
      expect(component.contentOptions).toEqual({
        exportFormat: 'docx',
        missingsProfile: '',
        hasOnlyManualCoding: true,
        hasGeneralInstructions: true,
        hasDerivedVars: true,
        hasOnlyVarsWithCodes: true,
        hasClosedVars: true,
        codeLabelToUpper: true,
        showScore: true,
        hideItemVarRelation: true
      });
    });
  });
});
