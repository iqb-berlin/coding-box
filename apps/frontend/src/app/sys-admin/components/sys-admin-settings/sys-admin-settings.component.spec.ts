import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations'; // Importieren
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { SysAdminSettingsComponent } from './sys-admin-settings.component';
import { SERVER_URL } from '../../../injection-tokens';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { AppService, standardLogo } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';

describe('SysAdminSettingsComponent', () => {
  let component: SysAdminSettingsComponent;
  let fixture: ComponentFixture<SysAdminSettingsComponent>;
  let httpMock: HttpTestingController;
  let snackBar: { open: jest.Mock };
  let systemSettingsService: {
    getContentPoolSettings: jest.Mock;
    updateContentPoolSettings: jest.Mock;
    testContentPoolConnection: jest.Mock;
    getLegalNotice: jest.Mock;
    updateLegalNotice: jest.Mock;
    resetLegalNotice: jest.Mock;
  };

  beforeEach(async () => {
    snackBar = { open: jest.fn() };
    systemSettingsService = {
      getContentPoolSettings: jest.fn(() => of({
        enabled: false,
        baseUrl: '',
        hasApplicationToken: false
      })),
      updateContentPoolSettings: jest.fn(() => of({
        enabled: false,
        baseUrl: '',
        hasApplicationToken: false
      })),
      testContentPoolConnection: jest.fn(() => of({
        success: true,
        acpCount: 2,
        validatedScopes: ['acp.read', 'files.read', 'files.write'],
        message:
          'Verbindung erfolgreich. 2 ACPs erreichbar. Benötigte Scopes geprüft.'
      })),
      getLegalNotice: jest.fn(() => of({
        html: '<p>Legal</p>',
        isDefault: false
      })),
      updateLegalNotice: jest.fn(() => of({
        html: '<p>Updated legal</p>',
        isDefault: false
      })),
      resetLegalNotice: jest.fn(() => of({
        html: '<p>Default legal</p>',
        isDefault: true
      }))
    };

    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: SERVER_URL,
          useValue: 'http://test-url'
        },
        {
          provide: MatSnackBar,
          useValue: snackBar
        },
        {
          provide: AppService,
          useValue: {
            appLogo: { ...standardLogo }
          }
        },
        {
          provide: LogoService,
          useValue: {
            uploadLogo: jest.fn(),
            deleteLogo: jest.fn(),
            saveLogoSettings: jest.fn()
          }
        },
        {
          provide: SystemSettingsService,
          useValue: systemSettingsService
        },
        provideNoopAnimations() // Hier hinzufügen
      ],
      imports: [TranslateModule.forRoot()]
    }).compileComponents();
    fixture = TestBed.createComponent(SysAdminSettingsComponent);
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

  describe('legal notice settings', () => {
    it('loads the current legal notice on init', () => {
      expect(systemSettingsService.getLegalNotice).toHaveBeenCalled();
      expect(component.legalNoticeHtml).toBe('<p>Legal</p>');
      expect(component.isLegalNoticeDefault).toBe(false);
    });

    it('saves the edited legal notice', () => {
      component.legalNoticeHtml = ' <p>Edited legal</p> ';

      component.saveLegalNotice();

      expect(systemSettingsService.updateLegalNotice).toHaveBeenCalledWith({
        html: '<p>Edited legal</p>'
      });
      expect(component.legalNoticeHtml).toBe('<p>Updated legal</p>');
      expect(snackBar.open).toHaveBeenCalledWith(
        'Impressum/Datenschutz-Text wurde gespeichert.',
        'Schließen',
        { duration: 3000 }
      );
    });

    it('requires legal notice text before saving', () => {
      component.legalNoticeHtml = '   ';

      component.saveLegalNotice();

      expect(systemSettingsService.updateLegalNotice).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        'Bitte einen Impressum/Datenschutz-Text hinterlegen.',
        'Schließen',
        { duration: 4000 }
      );
    });

    it('resets legal notice to the built-in default', () => {
      component.resetLegalNoticeToDefault();

      expect(systemSettingsService.resetLegalNotice).toHaveBeenCalled();
      expect(component.legalNoticeHtml).toBe('<p>Default legal</p>');
      expect(component.isLegalNoticeDefault).toBe(true);
    });
  });

  describe('testContentPoolConnection', () => {
    it('tests the current URL with an unsaved token and shows the result', () => {
      component.contentPoolSettings = {
        enabled: true,
        baseUrl: ' http://content-pool.test ',
        hasApplicationToken: false
      };
      component.contentPoolApplicationToken = ' cp_unsaved_token ';

      component.testContentPoolConnection();

      expect(systemSettingsService.testContentPoolConnection)
        .toHaveBeenCalledWith({
          baseUrl: 'http://content-pool.test',
          applicationToken: 'cp_unsaved_token',
          clearApplicationToken: false
        });
      expect(snackBar.open).toHaveBeenCalledWith(
        'Verbindung erfolgreich. 2 ACPs erreichbar. Benötigte Scopes geprüft.',
        'Schließen',
        { duration: 4000 }
      );
      expect(component.isTestingContentPoolConnection).toBe(false);
    });

    it('requires a token when no stored token is available', () => {
      component.contentPoolSettings = {
        enabled: true,
        baseUrl: 'http://content-pool.test',
        hasApplicationToken: false
      };
      component.contentPoolApplicationToken = '';

      component.testContentPoolConnection();

      expect(systemSettingsService.testContentPoolConnection).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        'Bitte ein Content-Pool Application-Token für den Verbindungstest hinterlegen.',
        'Schließen',
        { duration: 4000 }
      );
    });
  });

  describe('exportDatabase', () => {
    beforeEach(() => {
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(), configurable: true });
      }
      if (typeof window.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
      }

      jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
    });

    it('starts an export job, polls status and downloads the SQLite file', fakeAsync(() => {
      const anchor = document.createElement('a');
      const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => {});
      const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(anchor as HTMLAnchorElement);
      const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(node => node);
      const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(node => node);

      component.exportDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job');
      expect(startRequest.request.method).toBe('POST');
      startRequest.flush({ jobId: 'job-1', message: 'started' });

      tick(0);

      const statusRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job/job-1');
      expect(statusRequest.request.method).toBe('GET');
      statusRequest.flush({ status: 'completed', progress: 100 });

      const downloadRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job/job-1/download');
      expect(downloadRequest.request.method).toBe('GET');
      downloadRequest.flush(new Blob(['sqlite']));

      expect(clickSpy).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);
      expect(component.databaseExportStatus).toBe('completed');

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      createElementSpy.mockRestore();
    }));

    it('re-enables export after a failed job status', fakeAsync(() => {
      component.exportDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job');
      startRequest.flush({ jobId: 'job-1', message: 'started' });

      tick(0);

      const statusRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job/job-1');
      statusRequest.flush({ status: 'failed', progress: 42, error: 'Export failed' });

      expect(component.isExporting).toBe(false);
      expect(component.databaseExportStatus).toBe('failed');
      expect(component.databaseExportError).toBe('Export failed');
      expect(snackBar.open).toHaveBeenCalledWith('Export failed', 'Schließen', { duration: 5000 });
    }));

    it('starts export without a local token because auth is handled by the interceptor', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

      component.exportDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/database/export/sqlite/job');
      expect(startRequest.request.method).toBe('POST');
      expect(startRequest.request.headers.get('Authorization')).toBeNull();
      expect(startRequest.request.headers.get('Accept')).toBe('application/json');
      startRequest.flush(
        { message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );

      expect(snackBar.open).toHaveBeenCalled();
      expect(component.isExporting).toBe(false);
    });
  });
});
