import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject, ObservedValueOf } from 'rxjs';
import { TestFilesComponent } from './test-files.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';

describe('File validation without Zone', () => {
  let fixture: ComponentFixture<TestFilesComponent>;
  let fileService: jest.Mocked<FileService>;
  let dialog: jest.Mocked<MatDialog>;
  let snackBar: jest.Mocked<MatSnackBar>;
  const validation = {
    createValidationTask: jest.fn(), getValidationTask: jest.fn(), getValidationResults: jest.fn()
  };
  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    jest.clearAllMocks();
    const fileServiceMock = {
      getFilesList: jest.fn(),
      uploadTestFiles: jest.fn(),
      deleteFiles: jest.fn(),
      deleteFilesWithResult: jest.fn(),
      downloadFile: jest.fn(),
      validateFiles: jest.fn(),
      createDummyTestTakerFile: jest.fn()
    };

    const contentPoolIntegrationServiceMock = {
      getWorkspaceConfig: jest.fn().mockReturnValue(
        of({ enabled: false, baseUrl: '' })
      )
    };

    const dialogMock = {
      open: jest.fn()
    };

    const snackBarMock = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [TestFilesComponent, HttpClientModule, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ValidationService, useValue: validation },
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        AppService,
        { provide: LogoService, useValue: { getLogoSettings: () => of(null) } },
        {
          provide: FileService,
          useValue: fileServiceMock
        },
        {
          provide: MatDialog,
          useValue: dialogMock
        },
        {
          provide: MatSnackBar,
          useValue: snackBarMock
        },
        {
          provide: ContentPoolIntegrationService,
          useValue: contentPoolIntegrationServiceMock
        },
        {
          provide: WorkspaceSettingsService,
          useValue: { getEnableRegexSearch: jest.fn().mockReturnValue(of(false)) }
        }
      ]
    }).overrideProvider(MatDialog, { useValue: dialogMock })
      .overrideProvider(MatSnackBar, { useValue: snackBarMock }).compileComponents();

    TestBed.inject(AppService).selectedWorkspaceId = 1;
    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;
    dialog = TestBed.inject(MatDialog) as jest.Mocked<MatDialog>;
    snackBar = TestBed.inject(MatSnackBar) as jest.Mocked<MatSnackBar>;

    fileService.getFilesList.mockReturnValue(of({
      data: [], total: 0, page: 1, limit: 100, fileTypes: []
    }));

    fixture = TestBed.createComponent(TestFilesComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  const start = () => {
    const button = Array.from(fixture.nativeElement.querySelectorAll('a'))
      .find(element => (element as HTMLElement).textContent?.includes('Validieren')) as HTMLElement;
    button.click();
  };

  it('releases the visible busy state after a delayed error and allows retry', async () => {
    const response = new Subject();
    validation.createValidationTask.mockReturnValue(response);
    start();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.validation-busy-card')).not.toBeNull();
    response.error(new Error('failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(snackBar.open).toHaveBeenCalled();
    const retry = new Subject();
    validation.createValidationTask.mockReturnValue(retry);
    start();
    await fixture.whenStable();
    expect(retry.observed).toBe(true);
    retry.error(new Error('retry failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('cancels task creation when the view is destroyed', async () => {
    const response = new Subject();
    validation.createValidationTask.mockReturnValue(response);
    start();
    await fixture.whenStable();
    expect(response.observed).toBe(true);
    fixture.destroy();
    expect(response.observed).toBe(false);
  });

  it('cancels result loading and opens no dialog after destruction', async () => {
    const result = new Subject();
    validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(result);
    start();
    await fixture.whenStable();
    fixture.destroy();
    expect(result.observed).toBe(false);
    result.next({ testTakersFound: true, validationResults: [] });
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('renders polled progress and cancels the current poll on destruction', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const poll = new Subject();
      validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'pending', progress: 10 }));
      validation.getValidationTask.mockReturnValue(poll);
      start();
      await jest.advanceTimersByTimeAsync(0);
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.validation-busy-percent').textContent).toContain('10%');
      poll.next({
        id: 1, status: 'processing', progress: 55, progress_message: 'Prüfschritt'
      });
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.validation-busy-percent').textContent).toContain('55%');
      expect(fixture.nativeElement.querySelector('.validation-busy-text').textContent).toContain('Prüfschritt');
      fixture.destroy();
      expect(poll.observed).toBe(false);
      const requests = validation.getValidationTask.mock.calls.length;
      await jest.advanceTimersByTimeAsync(900);
      expect(validation.getValidationTask).toHaveBeenCalledTimes(requests);
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders completed progress and releases the overlay when results arrive', async () => {
    const task = new Subject();
    const result = new Subject();
    validation.createValidationTask.mockReturnValue(task);
    validation.getValidationResults.mockReturnValue(result);
    dialog.open.mockReturnValue({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
    start();
    await fixture.whenStable();
    task.next({ id: 1, status: 'completed', progress: 100 });
    task.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.validation-busy-percent').textContent).toContain('100%');
    result.next({ testTakersFound: true, validationResults: [] });
    result.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(dialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      data: expect.objectContaining({ workspaceId: 1 })
    }));
  });

  it.each([
    { phase: 'creation', outcome: 'success' },
    { phase: 'creation', outcome: 'error' },
    { phase: 'results', outcome: 'success' },
    { phase: 'results', outcome: 'error' }
  ])('ignores $outcome in $phase after a workspace change', async ({ phase, outcome }) => {
    const response = new Subject();
    validation.createValidationTask.mockReturnValue(phase === 'creation' ? response :
      of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(phase === 'results' ? response :
      of({ testTakersFound: true, validationResults: [] }));
    dialog.open.mockReturnValue({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
    start();
    await fixture.whenStable();
    TestBed.inject(AppService).selectedWorkspaceId = 2;
    if (outcome === 'error') response.error(new Error('old workspace'));
    else {
      response.next(phase === 'creation' ? { id: 1, status: 'completed', progress: 100 } :
        { testTakersFound: true, validationResults: [] });
      response.complete();
    }
    await fixture.whenStable();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
    if (phase === 'creation') expect(validation.getValidationResults).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('does not create a second validation job while one is running', async () => {
    const task = new Subject();
    validation.createValidationTask.mockReturnValue(task);
    start();
    start();
    await fixture.whenStable();
    expect(validation.createValidationTask).toHaveBeenCalledTimes(1);
    task.error(new Error('failed'));
    await fixture.whenStable();
  });

  it.each(['processing', 'completed'])('stops polling after a workspace change and a late %s response', async status => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const poll = new Subject();
      validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'pending', progress: 10 }));
      validation.getValidationTask.mockReturnValue(poll);
      start();
      await jest.advanceTimersByTimeAsync(0);
      await fixture.whenStable();
      TestBed.inject(AppService).selectedWorkspaceId = 2;
      poll.next({ id: 1, status, progress: 55 });
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
      expect(poll.observed).toBe(false);
      expect(validation.getValidationResults).not.toHaveBeenCalled();
      const calls = validation.getValidationTask.mock.calls.length;
      await jest.advanceTimersByTimeAsync(900);
      expect(validation.getValidationTask).toHaveBeenCalledTimes(calls);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels a pending poll at the next polling interval after a workspace change', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const poll = new Subject();
      validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'pending', progress: 10 }));
      validation.getValidationTask.mockReturnValue(poll);
      start();
      await jest.advanceTimersByTimeAsync(0);
      await fixture.whenStable();
      TestBed.inject(AppService).selectedWorkspaceId = 2;
      await jest.advanceTimersByTimeAsync(300);
      await fixture.whenStable();
      expect(poll.observed).toBe(false);
      expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
      expect(validation.getValidationTask).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { phase: 'creation', outcome: 'success' },
    { phase: 'creation', outcome: 'error' },
    { phase: 'results', outcome: 'success' },
    { phase: 'results', outcome: 'error' }
  ])('cancels $phase permanently after a workspace round trip before $outcome', async ({ phase, outcome }) => {
    const response = new Subject();
    validation.createValidationTask.mockReturnValue(phase === 'creation' ? response :
      of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(phase === 'results' ? response :
      of({ testTakersFound: true, validationResults: [] }));
    dialog.open.mockReturnValue({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
    start();
    await fixture.whenStable();
    const app = TestBed.inject(AppService);
    app.selectedWorkspaceId = 2;
    app.selectedWorkspaceId = 1;
    expect(response.observed).toBe(false);
    if (outcome === 'error') response.error(new Error('old visit'));
    else {
      response.next(phase === 'creation' ? { id: 1, status: 'completed', progress: 100 } :
        { testTakersFound: true, validationResults: [] });
      response.complete();
    }
    await fixture.whenStable();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(snackBar.open).not.toHaveBeenCalled();
    if (phase === 'creation') expect(validation.getValidationResults).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('keeps a fresh validation running when an old visit returns a late result', async () => {
    const oldResult = new Subject();
    validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(oldResult);
    start();
    await fixture.whenStable();
    const app = TestBed.inject(AppService);
    app.selectedWorkspaceId = 2;
    app.selectedWorkspaceId = 1;
    const newTask = new Subject();
    validation.createValidationTask.mockReturnValue(newTask);
    start();
    await fixture.whenStable();
    expect(validation.createValidationTask).toHaveBeenCalledTimes(2);
    oldResult.next({ testTakersFound: true, validationResults: [] });
    oldResult.complete();
    await fixture.whenStable();
    expect(newTask.observed).toBe(true);
    expect(fixture.nativeElement.querySelector('.validation-busy-card')).not.toBeNull();
    expect(dialog.open).not.toHaveBeenCalled();
    newTask.error(new Error('new failure'));
    await fixture.whenStable();
    expect(snackBar.open).toHaveBeenCalledTimes(1);
  });

  it.each(['processing', 'completed', 'error'])('cancels a pending poll before a workspace round trip and late %s', async status => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const poll = new Subject();
      validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'pending', progress: 10 }));
      validation.getValidationTask.mockReturnValue(poll);
      start();
      await jest.advanceTimersByTimeAsync(0);
      await fixture.whenStable();
      expect(poll.observed).toBe(true);
      const app = TestBed.inject(AppService);
      app.selectedWorkspaceId = 2;
      app.selectedWorkspaceId = 1;
      expect(poll.observed).toBe(false);
      if (status === 'error') poll.error(new Error('old poll'));
      else poll.next({ id: 1, status, progress: 55 });
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
      expect(validation.getValidationResults).not.toHaveBeenCalled();
      expect(snackBar.open).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(900);
      expect(validation.getValidationTask).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  const openMissingTestTakers = async () => {
    const confirmation = new Subject<boolean>();
    const creation = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => confirmation } as ReturnType<MatDialog['open']>);
    validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(of({ testTakersFound: false, validationResults: [] }));
    fileService.createDummyTestTakerFile.mockReturnValue(creation);
    start();
    await fixture.whenStable();
    return { confirmation, creation };
  };

  it.each([
    { phase: 'confirmation', action: 'destroy' },
    { phase: 'confirmation', action: 'workspace-roundtrip' },
    { phase: 'request', action: 'destroy' },
    { phase: 'request', action: 'workspace-roundtrip' },
    { phase: 'timer', action: 'destroy' },
    { phase: 'timer', action: 'workspace-roundtrip' }
  ])('stops missing-testtaker $phase after $action', async ({ phase, action }) => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const { confirmation, creation } = await openMissingTestTakers();
      if (phase !== 'confirmation') {
        confirmation.next(true);
        confirmation.complete();
        await fixture.whenStable();
      }
      if (phase === 'timer') {
        creation.next(true);
        creation.complete();
        await fixture.whenStable();
      }
      const fileLoads = fileService.getFilesList.mock.calls.length;
      const messages = snackBar.open.mock.calls.length;
      if (action === 'destroy') fixture.destroy();
      else {
        const app = TestBed.inject(AppService);
        app.selectedWorkspaceId = 2;
        app.selectedWorkspaceId = 1;
      }
      if (phase === 'confirmation') {
        expect(confirmation.observed).toBe(false);
        confirmation.next(true);
        expect(fileService.createDummyTestTakerFile).not.toHaveBeenCalled();
      } else if (phase === 'request') {
        expect(creation.observed).toBe(false);
        creation.next(true);
      }
      await jest.advanceTimersByTimeAsync(1000);
      expect(validation.createValidationTask).toHaveBeenCalledTimes(1);
      expect(fileService.getFilesList).toHaveBeenCalledTimes(fileLoads);
      expect(snackBar.open).toHaveBeenCalledTimes(messages);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['error', 'false'])('releases the loading overlay after dummy creation returns %s', async outcome => {
    const { confirmation, creation } = await openMissingTestTakers();
    confirmation.next(true);
    confirmation.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
    if (outcome === 'error') creation.error(new Error('creation failed'));
    else {
      creation.next(false);
      creation.complete();
    }
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Fehler beim Erstellen der Testtaker-Datei.', expect.any(String), expect.any(Object));
  });

  it('refreshes files after creation, retains the list loading overlay and validates again after the timer', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const { confirmation, creation } = await openMissingTestTakers();
      const files = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
      fileService.getFilesList.mockReturnValue(files);
      confirmation.next(true);
      confirmation.complete();
      await fixture.whenStable();
      expect(fileService.createDummyTestTakerFile).toHaveBeenCalledWith(1);
      creation.next(true);
      creation.complete();
      await fixture.whenStable();
      expect(files.observed).toBe(true);
      expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
      files.next({
        data: [], total: 0, page: 1, limit: 100, fileTypes: []
      });
      files.complete();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
      expect(validation.createValidationTask).toHaveBeenCalledTimes(1);
      validation.getValidationResults.mockReturnValue(of({ testTakersFound: true, validationResults: [] }));
      await jest.advanceTimersByTimeAsync(1000);
      await fixture.whenStable();
      expect(validation.createValidationTask).toHaveBeenCalledTimes(2);
      expect(validation.createValidationTask).toHaveBeenLastCalledWith(1, 'testFiles');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps creation optional when the missing-testtaker dialog is declined', async () => {
    const { confirmation } = await openMissingTestTakers();
    confirmation.next(false);
    confirmation.complete();
    await fixture.whenStable();
    expect(fileService.createDummyTestTakerFile).not.toHaveBeenCalled();
    expect(validation.createValidationTask).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Keine Testtaker-Dateien vorhanden.', 'OK', expect.any(Object));
  });

  it.each([
    { missing: false, action: 'destroy' },
    { missing: false, action: 'workspace-roundtrip' },
    { missing: true, action: 'destroy' },
    { missing: true, action: 'workspace-roundtrip' }
  ])('ends result-dialog follow-up with missing=$missing after $action', async ({ missing, action }) => {
    const closed = new Subject<boolean>();
    validation.createValidationTask.mockReturnValue(of({ id: 1, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(of({
      testTakersFound: !missing, validationResults: [{ testTaker: 'synthetic-testtaker' }]
    }));
    if (missing) {
      dialog.open.mockReturnValueOnce({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
    }
    dialog.open.mockReturnValue({ afterClosed: () => closed } as ReturnType<MatDialog['open']>);
    start();
    await fixture.whenStable();
    expect(closed.observed).toBe(true);
    const fileLoads = fileService.getFilesList.mock.calls.length;
    if (action === 'destroy') fixture.destroy();
    else {
      const app = TestBed.inject(AppService);
      app.selectedWorkspaceId = 2;
      app.selectedWorkspaceId = 1;
    }
    expect(closed.observed).toBe(false);
    closed.next(true);
    expect(fileService.getFilesList).toHaveBeenCalledTimes(fileLoads);
  });

  const reloadFiles = () => {
    (fixture.nativeElement.querySelector('.clear-filters-btn') as HTMLButtonElement).click();
  };

  const fileResponse = (filename: string, page = 1) => ({
    data: [{ id: page, filename, file_type: 'Unit' }],
    total: 300,
    page,
    limit: 100,
    fileTypes: ['Unit']
  });

  it.each([
    { action: 'filter', order: 'old-first' },
    { action: 'filter', order: 'new-first' },
    { action: 'filter', order: 'old-error' },
    { action: 'page', order: 'old-first' },
    { action: 'page', order: 'new-first' },
    { action: 'page', order: 'old-error' },
    { action: 'reload', order: 'old-first' },
    { action: 'reload', order: 'new-first' },
    { action: 'reload', order: 'old-error' }
  ])('keeps the latest file list after $action with $order responses', async ({ action, order }) => {
    const old = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    const current = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValueOnce(old).mockReturnValueOnce(current);
    reloadFiles();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
    const component = fixture.componentInstance;
    if (action === 'page') component.onPageChange({ pageIndex: 1, pageSize: 100, length: 300 });
    else if (action === 'filter') {
      component.textFilterValue.set('new');
      component.applyFilters();
    } else reloadFiles();
    const page = action === 'page' ? 2 : 1;
    const deliverOld = () => {
      if (order === 'old-error') old.error(new Error('old list failed'));
      else {
        old.next(fileResponse('old-file.xml'));
        old.complete();
      }
    };
    if (order !== 'new-first') {
      deliverOld();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('old-file.xml');
      expect(snackBar.open).not.toHaveBeenCalled();
    }
    current.next(fileResponse('new-file.xml', page));
    current.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('new-file.xml');
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    if (order === 'new-first') {
      deliverOld();
      await fixture.whenStable();
    }
    expect(fixture.nativeElement.textContent).toContain('new-file.xml');
    expect(fixture.nativeElement.textContent).not.toContain('old-file.xml');
    expect(component.page()).toBe(page);
    expect(old.observed).toBe(false);
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it.each(['success', 'error'])('cancels the file list on destruction before a late %s', async outcome => {
    const files = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValue(files);
    reloadFiles();
    await fixture.whenStable();
    fixture.destroy();
    expect(files.observed).toBe(false);
    if (outcome === 'error') files.error(new Error('late error'));
    else files.next(fileResponse('destroyed-file.xml'));
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(fixture.componentInstance.dataSource.data).toEqual([]);
  });

  it.each([
    { change: 'one-way', outcome: 'success' },
    { change: 'one-way', outcome: 'error' },
    { change: 'roundtrip', outcome: 'success' },
    { change: 'roundtrip', outcome: 'error' }
  ])('cancels the file list after workspace $change before a late $outcome', async ({ change, outcome }) => {
    const old = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    const current = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValueOnce(old).mockReturnValueOnce(current);
    reloadFiles();
    await fixture.whenStable();
    const app = TestBed.inject(AppService);
    app.selectedWorkspaceId = 2;
    if (change === 'roundtrip') app.selectedWorkspaceId = 1;
    await fixture.whenStable();
    expect(old.observed).toBe(false);
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    reloadFiles();
    await fixture.whenStable();
    if (outcome === 'error') old.error(new Error('previous workspace failed'));
    else {
      old.next(fileResponse('previous-workspace.xml'));
      old.complete();
    }
    await fixture.whenStable();
    expect(current.observed).toBe(true);
    expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('previous-workspace.xml');
    expect(snackBar.open).not.toHaveBeenCalled();
    current.next(fileResponse('current-workspace.xml'));
    current.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('current-workspace.xml');
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('renders empty files and releases the overlay after a delayed answer', async () => {
    const files = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValue(files);
    reloadFiles();
    await fixture.whenStable();
    files.next({
      data: [], total: 0, page: 1, limit: 100, fileTypes: []
    });
    files.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('releases the file-list error state and renders a successful retry', async () => {
    const failed = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    const retry = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValueOnce(failed).mockReturnValueOnce(retry);
    reloadFiles();
    await fixture.whenStable();
    failed.error(new Error('list failed'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith('Fehler beim Laden der Dateiliste.', expect.any(String), expect.any(Object));
    reloadFiles();
    await fixture.whenStable();
    retry.next(fileResponse('retry-file.xml'));
    retry.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('retry-file.xml');
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
  });

  it('renders the loading overlay when the actual search control finishes debouncing', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const files = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
      fileService.getFilesList.mockReturnValue(files);
      const loads = fileService.getFilesList.mock.calls.length;
      const input = fixture.nativeElement.querySelector('coding-box-search-filter input') as HTMLInputElement;
      input.value = 'debounced-file';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await jest.advanceTimersByTimeAsync(300);
      await fixture.whenStable();
      expect(fileService.getFilesList).toHaveBeenCalledTimes(loads);
      await jest.advanceTimersByTimeAsync(299);
      await fixture.whenStable();
      expect(fileService.getFilesList).toHaveBeenCalledTimes(loads);
      await jest.advanceTimersByTimeAsync(1);
      await fixture.whenStable();
      expect(fileService.getFilesList).toHaveBeenLastCalledWith(1, 1, 100, '', '', 'debounced-file', false);
      expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
      files.next(fileResponse('debounced-file.xml'));
      files.complete();
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain('debounced-file.xml');
      expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([100, 400])('starts no debounced file request after destruction at %s ms', async elapsed => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    try {
      const loads = fileService.getFilesList.mock.calls.length;
      const input = fixture.nativeElement.querySelector('coding-box-search-filter input') as HTMLInputElement;
      input.value = 'abandoned-search';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await jest.advanceTimersByTimeAsync(elapsed);
      await fixture.whenStable();
      fixture.destroy();
      await jest.advanceTimersByTimeAsync(1000);
      expect(fileService.getFilesList).toHaveBeenCalledTimes(loads);
    } finally {
      jest.useRealTimers();
    }
  });

  const recreateWithSettings = async (
    regex: Subject<boolean>,
    pool: Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>,
    initialRegex = false,
    pattern = '['
  ) => {
    fixture.destroy();
    (TestBed.inject(WorkspaceSettingsService) as jest.Mocked<WorkspaceSettingsService>)
      .getEnableRegexSearch.mockReturnValue(regex);
    (TestBed.inject(ContentPoolIntegrationService) as jest.Mocked<ContentPoolIntegrationService>)
      .getWorkspaceConfig.mockReturnValue(pool);
    fixture = TestBed.createComponent(TestFilesComponent);
    fixture.componentInstance.textFilterValue.set(pattern);
    fixture.componentInstance.enableRegexSearch.set(initialRegex);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  };

  it.each([true, false])('updates the actual regex hint after a delayed setting=%s', async enabled => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(regex, pool, !enabled);
    expect(Boolean(fixture.nativeElement.querySelector('.regex-filter-error'))).toBe(!enabled);
    pool.next({ enabled: false, baseUrl: '', hasApplicationToken: false });
    pool.complete();
    await fixture.whenStable();
    regex.next(enabled);
    regex.complete();
    await fixture.whenStable();
    expect(Boolean(fixture.nativeElement.querySelector('.regex-filter-error'))).toBe(enabled);
  });

  it.each([
    { enabled: false, token: false },
    { enabled: true, token: false },
    { enabled: true, token: true }
  ])('renders delayed Content Pool configuration enabled=$enabled token=$token', async ({ enabled, token }) => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    fileService.getFilesList.mockReturnValue(of(fileResponse('selected-file.xml')));
    await recreateWithSettings(regex, pool);
    regex.next(false);
    regex.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('ACP aus Content Pool');
    pool.next({ enabled, baseUrl: ' https://synthetic.example ', hasApplicationToken: token });
    pool.complete();
    await fixture.whenStable();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    const importButton = buttons.find(button => button.textContent?.includes('ACP aus Content Pool'));
    const uploadButton = buttons.find(button => button.textContent?.includes('Auswahl zu Content Pool'));
    if (!enabled) {
      expect(importButton).toBeUndefined();
      expect(uploadButton).toBeUndefined();
      return;
    }
    expect(importButton?.getAttribute('aria-disabled') === 'true').toBe(!token);
    expect(uploadButton?.getAttribute('aria-disabled')).toBe('true');
    (fixture.nativeElement.querySelector('mat-row mat-checkbox input') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(uploadButton?.getAttribute('aria-disabled') === 'true').toBe(!token);
    expect(fixture.componentInstance.contentPoolSettings().baseUrl).toBe('https://synthetic.example');
  });

  it('releases Content Pool loading on error and loads fresh settings after reopening', async () => {
    const regex = new Subject<boolean>();
    const failed = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(regex, failed);
    regex.next(false);
    regex.complete();
    failed.error(new Error('settings unavailable'));
    await fixture.whenStable();
    expect(fixture.componentInstance.isLoadingContentPoolConfig()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('ACP aus Content Pool');
    const retry = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(new Subject<boolean>(), retry);
    retry.next({ enabled: true, baseUrl: 'https://synthetic.example', hasApplicationToken: true });
    retry.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('ACP aus Content Pool');
  });

  it.each([
    { source: 'regex', action: 'destroy' },
    { source: 'regex', action: 'workspace' },
    { source: 'regex', action: 'roundtrip' },
    { source: 'pool', action: 'destroy' },
    { source: 'pool', action: 'workspace' },
    { source: 'pool', action: 'roundtrip' }
  ])('ends pending $source settings on $action before a delayed success', async ({ source, action }) => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(regex, pool);
    const pending = source === 'regex' ? regex : pool;
    expect(pending.observed).toBe(true);
    if (action === 'destroy') fixture.destroy();
    else {
      const app = TestBed.inject(AppService);
      app.selectedWorkspaceId = 2;
      if (action === 'roundtrip') app.selectedWorkspaceId = 1;
    }
    expect(pending.observed).toBe(false);
    if (source === 'regex') {
      regex.next(true);
      regex.complete();
      expect(fixture.componentInstance.enableRegexSearch()).toBe(false);
    } else {
      pool.next({ enabled: true, baseUrl: 'https://old.example', hasApplicationToken: true });
      pool.complete();
      expect(fixture.componentInstance.contentPoolSettings().enabled).toBe(false);
    }
    if (action !== 'destroy') {
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.regex-filter-error')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('ACP aus Content Pool');
      expect(fixture.componentInstance.isLoadingContentPoolConfig()).toBe(false);
    }
  });

  it.each(['destroy', 'workspace', 'roundtrip'])('ignores a late Content Pool error after %s', async action => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(regex, pool);
    if (action === 'destroy') fixture.destroy();
    else {
      const app = TestBed.inject(AppService);
      app.selectedWorkspaceId = 2;
      if (action === 'roundtrip') app.selectedWorkspaceId = 1;
    }
    expect(pool.observed).toBe(false);
    pool.error(new Error('old settings failed'));
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isLoadingContentPoolConfig()).toBe(false);
  });

  it('ends a pending literal search when delayed settings make its regex invalid', async () => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    const literal = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValue(literal);
    await recreateWithSettings(regex, pool);
    expect(literal.observed).toBe(true);
    const requests = fileService.getFilesList.mock.calls.length;
    regex.next(true);
    regex.complete();
    await fixture.whenStable();
    expect(literal.observed).toBe(false);
    literal.next(fileResponse('old-literal.xml'));
    literal.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.regex-filter-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('old-literal.xml');
    expect(fileService.getFilesList).toHaveBeenCalledTimes(requests);
  });

  it.each(['old-first', 'new-first', 'old-error'])('reloads a valid search in regex mode with %s responses', async order => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    const literal = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    const current = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValueOnce(literal).mockReturnValueOnce(current);
    await recreateWithSettings(regex, pool, false, 'unit.*');
    regex.next(true);
    regex.complete();
    await fixture.whenStable();
    expect(fileService.getFilesList).toHaveBeenLastCalledWith(1, 1, 100, '', '', 'unit.*', true);
    expect(literal.observed).toBe(false);
    expect(current.observed).toBe(true);
    const deliverOld = () => {
      if (order === 'old-error') literal.error(new Error('old literal request failed'));
      else {
        literal.next(fileResponse('literal-file.xml'));
        literal.complete();
      }
    };
    if (order !== 'new-first') {
      deliverOld();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
    }
    current.next(fileResponse('regex-file.xml'));
    current.complete();
    await fixture.whenStable();
    if (order === 'new-first') {
      deliverOld();
      await fixture.whenStable();
    }
    expect(fixture.nativeElement.textContent).toContain('regex-file.xml');
    expect(fixture.nativeElement.textContent).not.toContain('literal-file.xml');
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it.each(['error', 'success'])('keeps validation and list loading independent with a validation %s', async outcome => {
    const regex = new Subject<boolean>();
    const pool = new Subject<ObservedValueOf<ReturnType<ContentPoolIntegrationService['getWorkspaceConfig']>>>();
    await recreateWithSettings(regex, pool, false, 'unit.*');
    pool.next({ enabled: false, baseUrl: '', hasApplicationToken: false });
    pool.complete();
    await fixture.whenStable();
    const task = new Subject();
    const files = new Subject<ObservedValueOf<ReturnType<FileService['getFilesList']>>>();
    fileService.getFilesList.mockReturnValue(files);
    validation.createValidationTask.mockReturnValue(task);
    start();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.validation-busy-card')).not.toBeNull();
    regex.next(true);
    regex.complete();
    await fixture.whenStable();
    expect(files.observed).toBe(true);
    expect(task.observed).toBe(true);
    expect(fixture.nativeElement.querySelector('.validation-busy-card')).not.toBeNull();
    start();
    await fixture.whenStable();
    expect(validation.createValidationTask).toHaveBeenCalledTimes(1);
    if (outcome === 'error') task.error(new Error('validation failed'));
    else {
      validation.getValidationResults.mockReturnValue(of({ testTakersFound: true, validationResults: [] }));
      dialog.open.mockReturnValue({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
      task.next({ id: 902, status: 'completed', progress: 100 });
      task.complete();
    }
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.validation-busy-card')).toBeNull();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).not.toBeNull();
    files.next(fileResponse('regex-after-validation.xml'));
    files.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.busy-overlay')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('regex-after-validation.xml');
  });
});
