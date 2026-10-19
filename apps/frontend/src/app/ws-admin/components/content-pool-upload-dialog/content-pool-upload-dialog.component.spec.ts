import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { ContentPoolUploadDialogComponent } from './content-pool-upload-dialog.component';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import { ContentPoolAcpListResponse, ContentPoolUploadFilesProgress } from '../../../shared/models/content-pool.model';

const settings = { enabled: true, baseUrl: 'https://example.org', hasApplicationToken: true };

describe('ContentPoolUploadDialogComponent zoneless rendering', () => {
  let fixture: ComponentFixture<ContentPoolUploadDialogComponent>;
  let acps: Subject<ContentPoolAcpListResponse>;
  let progress: Subject<ContentPoolUploadFilesProgress>;
  const close = jest.fn();

  beforeEach(async () => {
    acps = new Subject<ContentPoolAcpListResponse>();
    progress = new Subject<ContentPoolUploadFilesProgress>();
    close.mockClear();
    await TestBed.configureTestingModule({
      imports: [ContentPoolUploadDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1, settings, files: [{ id: 1, filename: 'unit.xml' }] } },
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: ContentPoolIntegrationService,
          useValue: { listAccessibleAcps: () => acps, uploadFilesToAcpWithProgress: () => progress }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ContentPoolUploadDialogComponent);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.load-acps-actions button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();
  });

  async function loadAcp(): Promise<void> {
    acps.next({ settings, acps: [{ id: 'acp-1', name: 'Test ACP' }] });
    acps.complete();
    await fixture.whenStable();
  }

  async function startTransfer(): Promise<void> {
    await loadAcp();
    fixture.componentInstance.selectedAcpId.set('acp-1');
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('mat-dialog-actions button:last-child').click();
    await fixture.whenStable();
  }

  it('shows delayed ACP choices and stops loading', async () => {
    await loadAcp();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.load-acps-actions button').disabled).toBe(false);
  });

  it('shows an empty-list message after a delayed response', async () => {
    acps.next({ settings, acps: [] });
    acps.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-message').textContent).toContain('Keine ACPs gefunden');
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
  });

  it('shows delayed list failures and permits retry', async () => {
    acps.error({ error: { message: 'Liste nicht erreichbar' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-message').textContent).toContain('Liste nicht erreichbar');
    expect(fixture.nativeElement.querySelector('.load-acps-actions button').disabled).toBe(false);
  });

  it('renders progress and releases the actions after a failed job', async () => {
    await startTransfer();
    const running: ContentPoolUploadFilesProgress = {
      jobId: 'job-1',
      status: 'running',
      phase: 'loading-files',
      message: 'Dateien laden',
      processedFiles: 1,
      totalFiles: 2,
      progress: 50,
      createdAt: '',
      updatedAt: ''
    };
    progress.next(running);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.upload-progress').textContent).toContain('50%');
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button').disabled).toBe(true);
    progress.next({
      ...running, status: 'failed', phase: 'failed', error: 'Transfer fehlgeschlagen'
    });
    progress.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-message').textContent).toContain('Transfer fehlgeschlagen');
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.upload-progress')).toBeNull();
  });

  it('renders transport failures and permits retry', async () => {
    await startTransfer();
    progress.error({ error: { message: 'Verbindung unterbrochen' } });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-message').textContent).toContain('Verbindung unterbrochen');
    expect(fixture.nativeElement.querySelector('mat-dialog-actions button:last-child').disabled).toBe(false);
  });
});
