import {
  Component, Inject, OnDestroy, inject
} from '@angular/core';
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
  private readonly contentPoolIntegrationService = inject(
    ContentPoolIntegrationService
  );

  private readonly dialogRef = inject(
    MatDialogRef<ContentPoolUploadDialogComponent>
  );

  username = '';

  password = '';

  changelog = '';

  acps: ContentPoolAcpSummary[] = [];

  selectedAcpId = '';

  isLoadingAcps = false;

  isUploading = false;

  hasAuthenticated = false;

  errorMessage = '';

  uploadProgress?: ContentPoolUploadFilesProgress;

  private uploadSubscription?: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) readonly data: ContentPoolUploadDialogData
  ) {
    this.changelog = `Dateien aus Coding-Box ersetzt: ${
      data.files.map(file => file.filename).join(', ')
    }`;
  }

  ngOnDestroy(): void {
    this.uploadSubscription?.unsubscribe();
  }

  loadAcps(): void {
    if (!this.username.trim() || !this.password.trim()) {
      this.errorMessage =
        'Bitte Benutzername und Passwort für den Content Pool eingeben.';
      return;
    }

    this.errorMessage = '';
    this.isLoadingAcps = true;
    this.hasAuthenticated = false;
    this.selectedAcpId = '';
    this.acps = [];

    this.contentPoolIntegrationService
      .listAccessibleAcps(
        this.data.workspaceId,
        this.username.trim(),
        this.password
      )
      .subscribe({
        next: response => {
          this.isLoadingAcps = false;
          this.hasAuthenticated = true;
          this.acps = response.acps || [];
          if (this.acps.length === 0) {
            this.errorMessage = 'Keine ACPs gefunden oder kein Zugriff vorhanden.';
          }
        },
        error: error => {
          this.isLoadingAcps = false;
          this.errorMessage = this.extractErrorMessage(
            error,
            'Anmeldung am Content Pool fehlgeschlagen.'
          );
        }
      });
  }

  uploadFiles(): void {
    if (!this.selectedAcpId) {
      this.errorMessage = 'Bitte ein ACP auswählen.';
      return;
    }

    this.errorMessage = '';
    this.isUploading = true;
    this.uploadProgress = {
      jobId: '',
      status: 'pending',
      phase: 'queued',
      message: 'Upload wird vorbereitet...',
      processedFiles: 0,
      totalFiles: this.data.files.length,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.uploadSubscription?.unsubscribe();

    this.uploadSubscription = this.contentPoolIntegrationService
      .uploadFilesToAcpWithProgress(this.data.workspaceId, {
        username: this.username.trim(),
        password: this.password,
        acpId: this.selectedAcpId,
        fileIds: this.data.files.map(file => file.id),
        changelog: this.changelog.trim()
      })
      .subscribe({
        next: progress => {
          this.uploadProgress = progress;

          if (progress.status === 'failed') {
            this.isUploading = false;
            this.errorMessage = progress.error ||
              'Dateien konnten nicht in den Content Pool übertragen werden.';
            return;
          }

          if (progress.status === 'completed' && progress.result) {
            this.isUploading = false;
            this.dialogRef.close({
              success: true,
              result: progress.result
            });
          }
        },
        error: error => {
          this.isUploading = false;
          this.errorMessage = this.extractErrorMessage(
            error,
            'Dateien konnten nicht in den Content Pool übertragen werden.'
          );
        }
      });
  }

  get uploadProgressMode(): 'determinate' | 'indeterminate' {
    return this.uploadProgress?.totalFiles || this.uploadProgress?.progress ?
      'determinate' :
      'indeterminate';
  }

  get uploadProgressValue(): number {
    const progress = this.uploadProgress?.progress || 0;
    return Math.max(0, Math.min(100, progress));
  }

  get uploadProgressText(): string {
    if (!this.uploadProgress) {
      return '';
    }

    if (
      this.uploadProgress.phase === 'replacing-files' &&
      this.uploadProgress.totalFiles > 0
    ) {
      const currentFile = this.uploadProgress.currentFileName ?
        `: ${this.uploadProgress.currentFileName}` :
        '';
      return `Datei ${this.uploadProgress.processedFiles} von ${this.uploadProgress.totalFiles}${currentFile}`;
    }

    return this.uploadProgress.message;
  }

  cancel(): void {
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
