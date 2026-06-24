import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  getTestFilesUploadFailureSuggestions,
  TestFilesUploadResultDialogComponent,
  TestFilesUploadResultDialogData
} from './test-files-upload-result-dialog.component';

describe('TestFilesUploadResultDialogComponent', () => {
  let fixture: ComponentFixture<TestFilesUploadResultDialogComponent>;
  let component: TestFilesUploadResultDialogComponent;
  let dialogRef: { close: jest.Mock };
  let router: { navigate: jest.Mock };

  const data: TestFilesUploadResultDialogData = {
    workspaceId: 1,
    attempted: 4,
    overwriteSelectedCount: 1,
    failedCount: 2,
    uploadedFiles: [{ filename: 'booklet.xml', fileId: 'f1', fileType: 'Booklet' } as never],
    failedFiles: [
      {
        filename: 'bad.xml',
        reason: 'Invalid XML',
        details: ['line 12: Duplicate key']
      } as never,
      {
        filename: 'bad.xml',
        reason: 'Invalid XML',
        details: ['line 12: Duplicate key']
      } as never
    ],
    remainingConflicts: [{ filename: 'unit.xml', fileId: 'f2', fileType: 'Unit' } as never],
    issues: [{
      level: 'warning', category: 'coding_freshness', message: 'Missing value', fileName: 'responses.csv', rowIndex: 3
    } as never]
  };

  beforeEach(async () => {
    dialogRef = { close: jest.fn() };
    router = { navigate: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [
        TestFilesUploadResultDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      'file-upload': {
        'failure-suggestions': {
          title: 'Hinweise',
          'duplicate-key': 'Der Wert{{value}} kommt mehrfach vor. Prüfen Sie die gemeldete Zeile und entfernen Sie doppelte Variable-/Element-IDs oder Aliase.',
          'invalid-xml': 'Prüfen Sie, ob die Datei gültiges XML enthält, und exportieren Sie sie bei Bedarf erneut.',
          'schema-validation': 'Korrigieren Sie die genannten Schemafehler in der Datei und starten Sie den Upload danach erneut.'
        }
      }
    });
    translate.use('de');

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
    component.filterText = 'duplicate key';
    expect(component.filteredFailedFiles).toHaveLength(1);
    component.filterText = 'mehrfach';
    expect(component.filteredFailedFiles).toHaveLength(1);
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

  it('suggests fixes for common upload failure details', () => {
    expect(getTestFilesUploadFailureSuggestions(data.failedFiles[0])).toEqual([
      {
        key: 'file-upload.failure-suggestions.duplicate-key',
        params: { value: '' }
      },
      { key: 'file-upload.failure-suggestions.invalid-xml' }
    ]);

    expect(getTestFilesUploadFailureSuggestions({
      filename: 'bad.xml',
      reason: 'XSD validation failed: bad.xml',
      details: [
        "line 299: Element 'Variable': Duplicate key-sequence ['08'] in key identity-constraint 'basicKey'."
      ]
    })).toEqual([
      {
        key: 'file-upload.failure-suggestions.duplicate-key',
        params: { value: ' "08"' }
      },
      { key: 'file-upload.failure-suggestions.schema-validation' }
    ]);
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
      imports: [
        TestFilesUploadResultDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
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
