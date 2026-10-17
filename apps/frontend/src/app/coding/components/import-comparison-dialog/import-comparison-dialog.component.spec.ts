import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
  NEVER, of, Subject, throwError
} from 'rxjs';
import {
  ImportComparisonData,
  ImportComparisonDialogComponent
} from './import-comparison-dialog.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { UserService } from '../../../shared/services/user/user.service';
import { CodingPermissionsService } from '../../services/coding-permissions.service';

describe('ImportComparisonDialogComponent', () => {
  let component: ImportComparisonDialogComponent;
  let fixture: ComponentFixture<ImportComparisonDialogComponent>;
  const app = { selectedWorkspaceId: 12, authData: { userId: 7, isAdmin: false } };
  const users = { getUsers: jest.fn() };

  const dialogRefMock = {
    close: jest.fn()
  };
  const snackBarMock = {
    open: jest.fn()
  };
  const testPersonCodingServiceMock = {
    getExternalCodingImportResult: jest.fn(),
    notifyTestResultsChanged: jest.fn(),
    startExternalCodingImportJob: jest.fn(() => NEVER)
  };
  const dialogData: ImportComparisonData = {
    message: 'preview',
    processedRows: 1,
    updatedRows: 1,
    errors: [],
    affectedRows: [],
    isPreview: true,
    workspaceId: 12,
    fileData: 'encoded',
    fileName: 'coding.csv',
    sourceVersion: 'v3'
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    app.selectedWorkspaceId = 12;
    app.authData = { userId: 7, isAdmin: false };
    users.getUsers.mockReturnValue(of([{ id: 7, accessLevel: 3 }]));
    testPersonCodingServiceMock.getExternalCodingImportResult.mockReturnValue(of({
      message: 'applied',
      processedRows: 1,
      updatedRows: 1,
      errors: [],
      affectedRows: []
    }));

    await TestBed.configureTestingModule({
      imports: [ImportComparisonDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: AppService, useValue: app },
        { provide: UserService, useValue: users },
        {
          provide: TestPersonCodingService,
          useValue: testPersonCodingServiceMock
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ImportComparisonDialogComponent);
    component = fixture.componentInstance;
  });

  const applyButton = (): HTMLButtonElement | undefined => Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button')
  ).find(button => button.textContent?.includes('Änderungen anwenden'));

  function invokeApply(): void {
    (component as unknown as { applyImport: () => void }).applyImport();
  }

  it('keeps the Level-2 preview readable but blocks both the apply button and direct action', () => {
    users.getUsers.mockReturnValue(of([{ id: 7, accessLevel: 2 }]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Dies ist eine Vorschau.');
    expect(applyButton()).toBeUndefined();
    invokeApply();
    expect(testPersonCodingServiceMock.startExternalCodingImportJob).not.toHaveBeenCalled();
    expect(component.isLoading()).toBe(false);
  });

  it.each([false, true])('permits a study manager or administrator to apply (admin=%s)', isAdmin => {
    app.authData.isAdmin = isAdmin;
    users.getUsers.mockReturnValue(of(isAdmin ? [] : [{ id: 7, accessLevel: 3 }]));
    fixture.detectChanges();

    expect(applyButton()).toBeDefined();
    applyButton()!.click();
    expect(testPersonCodingServiceMock.startExternalCodingImportJob).toHaveBeenCalledWith(12, expect.objectContaining({
      file: 'encoded', fileName: 'coding.csv', sourceVersion: 'v3'
    }));
  });

  it('fails closed while the role request is pending or fails', () => {
    const pending = new Subject<Array<{ id: number; accessLevel: number }>>();
    users.getUsers.mockReturnValue(pending);
    fixture.detectChanges();
    expect(applyButton()).toBeUndefined();
    invokeApply();
    pending.error(new Error('roles unavailable'));
    fixture.detectChanges();
    expect(applyButton()).toBeUndefined();
    invokeApply();
    expect(testPersonCodingServiceMock.startExternalCodingImportJob).not.toHaveBeenCalled();
  });

  it('rejects an old preview after switching to another writable workspace', () => {
    fixture.detectChanges();
    expect(applyButton()).toBeDefined();
    app.selectedWorkspaceId = 13;
    TestBed.inject(CodingPermissionsService).load(13);
    fixture.detectChanges();

    expect(applyButton()).toBeUndefined();
    invokeApply();
    expect(testPersonCodingServiceMock.startExternalCodingImportJob).not.toHaveBeenCalled();
  });

  it('rechecks permissions after a loaded preview loses apply access', () => {
    fixture.detectChanges();
    expect(applyButton()).toBeDefined();
    users.getUsers.mockReturnValue(of([{ id: 7, accessLevel: 2 }]));
    TestBed.inject(CodingPermissionsService).load(12);
    fixture.detectChanges();

    expect(applyButton()).toBeUndefined();
    invokeApply();
    expect(testPersonCodingServiceMock.startExternalCodingImportJob).not.toHaveBeenCalled();
  });

  it('should notify status consumers when applied import results are loaded', () => {
    const importResult = {
      message: 'applied',
      processedRows: 1,
      updatedRows: 1,
      errors: [],
      affectedRows: []
    };
    testPersonCodingServiceMock.getExternalCodingImportResult
      .mockReturnValueOnce(of(importResult));
    component.isLoading.set(true);
    component.applyProgress.set(100);

    (component as unknown as {
      fetchImportResult: (workspaceId: number, jobId: string) => void;
    }).fetchImportResult(12, 'job-1');

    expect(testPersonCodingServiceMock.notifyTestResultsChanged)
      .toHaveBeenCalledWith({
        workspaceId: 12,
        statisticsVersion: 'v3'
      });
    expect(dialogRefMock.close).toHaveBeenCalledWith({
      applied: true,
      result: importResult
    });
    expect(component.isLoading()).toBe(false);
    expect(component.applyProgress()).toBe(-1);
  });

  it('should notify status consumers when import finished but result loading fails', () => {
    testPersonCodingServiceMock.getExternalCodingImportResult
      .mockReturnValueOnce(throwError(() => new Error('result unavailable')));
    component.isLoading.set(true);
    component.applyProgress.set(100);

    (component as unknown as {
      fetchImportResult: (workspaceId: number, jobId: string) => void;
    }).fetchImportResult(12, 'job-1');

    expect(testPersonCodingServiceMock.notifyTestResultsChanged)
      .toHaveBeenCalledWith({
        workspaceId: 12,
        statisticsVersion: 'v3'
      });
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Import abgeschlossen, aber Ergebnis konnte nicht geladen werden.',
      '',
      { duration: 5000 }
    );
    expect(dialogRefMock.close).toHaveBeenCalledWith({ applied: true });
    expect(component.isLoading()).toBe(false);
    expect(component.applyProgress()).toBe(-1);
  });
});
