/* eslint-disable max-classes-per-file */
import {
  ComponentFixture, TestBed
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
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

  beforeEach(async () => {
    mockAppService = {
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'test-user' },
      createToken: jest.fn().mockReturnValue(of('test-token'))
    } as unknown as jest.Mocked<AppService>;

    mockWorkspaceSettingsService = {
      getAutoFetchCodingStatistics: jest.fn().mockReturnValue(of(true)),
      setAutoFetchCodingStatistics: jest.fn().mockReturnValue(of({}))
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
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load auto-fetch setting on init', () => {
      expect(mockWorkspaceSettingsService.getAutoFetchCodingStatistics).toHaveBeenCalledWith(1);
      expect(component.autoFetchCodingStatistics).toBe(true);
    });
  });

  describe('openReplayStatistics', () => {
    it('should open replay statistics dialog', () => {
      component.openReplayStatistics();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('createToken', () => {
    it('should call appService.createToken and show snackbar', () => {
      component.createToken();
      expect(mockAppService.createToken).toHaveBeenCalledWith(1, 'test-user', component.duration);
      expect(component.authToken).toBe('test-token');
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
  });

  describe('exportWorkspaceDatabase', () => {
    beforeEach(() => {
      // Mock window.URL and localStorage
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(), configurable: true });
      }
      if (typeof window.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
      }

      jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');

      // Mock fetch
      global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      })
      );
    });

    it('should toggle isExporting and call fetch', async () => {
      jest.spyOn(document, 'createElement');
      const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => document.createElement('div'));
      const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => document.createElement('div'));

      await component.exportWorkspaceDatabase();

      expect(global.fetch).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it('should show error if no token found', async () => {
      jest.spyOn(localStorage, 'getItem').mockReturnValue(null);
      await component.exportWorkspaceDatabase();
      expect(mockSnackBar.open).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);
    });
  });
});
