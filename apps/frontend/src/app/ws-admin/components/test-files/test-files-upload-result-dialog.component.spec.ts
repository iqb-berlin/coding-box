import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TestFilesUploadResultDialogComponent, TestFilesUploadResultDialogData } from './test-files-upload-result-dialog.component';

describe('TestFilesUploadResultDialogComponent', () => {
  let fixture: ComponentFixture<TestFilesUploadResultDialogComponent>;
  let component: TestFilesUploadResultDialogComponent;
  let dialogRef: { close: jest.Mock };
  let router: { navigate: jest.Mock };

  const data: TestFilesUploadResultDialogData = {
    workspaceId: 1,
    attempted: 4,
    overwriteSelectedCount: 1,
    uploadedFiles: [{ filename: 'booklet.xml', fileId: 'f1', fileType: 'Booklet' } as never],
    failedFiles: [{ filename: 'bad.xml', reason: 'Invalid XML' } as never],
    remainingConflicts: [{ filename: 'unit.xml', fileId: 'f2', fileType: 'Unit' } as never],
    issues: [{
      level: 'warning', category: 'coding_freshness', message: 'Missing value', fileName: 'responses.csv', rowIndex: 3
    } as never]
  };

  beforeEach(async () => {
    dialogRef = { close: jest.fn() };
    router = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TestFilesUploadResultDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestFilesUploadResultDialogComponent);
    component = fixture.componentInstance;
  });

  it('returns counts, filters rows and tracks rendered items', () => {
    expect(component.attempted).toBe(4);
    expect(component.overwriteSelectedCount).toBe(1);
    expect(component.uploadedFiles).toHaveLength(1);
    expect(component.failedFiles).toHaveLength(1);
    expect(component.remainingConflicts).toHaveLength(1);
    expect(component.uploadedCount).toBe(1);
    expect(component.failedCount).toBe(1);
    expect(component.remainingConflictsCount).toBe(1);
    expect(component.issues).toHaveLength(1);

    component.filterText = 'xml';
    expect(component.filteredUploadedFiles).toHaveLength(1);
    expect(component.filteredFailedFiles).toHaveLength(1);
    expect(component.filteredRemainingConflicts).toHaveLength(1);
    component.filterText = 'missing';
    expect(component.filteredIssues).toHaveLength(1);
    component.filterText = 'nomatch';
    expect(component.filteredUploadedFiles).toHaveLength(0);
    expect(component.hasCodingFreshnessWarning).toBe(true);
    expect(component.canCheckCodingStatus).toBe(true);

    expect(component.trackByUploaded(0, data.uploadedFiles[0])).toContain('booklet.xml');
    expect(component.trackByFailed(0, data.failedFiles[0])).toContain('bad.xml');
    expect(component.trackByConflict(0, data.remainingConflicts[0])).toContain('unit.xml');
    expect(component.trackByIssue(0, data.issues![0])).toContain('Missing value');

    component.close();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('navigates to coding management when checking coding status', () => {
    component.checkCodingStatus();

    expect(dialogRef.close).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/workspace-admin/1/coding/management'],
      { queryParams: { refreshCodingFreshness: '1' } }
    );
  });

  it('falls back to defaults when optional data is absent', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TestFilesUploadResultDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            attempted: 0,
            uploadedFiles: [],
            failedFiles: [],
            remainingConflicts: []
          } satisfies TestFilesUploadResultDialogData
        }
      ]
    }).compileComponents();

    component = TestBed.createComponent(TestFilesUploadResultDialogComponent).componentInstance;

    expect(component.uploadedCount).toBe(0);
    expect(component.failedCount).toBe(0);
    expect(component.remainingConflictsCount).toBe(0);
    expect(component.overwriteSelectedCount).toBe(0);
    expect(component.filteredIssues).toEqual([]);
  });
});
