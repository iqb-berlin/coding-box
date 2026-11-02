import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse
} from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { ResourcePackagesDialogComponent, ResourcePackagesDialogData } from './resource-packages-dialog.component';
import { ResourcePackageService } from '../../../shared/services/response/resource-package.service';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';

describe('ResourcePackagesDialogComponent', () => {
  let fixture: ComponentFixture<ResourcePackagesDialogComponent>;
  let resourcePackageService: jest.Mocked<Pick<ResourcePackageService,
  'getResourcePackages' | 'downloadResourcePackageWithProgress' | 'uploadResourcePackageWithProgress' |
  'deleteResourcePackages' | 'installGeoGebraPackage'>>;
  let snackBar: { open: jest.Mock };
  let dialog: { open: jest.Mock };
  let dialogRef: { close: jest.Mock };
  let data: ResourcePackagesDialogData;
  const resource: ResourcePackageDto = {
    id: 11,
    name: 'Example',
    elements: ['font.woff'],
    packageType: 'resource',
    scope: 'workspace',
    packageSize: 2048,
    createdAt: new Date('2026-10-01T10:00:00Z')
  };
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(async () => {
    resourcePackageService = {
      getResourcePackages: jest.fn().mockReturnValue(of([resource])),
      downloadResourcePackageWithProgress: jest.fn(),
      uploadResourcePackageWithProgress: jest.fn(),
      deleteResourcePackages: jest.fn().mockReturnValue(of(true)),
      installGeoGebraPackage: jest.fn()
    };
    snackBar = { open: jest.fn() };
    dialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of(true) }) };
    dialogRef = { close: jest.fn() };
    data = { workspaceId: 7 };
    URL.createObjectURL = jest.fn().mockReturnValue('blob:resource');
    URL.revokeObjectURL = jest.fn();
    await TestBed.configureTestingModule({
      imports: [ResourcePackagesDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ResourcePackageService, useValue: resourcePackageService }
      ]
    }).overrideProvider(MatDialog, { useValue: dialog }).compileComponents();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(ResourcePackagesDialogComponent);
    await fixture.whenStable();
  }

  function button(text: string): HTMLButtonElement {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const result = buttons.find(candidate => candidate.textContent?.includes(text));
    if (!result) throw new Error(`Button not found: ${text}`);
    return result;
  }

  function uploadFile(): File {
    const file = new File(['package'], 'example.itcr.zip');
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return file;
  }

  async function selectAll(): Promise<void> {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('mat-header-cell input[type=checkbox]')!.click();
    await fixture.whenStable();
  }

  it('renders a delayed package list without forcing change detection', async () => {
    const packages = new Subject<ResourcePackageDto[]>();
    resourcePackageService.getResourcePackages.mockReturnValue(packages);
    await create();
    expect(fixture.nativeElement.textContent).toContain('Ressourcenpakete werden geladen');
    packages.next([resource]);
    await fixture.whenStable();
    expect(resourcePackageService.getResourcePackages).toHaveBeenCalledWith(7);
    expect(fixture.nativeElement.textContent).toContain('Example');
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
  });

  it.each([undefined, 0, -1, 1.5])('rejects invalid workspace %s without calling the API', async workspaceId => {
    data.workspaceId = workspaceId;
    await create();
    expect(resourcePackageService.getResourcePackages).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Workspace ID is required', 'error', { duration: 3000 });
  });

  it('shows loading errors and permits a retry', async () => {
    resourcePackageService.getResourcePackages.mockReturnValueOnce(throwError(() => new Error('Unauthorized')));
    await create();
    expect(snackBar.open).toHaveBeenCalledWith('Error loading resource packages', 'error', { duration: 3000 });
    fixture.componentInstance.loadResourcePackages();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Example');
  });

  it('debounces package searches and clears the active filter', async () => {
    await create();
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const filter = fixture.debugElement.query(By.directive(SearchFilterComponent)).componentInstance as SearchFilterComponent;
    filter.valueChange.emit('unmatched');
    await jest.advanceTimersByTimeAsync(301);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(0);
    button('Filter zurücksetzen').click();
    await jest.advanceTimersByTimeAsync(1);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('mat-row')).toHaveLength(1);
  });

  it('renders download progress, saves the returned blob and releases its object URL', async () => {
    const events = new Subject<HttpEvent<Blob>>();
    resourcePackageService.downloadResourcePackageWithProgress.mockReturnValue(events);
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await create();
    button('download').click();
    events.next({ type: HttpEventType.DownloadProgress, loaded: 512, total: 1024 });
    await fixture.whenStable();
    expect(resourcePackageService.downloadResourcePackageWithProgress).toHaveBeenCalledWith(7, 'Example');
    expect(fixture.nativeElement.textContent).toContain('50%');
    expect(button('Ressourcenpaket hochladen').disabled).toBe(true);
    const blob = new Blob(['zip']);
    events.next(new HttpResponse({ body: blob }));
    await fixture.whenStable();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click.mock.instances[0].download).toBe('Example.itcr.zip');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:resource');
    expect(fixture.nativeElement.querySelector('.operation-progress')).toBeNull();
    expect(button('Ressourcenpaket hochladen').disabled).toBe(false);
  });

  it.each(['empty', 'error'])('resets download state after an %s result', async result => {
    const events = new Subject<HttpEvent<Blob>>();
    resourcePackageService.downloadResourcePackageWithProgress.mockReturnValue(events);
    await create();
    button('download').click();
    events.next({ type: HttpEventType.DownloadProgress, loaded: 512 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBeNull();
    if (result === 'empty') events.next(new HttpResponse({ body: new Blob([]) }));
    else events.error(new Error('Network error'));
    await fixture.whenStable();
    expect(snackBar.open).toHaveBeenCalledWith('Das Ressourcenpaket konnte nicht heruntergeladen werden.', 'error', { duration: 3000 });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(button('Ressourcenpaket hochladen').disabled).toBe(false);
  });

  it('uploads the selected file, shows progress and closes after the server accepts it', async () => {
    const events = new Subject<HttpEvent<number>>();
    resourcePackageService.uploadResourcePackageWithProgress.mockReturnValue(events);
    await create();
    const file = uploadFile();
    expect(resourcePackageService.uploadResourcePackageWithProgress).toHaveBeenCalledWith(7, file);
    events.next({ type: HttpEventType.UploadProgress, loaded: 3, total: 6 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('50%');
    events.next(new HttpResponse({ body: 99 }));
    await fixture.whenStable();
    expect(resourcePackageService.getResourcePackages).toHaveBeenCalledTimes(2);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
    expect(fixture.nativeElement.querySelector('.operation-progress')).toBeNull();
  });

  it.each([
    ['array', ['Invalid ZIP', 'Missing manifest'], 'Invalid ZIP Missing manifest'],
    ['message', 'Invalid ZIP', 'Invalid ZIP'],
    ['body', undefined, 'Invalid ZIP']
  ])('shows the backend upload error from a %s response and keeps the dialog open', async (_kind, message, expected) => {
    resourcePackageService.uploadResourcePackageWithProgress.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 400, error: message === undefined ? expected : { message }
    })));
    await create();
    uploadFile();
    await fixture.whenStable();
    expect(snackBar.open.mock.calls.at(-1)?.[0]).toContain(expected);
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(button('Ressourcenpaket hochladen').disabled).toBe(false);
  });

  it('keeps selection when deletion is cancelled and warns before deleting a global package', async () => {
    resourcePackageService.getResourcePackages.mockReturnValue(of([{ ...resource, scope: 'global' }]));
    dialog.open.mockReturnValueOnce({ afterClosed: () => of(false) });
    await create();
    await selectAll();
    button('Ressourcenpaket(e) löschen').click();
    expect(dialog.open.mock.calls[0][1].data.content).toContain('in allen Workspaces');
    expect(resourcePackageService.deleteResourcePackages).not.toHaveBeenCalled();
    button('Ressourcenpaket(e) löschen').click();
    await fixture.whenStable();
    expect(resourcePackageService.deleteResourcePackages).toHaveBeenCalledWith(7, [11]);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it.each(['false', 'error'])('keeps the dialog open when deletion returns %s', async result => {
    resourcePackageService.deleteResourcePackages.mockReturnValue(result === 'false' ? of(false) : throwError(() => new Error('Denied')));
    await create();
    await selectAll();
    button('Ressourcenpaket(e) löschen').click();
    await fixture.whenStable();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Ressourcenpakete konnten nicht gelöscht werden.', 'error', { duration: 3000 });
    expect(button('Ressourcenpaket(e) löschen').disabled).toBe(false);
  });

  it('confirms GeoGebra installation and renders the installed version', async () => {
    const events = new Subject<HttpEvent<ResourcePackageDto>>();
    resourcePackageService.installGeoGebraPackage.mockReturnValue(events);
    await create();
    button('GeoGebra installieren').click();
    expect(resourcePackageService.installGeoGebraPackage).toHaveBeenCalledWith(7);
    events.next(new HttpResponse({
      body: {
        ...resource, name: 'GeoGebra', scope: 'global', detectedVersion: '6.0'
      }
    }));
    await fixture.whenStable();
    expect(snackBar.open).toHaveBeenCalledWith('GeoGebra ist verfügbar (6.0).', '', { duration: 3000 });
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('reports installation errors without closing the dialog', async () => {
    resourcePackageService.installGeoGebraPackage.mockReturnValue(throwError(() => new Error('Offline')));
    await create();
    button('GeoGebra installieren').click();
    await fixture.whenStable();
    expect(snackBar.open.mock.calls.at(-1)?.[0]).toContain('GeoGebra konnte nicht installiert werden');
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(button('GeoGebra installieren').disabled).toBe(false);
  });

  it('unsubscribes pending HTTP events when the dialog is destroyed', async () => {
    const events = new Subject<HttpEvent<Blob>>();
    resourcePackageService.downloadResourcePackageWithProgress.mockReturnValue(events);
    await create();
    button('download').click();
    expect(events.observed).toBe(true);
    fixture.destroy();
    expect(events.observed).toBe(false);
    events.next(new HttpResponse({ body: new Blob(['zip']) }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
