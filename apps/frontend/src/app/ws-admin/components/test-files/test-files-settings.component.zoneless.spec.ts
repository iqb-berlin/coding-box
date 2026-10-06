import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { TestFilesComponent } from './test-files.component';
import { AppService } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { FileService } from '../../../shared/services/file/file.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import { SERVER_URL } from '../../../injection-tokens';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from '../../../core/interceptors/http-error-context';

describe('File view settings with real services without Zone', () => {
  let fixture: ComponentFixture<TestFilesComponent>;
  let http: HttpTestingController;
  const configUrl = '/api/admin/workspace/1/content-pool/config';
  const regexUrl = '/api/workspace/1/settings/enable-regex-search';
  const emptyConfig = { enabled: false, baseUrl: '', hasApplicationToken: false };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestFilesComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: '/api/' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        {
          provide: FileService,
          useValue: {
            getFilesList: jest.fn().mockReturnValue(of({
              data: [], total: 0, page: 1, limit: 100, fileTypes: []
            }))
          }
        },
        WorkspaceSettingsService,
        ContentPoolIntegrationService
      ]
    }).overrideProvider(MatDialog, { useValue: { open: jest.fn() } })
      .overrideProvider(MatSnackBar, { useValue: { open: jest.fn() } }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AppService).selectedWorkspaceId = 1;
  });

  afterEach(() => { http.verify(); });

  const render = async (initialRegex = false) => {
    fixture = TestBed.createComponent(TestFilesComponent);
    fixture.componentInstance.textFilterValue.set('[');
    fixture.componentInstance.enableRegexSearch.set(initialRegex);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  };

  it('renders delayed regex validation through the actual workspace service', async () => {
    await render();
    const regex = http.expectOne(regexUrl);
    expect(regex.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
    http.expectOne(configUrl).flush(emptyConfig);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')).toBeNull();
    regex.flush({ key: 'enable-regex-search', value: '{"enabled":true}' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')).not.toBeNull();
  });

  it.each(['malformed-json', 'http-error'])('clears the regex hint with the real %s fallback', async outcome => {
    await render(true);
    http.expectOne(configUrl).flush(emptyConfig);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')).not.toBeNull();
    const regex = http.expectOne(regexUrl);
    if (outcome === 'http-error') regex.flush({}, { status: 500, statusText: 'failed' });
    else regex.flush({ key: 'enable-regex-search', value: '{invalid' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')).toBeNull();
    expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();
  });

  it('renders enabled Content Pool actions through the actual integration service', async () => {
    await render();
    http.expectOne(regexUrl).flush({ value: '{"enabled":false}' });
    await fixture.whenStable();
    http.expectOne(configUrl).flush({
      enabled: true, baseUrl: 'https://synthetic.example', hasApplicationToken: true
    });
    await fixture.whenStable();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const importButton = buttons.find(button => button.textContent?.includes('ACP aus Content Pool'));
    expect(importButton).toBeDefined();
    expect(importButton?.disabled).toBe(false);
  });

  it('releases configuration loading after an actual HTTP error', async () => {
    await render();
    http.expectOne(regexUrl).flush({ value: '{"enabled":false}' });
    http.expectOne(configUrl).flush({}, { status: 500, statusText: 'failed' });
    await fixture.whenStable();
    expect(fixture.componentInstance.isLoadingContentPoolConfig()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('ACP aus Content Pool');
  });

  it.each(['destroy', 'workspace', 'roundtrip'])('keeps abandoned HTTP settings out of the view after %s', async action => {
    await render();
    const regex = http.expectOne(regexUrl);
    const pool = http.expectOne(configUrl);
    if (action === 'destroy') fixture.destroy();
    else {
      const app = TestBed.inject(AppService);
      app.selectedWorkspaceId = 2;
      if (action === 'roundtrip') app.selectedWorkspaceId = 1;
    }
    expect(pool.cancelled).toBe(true);
    // WorkspaceSettingsService intentionally retains shared requests for its cache.
    expect(regex.cancelled).toBe(false);
    regex.flush({ value: '{"enabled":true}' });
    expect(fixture.componentInstance.enableRegexSearch()).toBe(false);
    expect(fixture.componentInstance.contentPoolSettings().enabled).toBe(false);
    expect(fixture.componentInstance.isLoadingContentPoolConfig()).toBe(false);
    if (action !== 'destroy') {
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.regex-filter-error')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('ACP aus Content Pool');
    }
  });
});
