import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { TestCenterImportComponent, WorkspaceAdmin } from './test-center-import.component';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { ImportService, Result } from '../../../shared/services/file/import.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';
import { AppService } from '../../../core/services/app.service';
import { TestGroupsInfoDto } from '../../../../../../../api-dto/files/test-groups-info.dto';
import { TestGroupsLoadProgressDto } from '../../../../../../../api-dto/files/test-groups-load-progress.dto';
import { ImportWorkspaceFilesProgressDto } from '../../../../../../../api-dto/files/import-workspace-progress.dto';

describe('Testcenter delayed responses without Zone.js', () => {
  let fixture: ComponentFixture<TestCenterImportComponent>;
  let login: Subject<{ token?: string; claims?: { workspaceAdmin: WorkspaceAdmin[] } }>;
  let groups: Subject<TestGroupsInfoDto[]>;
  let groupProgress: Subject<TestGroupsLoadProgressDto | null>;
  let uploads: Subject<Result>;
  let uploadProgress: Subject<ImportWorkspaceFilesProgressDto | null>;
  const dialogData = { importType: 'testResults' };
  const dialogRef = { close: jest.fn() };
  const workspace = {
    id: 'tc-ws', label: 'Testcenter study', type: 'tc', flags: { mode: 'full' }
  };
  const group: TestGroupsInfoDto = {
    groupName: 'delayed-group',
    groupLabel: 'Delayed group',
    bookletsStarted: 1,
    numUnitsTotal: 1,
    numUnitsMin: 1,
    numUnitsMax: 1,
    numUnitsAvg: 1,
    lastChange: 1,
    existsInDatabase: false,
    hasBookletLogs: false
  };
  const workspaceAdmin = {
    getAuthToken: () => '',
    getLastServer: () => '',
    getLastUrl: () => '',
    setLastAuthToken: jest.fn(),
    setLastServer: jest.fn(),
    setLastUrl: jest.fn(),
    setClaims: jest.fn(),
    setlastTestcenterInstance: jest.fn(),
    setTestGroups: jest.fn()
  };
  let importService: jest.Mocked<Partial<ImportService>>;

  beforeEach(async () => {
    login = new Subject();
    groups = new Subject();
    groupProgress = new Subject();
    uploads = new Subject();
    uploadProgress = new Subject();
    dialogData.importType = 'testResults';
    jest.clearAllMocks();
    importService = {
      importTestcenterGroups: jest.fn(() => groups),
      getTestGroupsLoadProgress: jest.fn(() => groupProgress),
      importWorkspaceFiles: jest.fn(() => uploads),
      getImportWorkspaceFilesProgress: jest.fn(() => uploadProgress)
    };
    await TestBed.configureTestingModule({
      imports: [TestCenterImportComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: UserBackendService, useValue: { authenticate: () => login } },
        { provide: ImportService, useValue: importService },
        { provide: WorkspaceAdminService, useValue: workspaceAdmin },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestCenterImportComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.componentInstance.loginForm.patchValue({ name: 'user', pw: 'password', testCenter: 1 });
  });

  afterEach(() => fixture.destroy());

  const element = (): HTMLElement => fixture.nativeElement;

  async function authenticate(): Promise<void> {
    fixture.componentInstance.authenticate();
    await fixture.whenStable();
    login.next({ token: 'token', claims: { workspaceAdmin: [workspace] } });
    await fixture.whenStable();
    fixture.componentInstance.importFilesForm.patchValue({ workspace: workspace.id, responses: true });
  }

  it('replaces the login form with import options after a delayed login', async () => {
    fixture.componentInstance.authenticate();
    await fixture.whenStable();
    expect(element().querySelector('.auth-section')).not.toBeNull();
    login.next({ token: 'token', claims: { workspaceAdmin: [workspace] } });
    await fixture.whenStable();
    expect(element().querySelector('.auth-section')).toBeNull();
    expect(element().querySelector('.import-section')).not.toBeNull();
    expect(element().querySelector('.user-info')?.textContent).toContain('Testcenter 1');
    expect(fixture.componentInstance.workspaces()).toEqual([workspace]);
  });

  it.each(['invalid response', 'network error'])('renders a delayed %s and allows login again', async kind => {
    fixture.componentInstance.authenticate();
    await fixture.whenStable();
    if (kind === 'network error') login.error(new Error('offline'));
    else login.next({});
    await fixture.whenStable();
    expect(element().querySelector('.auth-section .error-message')?.textContent).toContain('login-error');
    login = new Subject();
    await authenticate();
    expect(element().querySelector('.auth-section')).toBeNull();
  });

  it('ignores login responses after logout or destruction', async () => {
    fixture.componentInstance.authenticate();
    fixture.componentInstance.logout();
    login.next({ token: 'old-token', claims: { workspaceAdmin: [workspace] } });
    await fixture.whenStable();
    expect(element().querySelector('.auth-section')).not.toBeNull();
    expect(workspaceAdmin.setLastAuthToken).not.toHaveBeenCalledWith('old-token');
    fixture.componentInstance.authenticate();
    fixture.destroy();
    expect(login.observed).toBe(false);
    login.next({ token: 'destroyed-token', claims: { workspaceAdmin: [workspace] } });
    expect(workspaceAdmin.setLastAuthToken).not.toHaveBeenCalledWith('destroyed-token');
  });

  it.each([true, false])('renders delayed group results (nonempty: %s) and ends loading', async nonempty => {
    await authenticate();
    fixture.componentInstance.getTestGroups();
    await fixture.whenStable();
    expect(element().querySelector('mat-spinner')).not.toBeNull();
    groupProgress.next({
      importRunId: 'run',
      status: 'running',
      totalGroups: 4,
      processedGroups: 2,
      existingGroups: 0,
      groupsWithLogs: 0,
      updatedAt: 1,
      message: 'Checking delayed groups'
    });
    await fixture.whenStable();
    expect(element().textContent).toContain('Checking delayed groups');
    expect(element().textContent).toContain('(50%)');
    groups.next(nonempty ? [group] : []);
    await fixture.whenStable();
    expect(element().querySelector('mat-spinner')).toBeNull();
    expect(element().querySelector('.testgroups-section')).not.toBeNull();
    expect(element().textContent).toContain(nonempty ? 'delayed-group' : 'Keine Testgruppen gefunden.');
    expect(groupProgress.observed).toBe(false);
  });

  it('shows delayed group errors and a successful retry without forcing a render', async () => {
    await authenticate();
    fixture.componentInstance.getTestGroups();
    await fixture.whenStable();
    groups.error(new Error('group timeout'));
    await fixture.whenStable();
    expect(element().querySelector('mat-spinner')).toBeNull();
    expect(element().querySelector('.error-message')?.textContent).toContain('group timeout');
    groups = new Subject();
    fixture.componentInstance.getTestGroups();
    await fixture.whenStable();
    groups.next([group]);
    await fixture.whenStable();
    expect(element().querySelector('.error-message')).toBeNull();
    expect(element().textContent).toContain('delayed-group');
  });

  it('renders delayed file progress and upload errors, then permits retry', async () => {
    dialogData.importType = 'testFiles';
    await authenticate();
    fixture.componentInstance.importFilesForm.patchValue({ definitions: true });
    fixture.componentInstance.getTestData();
    await fixture.whenStable();
    uploadProgress.next({
      importRunId: 'run',
      status: 'running',
      totalPlanned: 4,
      totalProcessed: 2,
      totalUploaded: 2,
      totalFailed: 0,
      options: [],
      updatedAt: 1,
      currentFile: 'delayed.xml'
    });
    await fixture.whenStable();
    expect(element().textContent).toContain('delayed.xml');
    expect(element().querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('50');
    uploads.error(new Error('upload timeout'));
    await fixture.whenStable();
    expect(element().querySelector('mat-spinner')).toBeNull();
    expect(element().querySelector('.error-message')?.textContent).toContain('upload timeout');
    expect(uploadProgress.observed).toBe(false);
    uploads = new Subject();
    fixture.componentInstance.getTestData();
    await fixture.whenStable();
    uploads.next({ success: true } as Result);
    // firstValueFrom resumes the async import on the next microtask.
    await Promise.resolve();
    await fixture.whenStable();
    expect(element().querySelector('.error-message')).toBeNull();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ didImport: true }));
  });

  it('renders sequential result import progress after each delayed response', async () => {
    await authenticate();
    fixture.componentInstance.getTestGroups();
    groups.next([group, { ...group, groupName: 'second-group' }]);
    await fixture.whenStable();
    fixture.componentInstance.toggleAllRows({ checked: true });
    fixture.componentInstance.getTestData();
    await fixture.whenStable();
    expect(element().textContent).toContain('Importiere Testgruppe 1/2');
    uploads.next({ success: true } as Result);
    // firstValueFrom resumes the async import on the next microtask.
    await Promise.resolve();
    await fixture.whenStable();
    expect(element().textContent).toContain('Importiere Testgruppe 2/2');
    expect(element().querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('50');
    uploads.next({ success: true } as Result);
    // firstValueFrom resumes the async import on the next microtask.
    await Promise.resolve();
    await fixture.whenStable();
    expect(element().querySelector('mat-spinner')).toBeNull();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ didImport: true, importedResponses: true }));
  });

  it('cancels delayed group and progress requests when the dialog is destroyed', async () => {
    await authenticate();
    fixture.componentInstance.getTestGroups();
    await fixture.whenStable();
    fixture.destroy();
    expect(groups.observed).toBe(false);
    expect(groupProgress.observed).toBe(false);
    groups.next([group]);
    expect(workspaceAdmin.setTestGroups).not.toHaveBeenCalled();
  });

  it('does not continue a sequential result import after destruction', async () => {
    await authenticate();
    fixture.componentInstance.selectedRows = [group, { ...group, groupName: 'second-group' }];
    fixture.componentInstance.getTestData();
    await fixture.whenStable();
    fixture.destroy();
    expect(uploads.observed).toBe(false);
    uploads.next({ success: true } as Result);
    await Promise.resolve();
    expect(importService.importWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
