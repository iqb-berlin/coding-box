import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import {
  ImportComparisonData,
  ImportComparisonDialogComponent
} from './import-comparison-dialog.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';

describe('ImportComparisonDialogComponent', () => {
  let component: ImportComparisonDialogComponent;

  const dialogRefMock = {
    close: jest.fn()
  };
  const snackBarMock = {
    open: jest.fn()
  };
  const testPersonCodingServiceMock = {
    getExternalCodingImportResult: jest.fn(),
    notifyTestResultsChanged: jest.fn()
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
        {
          provide: TestPersonCodingService,
          useValue: testPersonCodingServiceMock
        }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(ImportComparisonDialogComponent);
    component = fixture.componentInstance;
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
  });

  it('should notify status consumers when import finished but result loading fails', () => {
    testPersonCodingServiceMock.getExternalCodingImportResult
      .mockReturnValueOnce(throwError(() => new Error('result unavailable')));

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
  });
});
