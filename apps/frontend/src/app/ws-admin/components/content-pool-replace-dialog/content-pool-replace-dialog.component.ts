import { Component, Inject, inject } from '@angular/core';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import {
  ContentPoolAcpSummary,
  ContentPoolSettings
} from '../../models/content-pool.model';

export interface ContentPoolReplaceDialogData {
  workspaceId: number;
  fileId: number;
  fileName: string;
  settings: ContentPoolSettings;
}

@Component({
  selector: 'coding-box-content-pool-replace-dialog',
  templateUrl: './content-pool-replace-dialog.component.html',
  styleUrls: ['./content-pool-replace-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatIconModule
  ]
})
export class ContentPoolReplaceDialogComponent {
  private readonly contentPoolIntegrationService = inject(
    ContentPoolIntegrationService
  );

  private readonly snackBar = inject(MatSnackBar);

  private readonly dialogRef = inject(
    MatDialogRef<ContentPoolReplaceDialogComponent>
  );

  username = '';

  password = '';

  changelog = '';

  acps: ContentPoolAcpSummary[] = [];

  selectedAcpId = '';

  isLoadingAcps = false;

  isReplacing = false;

  hasAuthenticated = false;

  errorMessage = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public readonly data: ContentPoolReplaceDialogData
  ) {
    this.changelog = `Kodierschema aus Coding-Box ersetzt: ${data.fileName}`;
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

  replaceCodingScheme(): void {
    if (!this.selectedAcpId) {
      this.errorMessage = 'Bitte ein ACP auswählen.';
      return;
    }

    this.errorMessage = '';
    this.isReplacing = true;

    this.contentPoolIntegrationService
      .replaceCodingScheme(this.data.workspaceId, {
        username: this.username.trim(),
        password: this.password,
        acpId: this.selectedAcpId,
        fileId: this.data.fileId,
        changelog: this.changelog.trim()
      })
      .subscribe({
        next: result => {
          this.isReplacing = false;
          this.snackBar.open(
            `Kodierschema "${result.fileName}" erfolgreich ersetzt${
              result.versionNumber ? ` (Version ${result.versionNumber})` : ''
            }.`,
            'OK',
            { duration: 4000 }
          );
          this.dialogRef.close({ success: true, result });
        },
        error: error => {
          this.isReplacing = false;
          this.errorMessage = this.extractErrorMessage(
            error,
            'Kodierschema konnte nicht übertragen werden.'
          );
        }
      });
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
