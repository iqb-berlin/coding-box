import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { CodingManagementComponent } from './coding-management.component';
import { CodingManagementService } from '../../services/coding-management.service';
import { CodingManagementUiService } from './services/coding-management-ui.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
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
      fetchCodingStatistics: jest.fn(),
      fetchResponsesByStatus: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      searchResponses: jest.fn().mockReturnValue(of({ data: [], total: 0 })),
      resetCodingVersion: jest.fn().mockReturnValue(of({ message: 'Success' })),
      downloadCodingResults: jest.fn().mockReturnValue(Promise.resolve()),
      hasGeogebraResponses: jest.fn().mockReturnValue(of(false)),
      downloadCodingList: jest.fn()
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
          useValue: { open: jest.fn() }
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
      expect(component.data).toEqual([]);
      expect(component.currentStatusFilter).toBeNull();
      expect(component.totalRecords).toBe(0);
    });

    it('should fetch statistics when statistics card emits loadStatistics', () => {
      component.fetchCodingStatistics();

      expect(mockCodingManagementService.fetchCodingStatistics).toHaveBeenCalledWith('v1');
    });

    it('should handle status click from statistics card', () => {
      component.onStatusClick('200');

      expect(mockCodingManagementService.fetchResponsesByStatus).toHaveBeenCalledWith(
        '200',
        'v1',
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
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.filterParams).toEqual(filterParams);
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
        personLogin: ''
      };

      component.onFilterChange(filterParams);

      expect(component.data).toEqual([]);
      expect(component.totalRecords).toBe(0);
      expect(component.currentStatusFilter).toBeNull();
    });

    it('should handle clear filters event', () => {
      component.filterParams.unitName = 'test';
      component.data = [{ id: 1 } as Success];

      component.onClearFilters();

      expect(component.filterParams.unitName).toBe('');
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
  });

  describe('Dialog Methods', () => {
    it('should toggle manual coding view', () => {
      expect(component.showManualCoding).toBe(false);

      component.toggleManualCoding();
      expect(component.showManualCoding).toBe(true);

      component.toggleManualCoding();
      expect(component.showManualCoding).toBe(false);
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
