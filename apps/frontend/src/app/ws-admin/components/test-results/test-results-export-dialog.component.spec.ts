import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestResultsExportDialogComponent } from './test-results-export-dialog.component';

describe('TestResultsExportDialogComponent', () => {
  let fixture: ComponentFixture<TestResultsExportDialogComponent>;
  let dialogRef: { close: jest.Mock };

  function createComponent(data: Partial<TestResultsExportDialogComponent['data']> = {}): void {
    dialogRef = { close: jest.fn() };

    TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TestResultsExportDialogComponent
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            isExporting: false,
            exportTypeInProgress: null,
            exportJobStatus: null,
            exportJobProgress: 0,
            exportJobId: null,
            ...data
          }
        }
      ]
    });

    fixture = TestBed.createComponent(TestResultsExportDialogComponent);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows only progress and cancel action while an export is running', () => {
    createComponent({
      isExporting: true,
      exportTypeInProgress: 'test-logs',
      exportJobStatus: 'active',
      exportJobProgress: 42,
      exportJobId: 'job-1'
    });

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Logs');
    expect(text).toContain('active');
    expect(text).toContain('42%');
    expect(text).toContain('Export abbrechen');
    expect(text).not.toContain('Testergebnisse ohne Kodierung exportieren');
    expect(text).not.toContain('Logs exportieren');
  });

  it('returns a cancel result for the active export job', () => {
    createComponent({
      isExporting: true,
      exportJobId: 'job-1'
    });

    const cancelButton = fixture.debugElement.query(By.css('mat-dialog-actions button'));
    cancelButton.triggerEventHandler('click');

    expect(dialogRef.close).toHaveBeenCalledWith({
      type: 'cancel',
      jobId: 'job-1'
    });
  });
});
