/* eslint-disable max-classes-per-file */
import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { JournalComponent } from '../journal/journal.component';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { WsSettingsComponent } from './ws-settings.component';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { SERVER_URL } from '../../../injection-tokens';

@Component({
  selector: 'coding-box-ws-access-rights',
  template: '',
  standalone: true
})
class MockWsAccessRightsComponent { }

@Component({
  selector: 'coding-box-journal',
  template: '',
  standalone: true
})
class MockJournalComponent { }

describe('WsSettingsComponent', () => {
  let component: WsSettingsComponent;
  let fixture: ComponentFixture<WsSettingsComponent>;
  let mockAppService: jest.Mocked<AppService>;
  let mockWorkspaceSettingsService: jest.Mocked<WorkspaceSettingsService>;
  let mockClipboard: jest.Mocked<Clipboard>;
  let mockSnackBar: jest.Mocked<MatSnackBar>;
  let mockDialog: jest.Mocked<MatDialog>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    mockAppService = {
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'test-user' },
      createOwnToken: jest.fn().mockReturnValue(of('test-token')),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue(of({
        scopes: {
          'replay:read': { maxDurationDays: 90 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      }))
    } as unknown as jest.Mocked<AppService>;

    mockWorkspaceSettingsService = {
      getAutoFetchCodingStatistics: jest.fn().mockReturnValue(of(true)),
      setAutoFetchCodingStatistics: jest.fn().mockReturnValue(of({})),
      getAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of(true)),
      setAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of({})),
      getEvaluationMode: jest.fn().mockReturnValue(of(false)),
      setEvaluationMode: jest.fn().mockReturnValue(of([])),
      getIncludeDeriveErrorInManualCoding: jest.fn().mockReturnValue(of(false)),
      setIncludeDeriveErrorInManualCoding: jest.fn().mockReturnValue(of({})),
      getShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of(false)),
      setShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of({})),
      getEnableRegexSearch: jest.fn().mockReturnValue(of(false)),
      setEnableRegexSearch: jest.fn().mockReturnValue(of({}))
    } as unknown as jest.Mocked<WorkspaceSettingsService>;

    mockClipboard = {
      copy: jest.fn()
    } as unknown as jest.Mocked<Clipboard>;

    mockSnackBar = {
      open: jest.fn()
    } as unknown as jest.Mocked<MatSnackBar>;

    mockDialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(null) }),
      closeAll: jest.fn(),
      openDialogs: []
    } as unknown as jest.Mocked<MatDialog>;

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        WsSettingsComponent
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppService, useValue: mockAppService },
        { provide: WorkspaceSettingsService, useValue: mockWorkspaceSettingsService },
        { provide: Clipboard, useValue: mockClipboard },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: MatDialog, useValue: mockDialog },
        { provide: SERVER_URL, useValue: 'http://test-url' }
      ]
    }).overrideComponent(WsSettingsComponent, {
      remove: { imports: [WsAccessRightsComponent, JournalComponent] },
      add: {
        imports: [MockWsAccessRightsComponent, MockJournalComponent],
        providers: [{ provide: MatDialog, useValue: mockDialog }]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(WsSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load workspace settings on init', () => {
      expect(mockAppService.getWorkspaceTokenPolicy).toHaveBeenCalled();
      expect(mockWorkspaceSettingsService.getEvaluationMode).toHaveBeenCalledWith(1);
      expect(component.evaluationMode).toBe(false);
      expect(mockWorkspaceSettingsService.getAutoFetchCodingStatistics).toHaveBeenCalledWith(1);
      expect(component.autoFetchCodingStatistics).toBe(true);
      expect(mockWorkspaceSettingsService.getAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1);
      expect(component.autoRefreshManualCodingJobs).toBe(true);
      expect(mockWorkspaceSettingsService.getIncludeDeriveErrorInManualCoding).toHaveBeenCalledWith(1);
      expect(component.includeDeriveErrorInManualCoding).toBe(false);
      expect(mockWorkspaceSettingsService.getShowTestResultsLogAnomalies).toHaveBeenCalledWith(1);
      expect(component.showTestResultsLogAnomalies).toBe(false);
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).toHaveBeenCalledWith(1);
      expect(component.enableRegexSearch).toBe(false);
    });
  });

  describe('openReplayStatistics', () => {
    it('should open replay statistics dialog', () => {
      component.openReplayStatistics();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('createToken', () => {
    it('should call appService.createOwnToken and show snackbar', () => {
      component.createToken();
      expect(mockAppService.createOwnToken).toHaveBeenCalledWith(
        1,
        component.duration,
        ['replay:read']
      );
      expect(component.authToken).toBe('test-token');
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should use the token policy maximum for duration validation', () => {
      mockAppService.getWorkspaceTokenPolicy.mockReturnValueOnce(of({
        scopes: {
          'replay:read': { maxDurationDays: 60 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      }));

      component.ngOnInit();

      expect(component.maxTokenDurationDays).toBe(60);
      expect(component.duration).toBe(60);
      expect(component.isTokenDurationValid()).toBe(true);

      component.duration = 61;
      expect(component.isTokenDurationValid()).toBe(false);
    });

    it('should reject decimal durations before requesting a token', () => {
      component.duration = 1.5;

      component.createToken();

      expect(mockAppService.createOwnToken).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should show an error when token generation fails', () => {
      mockAppService.createOwnToken.mockReturnValue(throwError(() => new Error('failed')));

      component.createToken();

      expect(component.authToken).toBeNull();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('copyToken', () => {
    it('should copy token to clipboard if it exists', () => {
      component.authToken = 'test-token';
      component.copyToken();
      expect(mockClipboard.copy).toHaveBeenCalledWith('test-token');
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should not copy if no token exists', () => {
      component.authToken = null;
      component.copyToken();
      expect(mockClipboard.copy).not.toHaveBeenCalled();
    });
  });

  describe('editMissingsProfiles', () => {
    it('should open edit missings profiles dialog', () => {
      component.editMissingsProfiles();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('openAccessRightsMatrix', () => {
    it('should open access rights matrix dialog', () => {
      component.openAccessRightsMatrix();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('toggleEvaluationMode', () => {
    it('should enable evaluation mode and turn off expensive automatic refreshes', () => {
      component.toggleEvaluationMode({ checked: true });

      expect(component.evaluationMode).toBe(true);
      expect(component.autoFetchCodingStatistics).toBe(false);
      expect(component.autoRefreshManualCodingJobs).toBe(false);
      expect(mockWorkspaceSettingsService.setEvaluationMode).toHaveBeenCalledWith(1, true);
    });

    it('should disable evaluation mode and restore normal automatic refresh defaults', () => {
      component.evaluationMode = true;
      component.autoFetchCodingStatistics = false;
      component.autoRefreshManualCodingJobs = false;

      component.toggleEvaluationMode({ checked: false });

      expect(component.evaluationMode).toBe(false);
      expect(component.autoFetchCodingStatistics).toBe(false);
      expect(component.autoRefreshManualCodingJobs).toBe(true);
      expect(mockWorkspaceSettingsService.setEvaluationMode).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setEvaluationMode.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.evaluationMode = false;
      component.autoFetchCodingStatistics = true;
      component.autoRefreshManualCodingJobs = true;

      component.toggleEvaluationMode({ checked: true });

      expect(component.evaluationMode).toBe(false);
      expect(component.autoFetchCodingStatistics).toBe(true);
      expect(component.autoRefreshManualCodingJobs).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleAutoFetchCodingStatistics', () => {
    it('should call service with true', () => {
      component.toggleAutoFetchCodingStatistics({ checked: true });
      expect(component.autoFetchCodingStatistics).toBe(true);
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleAutoFetchCodingStatistics({ checked: false });
      expect(component.autoFetchCodingStatistics).toBe(false);
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setAutoFetchCodingStatistics.mockReturnValue(throwError(() => new Error('error')));
      component.autoFetchCodingStatistics = true;
      component.toggleAutoFetchCodingStatistics({ checked: false });
      expect(component.autoFetchCodingStatistics).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should ignore changes while evaluation mode is active', () => {
      component.evaluationMode = true;

      component.toggleAutoFetchCodingStatistics({ checked: true });

      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).not.toHaveBeenCalled();
    });
  });

  describe('toggleAutoRefreshManualCodingJobs', () => {
    it('should call service with true', () => {
      component.toggleAutoRefreshManualCodingJobs({ checked: true });
      expect(component.autoRefreshManualCodingJobs).toBe(true);
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleAutoRefreshManualCodingJobs({ checked: false });
      expect(component.autoRefreshManualCodingJobs).toBe(false);
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs.mockReturnValue(throwError(() => new Error('error')));
      component.autoRefreshManualCodingJobs = true;
      component.toggleAutoRefreshManualCodingJobs({ checked: false });
      expect(component.autoRefreshManualCodingJobs).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should ignore changes while evaluation mode is active', () => {
      component.evaluationMode = true;

      component.toggleAutoRefreshManualCodingJobs({ checked: true });

      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).not.toHaveBeenCalled();
    });
  });

  describe('toggleIncludeDeriveErrorInManualCoding', () => {
    it('should call service with true', () => {
      component.toggleIncludeDeriveErrorInManualCoding({ checked: true });
      expect(component.includeDeriveErrorInManualCoding).toBe(true);
      expect(mockWorkspaceSettingsService.setIncludeDeriveErrorInManualCoding).toHaveBeenCalledWith(1, true);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setIncludeDeriveErrorInManualCoding.mockReturnValue(throwError(() => new Error('error')));
      component.includeDeriveErrorInManualCoding = true;
      component.toggleIncludeDeriveErrorInManualCoding({ checked: false });
      expect(component.includeDeriveErrorInManualCoding).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleShowTestResultsLogAnomalies', () => {
    it('should call service with true', () => {
      component.toggleShowTestResultsLogAnomalies({ checked: true });
      expect(component.showTestResultsLogAnomalies).toBe(true);
      expect(mockWorkspaceSettingsService.setShowTestResultsLogAnomalies).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleShowTestResultsLogAnomalies({ checked: false });
      expect(component.showTestResultsLogAnomalies).toBe(false);
      expect(mockWorkspaceSettingsService.setShowTestResultsLogAnomalies).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setShowTestResultsLogAnomalies.mockReturnValue(throwError(() => new Error('error')));
      component.showTestResultsLogAnomalies = true;
      component.toggleShowTestResultsLogAnomalies({ checked: false });
      expect(component.showTestResultsLogAnomalies).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleEnableRegexSearch', () => {
    it('should call service with true', () => {
      component.toggleEnableRegexSearch({ checked: true });
      expect(component.enableRegexSearch).toBe(true);
      expect(mockWorkspaceSettingsService.setEnableRegexSearch).toHaveBeenCalledWith(1, true);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setEnableRegexSearch.mockReturnValue(throwError(() => new Error('error')));
      component.enableRegexSearch = true;
      component.toggleEnableRegexSearch({ checked: false });
      expect(component.enableRegexSearch).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('exportWorkspaceDatabase', () => {
    beforeEach(() => {
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(), configurable: true });
      }
      if (typeof window.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
      }

      jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
    });

    it('should start export job, poll status and download file', fakeAsync(() => {
      const anchor = document.createElement('a');
      const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => {});
      const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(anchor as HTMLAnchorElement);

      const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(node => node);
      const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(node => node);

      component.exportWorkspaceDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job');
      expect(startRequest.request.method).toBe('POST');
      startRequest.flush({ jobId: 'job-1', message: 'started' });

      tick(0);

      const statusRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job/job-1');
      expect(statusRequest.request.method).toBe('GET');
      statusRequest.flush({ status: 'completed', progress: 100 });

      const downloadRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job/job-1/download');
      expect(downloadRequest.request.method).toBe('GET');
      downloadRequest.flush(new Blob(['test']));

      expect(clickSpy).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);
      expect(component.databaseExportStatus).toBe('completed');

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      createElementSpy.mockRestore();
    }));

    it('should start export without a local token because auth is handled by the interceptor', () => {
      jest.spyOn(localStorage, 'getItem').mockReturnValue(null);

      component.exportWorkspaceDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job');
      expect(startRequest.request.method).toBe('POST');
      expect(startRequest.request.headers.get('Authorization')).toBeNull();
      expect(startRequest.request.headers.get('Accept')).toBe('application/json');
      startRequest.flush(
        { message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );

      expect(mockSnackBar.open).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);
    });
  });
});
