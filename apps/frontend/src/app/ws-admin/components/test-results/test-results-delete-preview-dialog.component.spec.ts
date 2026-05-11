import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  TestResultsDeletePreviewDialogComponent,
  TestResultsDeletePreviewDialogData
} from './test-results-delete-preview-dialog.component';

describe('TestResultsDeletePreviewDialogComponent', () => {
  let fixture: ComponentFixture<TestResultsDeletePreviewDialogComponent>;
  let component: TestResultsDeletePreviewDialogComponent;
  let dialogRef: { close: jest.Mock };

  const data: TestResultsDeletePreviewDialogData = {
    preview: {
      scope: 'filteredPersons',
      label: 'alle sichtbaren Testpersonen',
      persons: 75,
      booklets: 4,
      units: 33,
      responses: 10725,
      groups: ['G1', 'G2'],
      bookletNames: ['B1', 'B2'],
      unitNames: ['U1', 'U2'],
      warnings: []
    }
  };

  beforeEach(async () => {
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TestResultsDeletePreviewDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsDeletePreviewDialogComponent);
    component = fixture.componentInstance;
  });

  it('requires acknowledgement for broad deletions and exposes overview-style metrics', () => {
    expect(component.metrics).toEqual([
      { label: 'Testpersonen', value: 75 },
      { label: 'Testhefte', value: 4, hint: 'einzigartig' },
      { label: 'Aufgaben', value: 33, hint: 'einzigartig' },
      { label: 'Antworten', value: 10725, hint: 'einzigartig' }
    ]);
    expect(component.requiresAcknowledgement).toBe(true);
    expect(component.canConfirm).toBe(false);

    component.onAcknowledgementChange({ checked: true } as never);
    expect(component.canConfirm).toBe(true);

    component.confirm();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('shows log-specific metrics and confirmation text', () => {
    component.data.preview = {
      targetType: 'logs',
      scope: 'filteredPersons',
      label: 'alle sichtbaren Testpersonen',
      persons: 3,
      booklets: 2,
      units: 12,
      responses: 120,
      bookletLogs: 5,
      unitLogs: 42,
      sessions: 3,
      groups: [],
      bookletNames: [],
      unitNames: [],
      warnings: []
    };

    expect(component.dialogTitle).toBe('Logs unwiderruflich entfernen');
    expect(component.metrics).toEqual([
      { label: 'Booklet-Logs', value: 5 },
      { label: 'Aufgaben-Logs', value: 42 },
      { label: 'Sitzungen', value: 3 },
      { label: 'Testpersonen', value: 3, hint: 'betroffen' }
    ]);
    expect(component.canConfirm).toBe(false);

    component.onAcknowledgementChange({ checked: true } as never);
    expect(component.canConfirm).toBe(true);
    expect(component.confirmButtonLabel).toBe('Logs entfernen');
  });
});
