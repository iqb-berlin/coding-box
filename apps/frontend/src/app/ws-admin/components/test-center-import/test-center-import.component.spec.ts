import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
  MatDialog
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { TestCenterImportComponent } from './test-center-import.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { ImportService } from '../../../shared/services/file/import.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';
import { AppService } from '../../../core/services/app.service';

describe('TestCenterImportComponent', () => {
  let component: TestCenterImportComponent;
  let fixture: ComponentFixture<TestCenterImportComponent>;
  let userBackendService: jest.Mocked<UserBackendService>;
  let importService: jest.Mocked<ImportService>;
  let workspaceAdminService: jest.Mocked<WorkspaceAdminService>;
  let appService: jest.Mocked<AppService>;

  const mockDialogRef = {
    close: jest.fn()
  };

  const mockDialogData = {
    importType: 'testResults'
  };

  beforeEach(async () => {
    const userBackendMock = {
      authenticate: jest.fn()
    };
    const importMock = {
      importTestcenterGroups: jest.fn(),
      importWorkspaceFiles: jest.fn()
    };
    const workspaceAdminMock = {
      getAuthToken: jest.fn().mockReturnValue(''),
      getClaims: jest.fn().mockReturnValue([]),
      getlastTestcenterInstance: jest.fn().mockReturnValue([]),
      getTestGroups: jest.fn().mockReturnValue([]),
      getLastServer: jest.fn().mockReturnValue(''),
      getLastUrl: jest.fn().mockReturnValue(''),
      setLastAuthToken: jest.fn(),
      setLastServer: jest.fn(),
      setLastUrl: jest.fn(),
      setClaims: jest.fn(),
      setlastTestcenterInstance: jest.fn(),
      setTestGroups: jest.fn()
    };
    const appMock = {
      selectedWorkspaceId: 1
    };

    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule,
        NoopAnimationsModule,
        ReactiveFormsModule,
        TestCenterImportComponent
      ],
      providers: [
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: UserBackendService, useValue: userBackendMock },
        { provide: ImportService, useValue: importMock },
        { provide: WorkspaceAdminService, useValue: workspaceAdminMock },
        { provide: AppService, useValue: appMock },
        provideHttpClient()
      ]
    }).compileComponents();

    userBackendService = TestBed.inject(UserBackendService) as jest.Mocked<UserBackendService>;
    importService = TestBed.inject(ImportService) as jest.Mocked<ImportService>;
    workspaceAdminService = TestBed.inject(WorkspaceAdminService) as jest.Mocked<WorkspaceAdminService>;
    appService = TestBed.inject(AppService) as jest.Mocked<AppService>;

    fixture = TestBed.createComponent(TestCenterImportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should complete the whole user flow for testResults import', async () => {
    // 1. Initial state: authenticated = false
    expect(component.authenticated).toBe(false);

    // 2. Authenticate
    component.loginForm.patchValue({
      name: 'testuser',
      pw: 'testpass',
      testCenter: 1
    });
    userBackendService.authenticate.mockReturnValue(of({
      success: true,
      token: 'fake-token',
      claims: {
        workspaceAdmin: [{ id: 'tc-ws-1', label: 'TC Workspace 1', type: 'tc', flags: { mode: 'full' } }]
      }
    } as any));

    component.authenticate();
    fixture.detectChanges();

    expect(component.authenticated).toBe(true);
    expect(component.authToken).toBe('fake-token');
    expect(component.workspaces.length).toBe(1);

    // 3. Select workspace and options, then get groups
    component.importFilesForm.patchValue({
      workspace: 'tc-ws-1',
      responses: true
    });

    const mockGroups = [
      {
        groupName: 'group1',
        groupLabel: 'Group 1',
        bookletsStarted: 10,
        numUnitsTotal: 100,
        numUnitsMin: 1,
        numUnitsMax: 10,
        numUnitsAvg: 5,
        lastChange: Date.now(),
        existsInDatabase: false,
        hasBookletLogs: false
      }
    ];
    importService.importTestcenterGroups.mockReturnValue(of(mockGroups as any));

    component.getTestGroups();
    fixture.detectChanges();

    expect(component.showTestGroups).toBe(true);
    expect(component.testGroups).toEqual(mockGroups);

    // 4. Select group and import
    component.toggleRow(mockGroups[0]);
    expect(component.selectedRows.length).toBe(1);

    const mockImportResult = {
      success: true,
      responses: 10,
      logs: 0
    };
    importService.importWorkspaceFiles.mockReturnValue(of(mockImportResult as any));

    component.getTestData();
    fixture.detectChanges();

    expect(importService.importWorkspaceFiles).toHaveBeenCalledWith(
      1, // appService.selectedWorkspaceId
      'tc-ws-1',
      '1', // testCenter ID
      '', // individual URL
      'fake-token',
      expect.objectContaining({ responses: true }),
      ['group1'],
      true,
      undefined
    );

    expect(mockDialogRef.close).toHaveBeenCalledWith({
      didImport: true,
      resultType: 'responses',
      importedResponses: true,
      importedLogs: false
    });
  });

  it('should handle authentication error', () => {
    component.loginForm.patchValue({
      name: 'testuser',
      pw: 'testpass',
      testCenter: 1
    });
    userBackendService.authenticate.mockReturnValue(throwError(() => new Error('Auth failed')));

    component.authenticate();
    fixture.detectChanges();

    expect(component.authenticated).toBe(false);
    expect(component.authenticationError).toBe(true);
  });

  it('should logout correctly', () => {
    component.authenticated = true;
    component.authToken = 'some-token';

    component.logout();

    expect(component.authenticated).toBe(false);
    expect(component.authToken).toBe('');
    expect(workspaceAdminService.setLastAuthToken).toHaveBeenCalledWith('');
  });

  it('should complete the whole user flow for testFiles import with conflicts', async () => {
    // Change importType to testFiles
    (component as any).data = { importType: 'testFiles' };
    component.authenticated = true;
    component.authToken = 'fake-token';
    component.workspaces = [{ id: 'tc-ws-1', label: 'TC Workspace 1', type: 'tc', flags: { mode: 'full' } }];
    component.testCenterInstance = [{ id: 1, label: 'Testcenter 1' }];

    fixture.detectChanges();

    // 1. Set form values
    component.importFilesForm.patchValue({
      workspace: 'tc-ws-1',
      definitions: true
    });

    // 2. Mock initial import with conflicts
    const mockInitialResult = {
      testFilesUploadResult: {
        total: 1,
        uploaded: 0,
        failed: 0,
        uploadedFiles: [],
        failedFiles: [],
        conflicts: [{ fileId: 'file1', fileName: 'file1.xml', type: 'unit' }]
      }
    };
    importService.importWorkspaceFiles.mockReturnValueOnce(of(mockInitialResult as any));

    // 3. Mock dialog for conflicts
    const dialog = TestBed.inject(MatDialog);
    const mockConflictDialogRef = {
      afterClosed: jest.fn().mockReturnValue(of({ overwrite: true, overwriteFileIds: ['file1'] }))
    };
    jest.spyOn(dialog, 'open').mockReturnValue(mockConflictDialogRef as any);

    // 4. Mock second import (overwrite)
    const mockFinalResult = {
      testFilesUploadResult: {
        total: 1,
        uploaded: 1,
        failed: 0,
        uploadedFiles: [{ fileId: 'file1', fileName: 'file1.xml', type: 'unit' }],
        failedFiles: [],
        conflicts: []
      }
    };
    importService.importWorkspaceFiles.mockReturnValueOnce(of(mockFinalResult as any));

    // 5. Trigger import
    component.getTestData();
    fixture.detectChanges();

    expect(importService.importWorkspaceFiles).toHaveBeenCalledTimes(2);
    expect(dialog.open).toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      didImport: true,
      importType: 'testFiles',
      overwriteSelectedCount: 1
    }));
  });
});
