import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import applicationTranslations from '../../../assets/i18n/de.json';
import { DatabaseExportService } from './database-export.service';

describe('DatabaseExportService', () => {
  let service: DatabaseExportService;
  let http: HttpTestingController;
  let snackBar: { open: jest.Mock };
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  const baseUrl = 'http://test/api/admin/database/export/sqlite';

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new Subject<number>() };
    snackBar = { open: jest.fn() };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        DatabaseExportService, provideHttpClient(), provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: 'http://test/api/' },
        { provide: AppService, useValue: app },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', applicationTranslations);
    translate.use('de');
    service = TestBed.inject(DatabaseExportService);
    http = TestBed.inject(HttpTestingController);
    Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(() => 'blob:export'), configurable: true });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.cancel();
    http.verify();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function startSystemJob(): Promise<void> {
    service.start({ kind: 'system' });
    http.expectOne(`${baseUrl}/job`).flush({ jobId: 'job-1' });
    await jest.advanceTimersByTimeAsync(0);
  }

  it.each(['system', 'workspace'] as const)('exports the %s scope with one download and releases the blob URL', async kind => {
    const scope = kind === 'system' ? { kind } : { kind, workspaceId: 5 };
    const url = kind === 'system' ? baseUrl : 'http://test/api/admin/workspace/5/export/sqlite';
    const createElement = document.createElement.bind(document);
    let filename = '';
    jest.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const element = createElement(tag, options);
      if (tag === 'a') {
        jest.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(() => {
          filename = (element as HTMLAnchorElement).download;
        });
      }
      return element;
    });

    service.start(scope);
    const start = http.expectOne(`${url}/job`);
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({});
    expect(start.request.headers.get('Accept')).toBe('application/json');
    expect(start.request.headers.has('Authorization')).toBe(false);
    start.flush({ jobId: 'job-1' });
    await jest.advanceTimersByTimeAsync(0);
    http.expectOne(`${url}/job/job-1`).flush({ status: 'running', progress: 40.6 });
    expect(service.progress()).toBe(41);
    expect(service.isExporting()).toBe(true);
    await jest.advanceTimersByTimeAsync(2000);
    http.expectOne(`${url}/job/job-1`).flush({ status: 'completed', progress: 99 });
    const download = http.expectOne(`${url}/job/job-1/download`);
    expect(download.request.responseType).toBe('blob');
    expect(service.isExporting()).toBe(true);
    download.flush(new Blob(['sqlite']));
    expect(filename).toMatch(kind === 'system' ? /^database-export-.*\.sqlite$/ : /^workspace-5-export-.*\.sqlite$/);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
    expect(service.isExporting()).toBe(false);
    expect(service.status()).toBe('completed');
    expect(service.progress()).toBe(100);
    expect(service.error()).toBeNull();
    await jest.advanceTimersByTimeAsync(10000);
    http.expectNone(`${url}/job/job-1`);
  });

  it('lets a slow status request finish without overlapping or cancelling it', async () => {
    await startSystemJob();
    const status = http.expectOne(`${baseUrl}/job/job-1`);
    await jest.advanceTimersByTimeAsync(6000);
    expect(status.cancelled).toBe(false);
    http.expectNone(`${baseUrl}/job/job-1`);
    status.flush({ status: 'running', progress: 150 });
    expect(service.progress()).toBe(100);
    await jest.advanceTimersByTimeAsync(2000);
    http.expectOne(`${baseUrl}/job/job-1`).flush({ status: 'failed', progress: -10, error: 'Failed' });
    expect(service.progress()).toBe(0);
  });

  it.each(['failed', 'cancelled'] as const)('stops on %s, preserves its message and allows retry', async status => {
    await startSystemJob();
    http.expectOne(`${baseUrl}/job/job-1`).flush({ status, progress: 40, error: 'Job failed' });
    expect(service.status()).toBe(status);
    expect(service.error()).toBe('Job failed');
    expect(service.isExporting()).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Job failed', 'Schließen', { duration: 5000 });
    await jest.advanceTimersByTimeAsync(4000);
    http.expectNone(`${baseUrl}/job/job-1`);
    service.start({ kind: 'system' });
    expect(service.error()).toBeNull();
    http.expectOne(`${baseUrl}/job`).flush({}, { status: 500, statusText: 'Failed' });
  });

  it.each(['start', 'status', 'download'] as const)('settles an HTTP error during %s and displays validation messages', async phase => {
    service.start({ kind: 'system' });
    let request = http.expectOne(`${baseUrl}/job`);
    if (phase !== 'start') {
      request.flush({ jobId: 'job-1' });
      await jest.advanceTimersByTimeAsync(0);
      request = http.expectOne(`${baseUrl}/job/job-1`);
    }
    if (phase === 'download') {
      request.flush({ status: 'completed', progress: 100 });
      request = http.expectOne(`${baseUrl}/job/job-1/download`);
    }
    request.flush(phase === 'download' ? new Blob(['error']) : { message: ['First', 'Second'] }, { status: 500, statusText: 'Failed' });
    expect(service.isExporting()).toBe(false);
    expect(service.status()).toBe('failed');
    expect(service.error()).toBeTruthy();
    if (phase !== 'download') expect(service.error()).toBe('First, Second');
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('prevents duplicate starts while a job is queued', () => {
    service.start({ kind: 'system' });
    service.start({ kind: 'workspace', workspaceId: 5 });
    http.expectOne(`${baseUrl}/job`);
    http.expectNone('http://test/api/admin/workspace/5/export/sqlite/job');
  });

  it('uses the active language for the fallback message and close action', async () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { close: 'Close', 'database-export': { system: { failed: 'Please retry the export.' } } });
    translate.use('en');
    await startSystemJob();
    http.expectOne(`${baseUrl}/job/job-1`).flush({ status: 'failed', progress: 0 });
    expect(service.error()).toBe('Please retry the export.');
    expect(snackBar.open).toHaveBeenCalledWith('Please retry the export.', 'Close', { duration: 5000 });
  });

  it('cancels a workspace request immediately when the workspace changes, including A to B to A', () => {
    service.start({ kind: 'workspace', workspaceId: 5 });
    const start = http.expectOne('http://test/api/admin/workspace/5/export/sqlite/job');
    app.selectedWorkspaceId = 6;
    app.selectedWorkspaceId$.next(6);
    app.selectedWorkspaceId = 5;
    app.selectedWorkspaceId$.next(5);
    expect(start.cancelled).toBe(true);
    expect(service.isExporting()).toBe(false);
    expect(service.status()).toBeNull();
    expect(service.error()).toBeNull();
  });

  it.each(['start', 'status', 'download'] as const)('cancels the active %s request when its view is destroyed', async phase => {
    const injector = createEnvironmentInjector([DatabaseExportService], TestBed.inject(EnvironmentInjector));
    const scoped = injector.get(DatabaseExportService);
    scoped.start({ kind: 'system' });
    let request = http.expectOne(`${baseUrl}/job`);
    if (phase !== 'start') {
      request.flush({ jobId: 'job-1' });
      await jest.advanceTimersByTimeAsync(0);
      request = http.expectOne(`${baseUrl}/job/job-1`);
    }
    if (phase === 'download') {
      request.flush({ status: 'completed', progress: 100 });
      request = http.expectOne(`${baseUrl}/job/job-1/download`);
    }
    injector.destroy();
    expect(request.cancelled).toBe(true);
    expect(scoped.isExporting()).toBe(false);
    await jest.advanceTimersByTimeAsync(10000);
    http.expectNone(`${baseUrl}/job/job-1`);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('keeps separate settings views independent', () => {
    const injector = createEnvironmentInjector([DatabaseExportService], TestBed.inject(EnvironmentInjector));
    const scoped = injector.get(DatabaseExportService);
    service.start({ kind: 'system' });
    scoped.start({ kind: 'workspace', workspaceId: 5 });
    const system = http.expectOne(`${baseUrl}/job`);
    const workspace = http.expectOne('http://test/api/admin/workspace/5/export/sqlite/job');
    injector.destroy();
    expect(workspace.cancelled).toBe(true);
    expect(system.cancelled).toBe(false);
    expect(service.isExporting()).toBe(true);
  });
});
