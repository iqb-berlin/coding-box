import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import {
  ImportComparisonData, ImportComparisonDialogComponent
} from './import-comparison-dialog.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ExternalCodingImportResultDto } from '../../../../../../../api-dto/coding/external-coding-import-result.dto';

jest.unmock('@angular/material/snack-bar');

describe('External coding import delayed responses without Zone.js', () => {
  let fixture: ComponentFixture<ImportComparisonDialogComponent>;
  let start: Subject<{ jobId: string }>;
  let status: Subject<{ status: string; progress: number; error?: string }>;
  let result: Subject<ExternalCodingImportResultDto>;
  let service: jest.Mocked<Partial<TestPersonCodingService>>;
  let dialogRef: { close: jest.Mock };

  const data: ImportComparisonData = {
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

  const applyButton = (): HTMLButtonElement => Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('button')
  ).find(button => button.textContent?.includes('Änderungen anwenden'))!;

  const progressElement = (): HTMLElement | null => fixture.nativeElement.querySelector('.apply-progress');

  beforeEach(async () => {
    start = new Subject();
    status = new Subject();
    result = new Subject();
    dialogRef = { close: jest.fn() };
    service = {
      startExternalCodingImportJob: jest.fn(() => start),
      getExternalCodingImportJobStatus: jest.fn(() => status),
      getExternalCodingImportResult: jest.fn(() => result),
      notifyTestResultsChanged: jest.fn()
    };
    await TestBed.configureTestingModule({
      imports: [ImportComparisonDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: TestPersonCodingService, useValue: service }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ImportComparisonDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(async () => {
    TestBed.inject(MatSnackBar).dismiss();
    await fixture.whenStable();
    fixture.destroy();
  });

  async function startImport(): Promise<void> {
    applyButton().click();
    await fixture.whenStable();
    expect(applyButton().disabled).toBe(true);
    expect(progressElement()?.textContent).toContain('0%');
  }

  async function startPolling(): Promise<void> {
    await startImport();
    start.next({ jobId: 'import-1' });
    start.complete();
    await new Promise(resolve => { setTimeout(resolve, 2050); });
    expect(service.getExternalCodingImportJobStatus).toHaveBeenCalledWith(12, 'import-1');
  }

  function expectRetryEnabled(): void {
    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(applyButton().disabled).toBe(false);
    expect(progressElement()).toBeNull();
  }

  it('renders delayed polling progress without another interaction', async () => {
    await startPolling();
    status.next({ status: 'processing', progress: 65 });
    await fixture.whenStable();

    expect(progressElement()?.textContent).toContain('65%');
    expect(progressElement()?.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow')).toBe('65');
  });

  it('enables retry after a delayed failed start request', async () => {
    await startImport();
    start.error({ status: 409 });
    await fixture.whenStable();

    expectRetryEnabled();
    expect(document.querySelector('.cdk-overlay-container')?.textContent)
      .toContain('Ein Import läuft bereits für diesen Workspace.');
  });

  it('enables retry when a delayed polling response reports a failed job', async () => {
    await startPolling();
    status.next({ status: 'failed', progress: 42, error: 'Invalid coding file' });
    await fixture.whenStable();

    expectRetryEnabled();
    expect(document.querySelector('.cdk-overlay-container')?.textContent)
      .toContain('Import fehlgeschlagen: Invalid coding file');
    expect(status.observed).toBe(false);
  });

  it('enables retry after a delayed polling request error', async () => {
    await startPolling();
    status.error(new Error('Status unavailable'));
    await fixture.whenStable();

    expectRetryEnabled();
    expect(document.querySelector('.cdk-overlay-container')?.textContent)
      .toContain('Fehler beim Abfragen des Import-Status.');
  });

  it('renders completion while awaiting the result and closes with the applied import', async () => {
    await startPolling();
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();

    expect(progressElement()?.textContent).toContain('100%');
    expect(service.getExternalCodingImportResult).toHaveBeenCalledWith(12, 'import-1');
    expect(dialogRef.close).not.toHaveBeenCalled();
    const imported: ExternalCodingImportResultDto = {
      message: 'applied', processedRows: 1, updatedRows: 1, errors: [], affectedRows: []
    };
    result.next(imported);
    result.complete();
    await fixture.whenStable();

    expectRetryEnabled();
    expect(service.notifyTestResultsChanged).toHaveBeenCalledWith({ workspaceId: 12, statisticsVersion: 'v3' });
    expect(dialogRef.close).toHaveBeenCalledWith({ applied: true, result: imported });
    expect(status.observed).toBe(false);
  });

  it('unsubscribes an active polling request when the dialog is destroyed', async () => {
    await startPolling();
    expect(status.observed).toBe(true);
    fixture.destroy();

    expect(status.observed).toBe(false);
    status.next({ status: 'completed', progress: 100 });
    expect(service.getExternalCodingImportResult).not.toHaveBeenCalled();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
