import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject, BehaviorSubject } from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { CodingManagementComponent } from './coding-management.component';
import { CodingManagementService } from '../../services/coding-management.service';
import { CodingManagementUiService } from './services/coding-management-ui.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';
import { Success } from '../../models/success.model';

describe('CodingManagementComponent', () => {
  let component: CodingManagementComponent;
  let fixture: ComponentFixture<CodingManagementComponent>;
  let mockCodingManagementService: jest.Mocked<Partial<CodingManagementService>>;
  let mockUiService: jest.Mocked<Partial<CodingManagementUiService>>;
  let mockDialog: jest.Mocked<Partial<MatDialog>>;
  let mockAppService: jest.Mocked<Partial<AppService>>;
  let mockWorkspaceSettingsService: jest.Mocked<Partial<WorkspaceSettingsService>>;
  let mockTestPersonCodingService: jest.Mocked<Partial<TestPersonCodingService>>;
  let mockRouter: jest.Mocked<Partial<Router>>;
  let mockSnackBar: jest.Mocked<Partial<MatSnackBar>>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    // Mock window.open
    window.open = jest.fn();

    // Create mocks
    mockCodingManagementService = {
      codingStatistics$: of({ totalResponses: 100, statusCounts: { 200: 50, 300: 50 } }),
      referenceStatistics$: of(null),
      referenceVersion$: of(null),
      isLoadingStatistics$: of(false),
      resetProgress$: of(null) as never,
      downloadProgress$: new BehaviorSubject<number | null>(null),
      codingListDownloadProgress$: new BehaviorSubject<number | null>(null),
      fetchCodingStatistics: jest.fn(),
      fetchResponsesByStatus: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      searchResponses: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      resetCodingVersion: jest.fn().mockReturnValue(of({ message: 'Success' })),
      downloadCodingResults: jest.fn().mockReturnValue(Promise.resolve()),
      hasGeogebraResponses: jest.fn().mockReturnValue(of(false)),
      downloadCodingList: jest.fn(),
      checkActiveResetJob: jest.fn()
    };

    mockUiService = {
      openReplayForResponse: jest.fn().mockReturnValue(of('http://replay.url')),
      getCodingSchemeFromUnit: jest.fn().mockReturnValue(of('test-scheme')),
      showCodingSchemeDialog: jest.fn(),
      showUnitXmlDialog: jest.fn()
    };

    const mockDialogRef = {
      afterClosed: jest.fn().mockReturnValue(of(null)),
      close: jest.fn()
    };

    mockDialog = {
      open: jest.fn().mockReturnValue(mockDialogRef),
      openDialogs: [],
      afterOpened: new Subject(),
      afterAllClosed: new Subject()
    } as unknown as MatDialog;

    mockAppService = {
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'test-user' }
    };

    mockWorkspaceSettingsService = {
      getAutoFetchCodingStatistics: jest.fn().mockReturnValue(of(false))
    };

    mockTestPersonCodingService = {
      autoCodingCompleted$: of(),
      testResultsChanged$: of(),
      getCodingFreshness: jest.fn().mockReturnValue(of({
        workspaceId: 1,
        currentRevision: 0,
        items: []
      })),
      getCodingFreshnessScope: jest.fn().mockReturnValue(of({
        workspaceId: 1,
        currentRevision: 0,
        versions: ['v1', 'v2', 'v3'],
        states: ['PENDING', 'STALE', 'MANUAL_REVIEW_REQUIRED'],
        unitCount: 0,
        personCount: 0,
        groupCount: 0,
        affectedResponseCount: 0,
        unitIds: [],
        personIds: [],
        groupNames: [],
        groups: []
      })),
      startFreshnessCoding: jest.fn().mockReturnValue(of({
        totalResponses: 0,
        statusCounts: {},
        unitCount: 0,
        personCount: 0,
        groupNames: []
      })),
      getJobStatus: jest.fn(),
      notifyAutoCodingCompleted: jest.fn()
    };

    mockRouter = {
      navigate: jest.fn()
    };

    mockSnackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: MatSnackBar,
          useValue: mockSnackBar
        },
        {
          provide: CodingManagementService,
          useValue: mockCodingManagementService
        },
        {
          provide: CodingManagementUiService,
          useValue: mockUiService
        },
        {
          provide: MatDialog,
          useValue: mockDialog
        },
        {
          provide: AppService,
          useValue: mockAppService
        },
        {
          provide: WorkspaceSettingsService,
          useValue: mockWorkspaceSettingsService
        },
        {
          provide: TestPersonCodingService,
          useValue: mockTestPersonCodingService
        },
        {
          provide: Router,
          useValue: mockRouter
        }
      ],
      imports: [
        TranslateModule.forRoot(),
        CodingManagementComponent,
        NoopAnimationsModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Component Initialization', () => {
    it('should subscribe to coding statistics on init', () => {
      expect(component.codingStatistics).toEqual({
        totalResponses: 100,
        statusCounts: { 200: 50, 300: 50 }
      });
      expect(component.statisticsLoaded).toBe(true);
    });

    it('should check auto-fetch setting on init', () => {
      expect(mockWorkspaceSettingsService.getAutoFetchCodingStatistics).toHaveBeenCalledWith(1);
    });
  });

  describe('Statistics Card Integration', () => {
    it('should handle version change from statistics card', () => {
      component.onVersionChange('v2');

      expect(component.selectedStatisticsVersion).toBe('v2');
      expect(component.filterParams.version).toBe('v2');
      expect(component.data).toEqual([]);
      expect(component.currentStatusFilter).toBeNull();
      expect(component.totalRecords).toBe(0);
    });

    it('should fetch statistics when statistics card emits loadStatistics', () => {
      component.fetchCodingStatistics();

      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalledWith('v1');
    });

    it('should handle status click from statistics card through the normal table filter', () => {
      component.filterParams.group = 'ID26010601';

      component.onStatusClick('200');

      expect(component.currentStatusFilter).toBeNull();
      expect(component.filterParams).toEqual(expect.objectContaining({
        codedStatus: '200',
        group: 'ID26010601',
        responseSource: 'all',
        version: 'v1'
      }));
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        component.filterParams,
        1,
        100
      );
    });
  });

  describe('Response Filters Integration', () => {
    it('should handle filter change from filters component', () => {
      const filterParams = {
        unitName: 'test',
        codedStatus: '200',
        version: 'v1' as const,
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all' as const,
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.filterParams).toEqual(filterParams);
    });

    it('should keep filter version aligned with selected statistics version', () => {
      component.selectedStatisticsVersion = 'v2';

      component.onFilterChange({
        unitName: 'test',
        codedStatus: '200',
        version: 'v1',
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all',
        personLogin: ''
      });

      expect(component.filterParams.version).toBe('v2');
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        component.filterParams,
        1,
        100
      );
    });

    it('should normalize GeoGebra filter changes to base responses', () => {
      component.onFilterChange({
        unitName: '',
        codedStatus: '',
        version: 'v1',
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: true,
        responseSource: 'all',
        personLogin: ''
      });

      expect(component.filterParams.responseSource).toBe('base');
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        component.filterParams,
        1,
        100
      );
    });

    it('should clear data when filter status is empty', () => {
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 10;

      const filterParams = {
        unitName: '',
        codedStatus: '',
        version: 'v1' as const,
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all' as const,
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.data).toEqual([]);
      expect(component.totalRecords).toBe(0);
      expect(component.currentStatusFilter).toBeNull();
      expect(mockCodingManagementService.searchResponses).not.toHaveBeenCalled();
    });

    it('should apply derived response source when derived statistics are clicked', () => {
      component.selectedStatisticsVersion = 'v2';

      component.onDerivedClick();

      expect(component.filterParams).toEqual({
        unitName: '',
        codedStatus: '',
        version: 'v2',
        code: '',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'derived',
        personLogin: ''
      });
      expect(component.currentStatusFilter).toBeNull();
      expect(component.pageIndex).toBe(0);
      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        component.filterParams,
        1,
        100
      );
    });

    it('should handle clear filters event', () => {
      component.selectedStatisticsVersion = 'v3';
      component.filterParams = {
        ...component.filterParams,
        version: 'v3',
        unitName: 'test'
      };
      component.data = [{ id: 1 } as Success];

      component.onClearFilters();

      expect(component.filterParams.unitName).toBe('');
      expect(component.filterParams.version).toBe('v3');
      expect(component.filterParams.responseSource).toBe('all');
      expect(component.data).toEqual([]);
      expect(component.totalRecords).toBe(0);
    });
  });

  describe('Response Table Integration', () => {
    it('should handle page change from table component', () => {
      component.currentStatusFilter = '200';
      const event = { pageIndex: 1, pageSize: 200, length: 400 } as PageEvent;

      component.onPageChange(event);

      expect(component.pageSize).toBe(200);
      expect(component.pageIndex).toBe(1);
      expect(mockCodingManagementService.fetchResponsesByStatus).toHaveBeenCalledWith(
        '200',
        'v1',
        2, // pageIndex + 1
        200
      );
    });

    it('should handle replay click from table component', () => {
      const response = { id: 123 } as Success;

      component.onReplayClick(response);

      expect(mockUiService.openReplayForResponse).toHaveBeenCalledWith(response);
    });

    it('should handle show coding scheme from table component', () => {
      component.onShowCodingScheme(456);

      expect(mockUiService.getCodingSchemeFromUnit).toHaveBeenCalledWith(456);
    });

    it('should handle show unit XML from table component', () => {
      component.onShowUnitXml(789);

      expect(mockUiService.showUnitXmlDialog).toHaveBeenCalledWith(789);
    });

    it('should load all filtered responses before opening the review dialog', () => {
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 2;
      mockCodingManagementService.searchResponses = jest.fn().mockReturnValue(of({
        total: 2,
        data: [
          {
            responseId: 1,
            unitId: 10,
            variableId: 'v1',
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: 'Unit1',
            unitAlias: null,
            bookletId: 20,
            bookletName: 'Booklet1',
            personId: 30,
            personLogin: 'login1',
            personCode: 'code1',
            personGroup: 'group1'
          },
          {
            responseId: 2,
            unitId: 11,
            variableId: 'v2',
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: 'Unit2',
            unitAlias: null,
            bookletId: 21,
            bookletName: 'Booklet2',
            personId: 31,
            personLogin: 'login2',
            personCode: 'code2',
            personGroup: 'group2'
          }
        ]
      }));

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledWith(
        component.filterParams,
        1,
        2
      );
      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: expect.objectContaining({
            responses: expect.arrayContaining([
              expect.objectContaining({ id: 1, unitname: 'Unit1' }),
              expect.objectContaining({ id: 2, unitname: 'Unit2' })
            ])
          })
        })
      );
    });

    it('should load review responses in batches for large filtered result sets', () => {
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 1200;
      mockCodingManagementService.searchResponses = jest.fn().mockImplementation(
        (_params, page: number) => of({
          total: 1200,
          data: [{
            responseId: page,
            unitId: page,
            variableId: `v${page}`,
            value: 'UEsD',
            status: 'VALUE_CHANGED',
            unitName: `Unit${page}`,
            unitAlias: null,
            bookletId: page,
            bookletName: `Booklet${page}`,
            personId: page,
            personLogin: `login${page}`,
            personCode: `code${page}`,
            personGroup: `group${page}`
          }]
        })
      );

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).toHaveBeenCalledTimes(3);
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ geogebra: true }),
        1,
        500
      );
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ geogebra: true }),
        2,
        500
      );
      expect(mockCodingManagementService.searchResponses).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ geogebra: true }),
        3,
        500
      );
      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: expect.objectContaining({
            responses: expect.arrayContaining([
              expect.objectContaining({ id: 1, unitname: 'Unit1' }),
              expect.objectContaining({ id: 2, unitname: 'Unit2' }),
              expect.objectContaining({ id: 3, unitname: 'Unit3' })
            ])
          })
        })
      );
    });

    it('should not start a review for result sets beyond the review limit', () => {
      (mockCodingManagementService.searchResponses as jest.Mock).mockClear();
      (mockSnackBar.open as jest.Mock).mockClear();
      (mockDialog.open as jest.Mock).mockClear();
      component.filterParams = {
        ...component.filterParams,
        geogebra: true
      };
      component.data = [{ id: 1 } as Success];
      component.totalRecords = 5001;

      component.onReviewClick();

      expect(mockCodingManagementService.searchResponses).not.toHaveBeenCalled();
      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'coding-management.messages.review-too-many-results',
        'coding-management.actions.close',
        { duration: 7000 }
      );
    });
  });

  describe('Dialog Methods', () => {
    it('should navigate to manual coding route', () => {
      component.openManualCoding();

      expect(mockRouter.navigate).toHaveBeenCalledWith([
        '/workspace-admin/1/coding/manual'
      ]);
    });
  });

  describe('Data Fetching', () => {
    it('should get available statuses from coding statistics', () => {
      const statuses = component.getAvailableStatuses();

      expect(statuses).toEqual(['200', '300']);
    });
  });

  describe('Component Cleanup', () => {
    it('should unsubscribe on destroy', () => {
      const componentWithPrivate = component as unknown as { destroy$: Subject<void> };
      const destroySpy = jest.spyOn(componentWithPrivate.destroy$, 'next');
      const completeSpy = jest.spyOn(componentWithPrivate.destroy$, 'complete');

      component.ngOnDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });
  });
});
