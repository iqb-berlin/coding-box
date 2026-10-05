import {
  Component, Inject, OnDestroy, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Subscription } from 'rxjs';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import {
  ContentPoolAcpSummary,
  ContentPoolSettings,
  ContentPoolUploadFilesProgress,
  ContentPoolUploadFilesResult
} from '../../models/content-pool.model';

export interface ContentPoolUploadDialogFile {
  id: number;
  filename: string;
}

export interface ContentPoolUploadDialogData {
  workspaceId: number;
  files: ContentPoolUploadDialogFile[];
  settings: ContentPoolSettings;
}

export interface ContentPoolUploadDialogResult {
  success: boolean;
  result: ContentPoolUploadFilesResult;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-content-pool-upload-dialog',
  templateUrl: './content-pool-upload-dialog.component.html',
  styleUrls: ['./content-pool-upload-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatIconModule
  ]
})
export class ContentPoolUploadDialogComponent implements OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  private readonly contentPoolIntegrationService = inject(
    ContentPoolIntegrationService
  );

  private readonly dialogRef = inject(
    MatDialogRef<ContentPoolUploadDialogComponent>
  );

  protected readonly changelog = signal('');

  protected readonly acps = signal<ContentPoolAcpSummary[]>([]);

  readonly selectedAcpId = signal('');

  protected readonly isLoadingAcps = signal(false);

  protected readonly isUploading = signal(false);

  protected readonly hasLoadedAcps = signal(false);

  protected readonly errorMessage = signal('');

  readonly uploadProgress = signal<ContentPoolUploadFilesProgress | undefined>(undefined);

  private uploadSubscription?: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) readonly data: ContentPoolUploadDialogData
  ) {
    this.changelog.set(`Dateien aus Coding-Box ersetzt: ${data.files.map(file => file.filename).join(', ')}`);
  }

  ngOnDestroy(): void {
    this.uploadSubscription?.unsubscribe();
  }

  protected loadAcps(): void {
    this.errorMessage.set('');
    this.isLoadingAcps.set(true);
    this.hasLoadedAcps.set(false);
    this.selectedAcpId.set('');
    this.acps.set([]);

    this.contentPoolIntegrationService
      .listAccessibleAcps(this.data.workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.isLoadingAcps.set(false);
          this.hasLoadedAcps.set(true);
          this.acps.set(response.acps || []);
          if (this.acps().length === 0) {
            this.errorMessage.set('Keine ACPs gefunden oder kein Zugriff vorhanden.');
          }
        },
        error: error => {
          this.isLoadingAcps.set(false);
          this.errorMessage.set(this.extractErrorMessage(error, 'ACP-Liste konnte nicht aus dem Content Pool geladen werden.'));
        }
      });
  }

  protected uploadFiles(): void {
    if (!this.selectedAcpId()) {
      this.errorMessage.set('Bitte ein ACP auswählen.');
      return;
    }

    this.errorMessage.set('');
    this.isUploading.set(true);
    this.uploadProgress.set({
      jobId: '',
      status: 'pending',
      phase: 'queued',
      message: 'Upload wird vorbereitet...',
      processedFiles: 0,
      totalFiles: this.data.files.length,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.uploadSubscription?.unsubscribe();

    this.uploadSubscription = this.contentPoolIntegrationService
      .uploadFilesToAcpWithProgress(this.data.workspaceId, {
        acpId: this.selectedAcpId(),
        fileIds: this.data.files.map(file => file.id),
        changelog: this.changelog().trim()
      })
      .subscribe({
        next: progress => {
          this.uploadProgress.set(progress);

          if (progress.status === 'failed') {
            this.isUploading.set(false);
            this.errorMessage.set(progress.error ||
    'Dateien konnten nicht in den Content Pool übertragen werden.');
            return;
          }

          if (progress.status === 'completed' && progress.result) {
            this.isUploading.set(false);
            this.dialogRef.close({
              success: true,
              result: progress.result
            });
          }
        },
        error: error => {
          this.isUploading.set(false);
          this.errorMessage.set(this.extractErrorMessage(error, 'Dateien konnten nicht in den Content Pool übertragen werden.'));
        }
      });
  }

  protected get uploadProgressMode(): 'determinate' | 'indeterminate' {
    return this.uploadProgress()?.totalFiles || this.uploadProgress()?.progress ?
      'determinate' :
      'indeterminate';
  }

  protected get uploadProgressValue(): number {
    const progress = this.uploadProgress()?.progress || 0;
    return Math.max(0, Math.min(100, progress));
  }

  protected get uploadProgressText(): string {
    const uploadProgressSnapshot = this.uploadProgress();

    if (!uploadProgressSnapshot) {
      return '';
    }

    if (
      uploadProgressSnapshot.phase === 'replacing-files' &&
      uploadProgressSnapshot.totalFiles > 0
    ) {
      const currentFile = uploadProgressSnapshot.currentFileName ?
        `: ${uploadProgressSnapshot.currentFileName}` :
        '';
      return `Datei ${uploadProgressSnapshot.processedFiles} von ${uploadProgressSnapshot.totalFiles}${currentFile}`;
    }

    return uploadProgressSnapshot.message;
  }

  protected cancel(): void {
    this.dialogRef.close({ success: false });
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    const payload = error as {
      error?: {
        message?: string | string[];
      };
    };

    if (Array.isArray(payload?.error?.message)) {
      return payload.error.message.join(', ');
    }
    if (typeof payload?.error?.message === 'string') {
      return payload.error.message;
    }
    return fallback;
  }
}
