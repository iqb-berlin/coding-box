import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnDestroy, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AppService, standardLogo } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { AppLogoDto } from '../../../../../../../api-dto/app-logo-dto';

type DatabaseExportStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface DatabaseExportJobState {
  status: DatabaseExportStatus;
  progress: number;
  result?: {
    filePath: string;
    fileName: string;
    fileSize: number;
    createdAt: number;
    requestedByUserId: number;
  };
  error?: string;
}

@Component({
  selector: 'coding-box-sys-admin-settings',
  templateUrl: './sys-admin-settings.component.html',
  styleUrls: ['./sys-admin-settings.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule
  ]
})
export class SysAdminSettingsComponent implements OnDestroy {
  appService = inject(AppService);
  private http = inject(HttpClient);
  private logoService = inject(LogoService);
  private snackBar = inject(MatSnackBar);
  private exportPollingSubscription: Subscription | null = null;

  selectedFile: File | null = null;
  previewUrl: string | null = null;
  isDefaultLogo = true;
  logoAltText = '';
  backgroundColorValue = '';
  isExporting = false;
  databaseExportProgress = 0;
  databaseExportStatus: DatabaseExportStatus | null = null;
  databaseExportError: string | null = null;
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
  private readonly exportBaseUrl = `${window.location.origin}/api/admin/database/export/sqlite`;

  constructor() {
    this.isDefaultLogo = this.appService.appLogo.data === standardLogo.data;
    this.logoAltText = this.appService.appLogo.alt;
    this.backgroundColorValue = this.appService.appLogo.bodyBackground || '';
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];

      if (!this.ALLOWED_MIME_TYPES.includes(this.selectedFile.type)) {
        this.snackBar.open('Bitte wählen Sie eine gültige Bilddatei aus (JPEG, PNG, GIF, SVG, WebP).', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      if (this.selectedFile.size > 4 * 1024 * 1024) {
        this.snackBar.open('Die Datei ist zu groß. Maximale Größe: 4MB', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      this.createImagePreview();
    }
  }

  private createImagePreview(): void {
    if (!this.selectedFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = reader.result as string;
    };
    reader.readAsDataURL(this.selectedFile);
  }

  resetFileInput(): void {
    this.selectedFile = null;
    this.previewUrl = null;
    const fileInput = document.getElementById('logo-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  uploadLogo(): void {
    if (!this.selectedFile || !this.previewUrl) return;

    this.logoService.uploadLogo(this.selectedFile).subscribe({
      next: response => {
        const newLogo: AppLogoDto = {
          data: response.path,
          alt: this.logoAltText,
          bodyBackground: this.backgroundColorValue,
          boxBackground: this.appService.appLogo.boxBackground
        };

        this.appService.appLogo = newLogo;
        this.isDefaultLogo = false;
        this.logoService.saveLogoSettings(newLogo).subscribe({
          next: settingsResponse => {
            if (settingsResponse.success) {
              this.snackBar.open('Logo erfolgreich aktualisiert', 'Schließen', { duration: 3000 });
            } else {
              this.snackBar.open('Logo aktualisiert, aber Fehler beim Speichern der Einstellungen', 'Schließen', { duration: 3000 });
            }
            this.resetFileInput();
          },
          error: () => {
            this.snackBar.open('Logo aktualisiert, aber Fehler beim Speichern der Einstellungen', 'Schließen', { duration: 3000 });
            this.resetFileInput();
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Hochladen des Logos', 'Schließen', { duration: 3000 });
      }
    });
  }

  resetToDefaultLogo(): void {
    this.logoService.deleteLogo().subscribe({
      next: response => {
        if (response.success) {
          this.appService.appLogo = standardLogo;
          this.isDefaultLogo = true;
          this.logoAltText = standardLogo.alt;
          this.backgroundColorValue = standardLogo.bodyBackground || '';
          this.snackBar.open('Standard-Logo wiederhergestellt', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Zurücksetzen des Logos', 'Schließen', { duration: 3000 });
        }
        this.resetFileInput();
      },
      error: () => {
        this.snackBar.open('Fehler beim Zurücksetzen des Logos', 'Schließen', { duration: 3000 });
      }
    });
  }

  saveAltText(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      alt: this.logoAltText
    };

    this.appService.appLogo = updatedLogo;

    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Alternativtext erfolgreich gespeichert', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Speichern des Alternativtexts', 'Schließen', { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Speichern des Alternativtexts', 'Schließen', { duration: 3000 });
      }
    });
  }

  saveBackgroundColor(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue
    };

    this.appService.appLogo = updatedLogo;
    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Hintergrundfarbe erfolgreich gespeichert', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Speichern der Hintergrundfarbe', 'Schließen', { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Speichern der Hintergrundfarbe', 'Schließen', { duration: 3000 });
      }
    });
  }

  resetToDefaultBackground(): void {
    this.backgroundColorValue = standardLogo.bodyBackground || '';
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue
    };
    this.appService.appLogo = updatedLogo;
    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Hintergrundfarbe auf Standard zurückgesetzt', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Zurücksetzen der Hintergrundfarbe', 'Schließen', { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open('Fehler beim Zurücksetzen der Hintergrundfarbe', 'Schließen', { duration: 3000 });
      }
    });
  }

  ngOnDestroy(): void {
    this.stopExportPolling();
  }

  getDatabaseExportStatusLabel(): string {
    switch (this.databaseExportStatus) {
      case 'queued':
        return 'In Warteschlange';
      case 'running':
        return 'Läuft';
      case 'completed':
        return 'Abgeschlossen';
      case 'failed':
        return 'Fehlgeschlagen';
      case 'cancelled':
        return 'Abgebrochen';
      default:
        return 'Unbekannt';
    }
  }

  exportDatabase(): void {
    if (this.isExporting) {
      return;
    }

    const authHeaders = this.getAuthHeaders();
    if (!authHeaders) {
      this.snackBar.open('Nicht authentifiziert. Bitte melden Sie sich erneut an.', 'Schließen', { duration: 5000 });
      return;
    }

    this.isExporting = true;
    this.databaseExportProgress = 0;
    this.databaseExportStatus = 'queued';
    this.databaseExportError = null;

    this.http
      .post<{ jobId: string; message: string }>(`${this.exportBaseUrl}/job`, {}, { headers: authHeaders })
      .subscribe({
        next: ({ jobId }) => {
          this.startExportPolling(jobId, authHeaders);
        },
        error: error => {
          this.isExporting = false;
          const message = this.extractErrorMessage(
            error,
            'Fehler beim Starten des Datenbank-Exports.'
          );
          this.databaseExportError = message;
          this.databaseExportStatus = 'failed';
          this.snackBar.open(message, 'Schließen', { duration: 5000 });
        }
      });
  }

  private startExportPolling(jobId: string, headers: HttpHeaders): void {
    this.stopExportPolling();

    this.exportPollingSubscription = timer(0, 2000)
      .pipe(
        switchMap(() => this.http.get<DatabaseExportJobState>(
          `${this.exportBaseUrl}/job/${jobId}`,
          { headers }
        ))
      )
      .subscribe({
        next: state => {
          this.databaseExportStatus = state.status;
          this.databaseExportProgress = Math.max(0, Math.min(100, Math.round(state.progress || 0)));

          if (state.status === 'completed') {
            this.databaseExportProgress = 100;
            this.stopExportPolling();
            this.downloadExportFile(jobId, headers);
            return;
          }

          if (state.status === 'failed' || state.status === 'cancelled') {
            this.stopExportPolling();
            this.isExporting = false;
            this.databaseExportError = state.error || 'Der Datenbank-Export ist fehlgeschlagen.';
            this.snackBar.open(this.databaseExportError, 'Schließen', { duration: 5000 });
          }
        },
        error: error => {
          this.stopExportPolling();
          this.isExporting = false;
          const message = this.extractErrorMessage(
            error,
            'Fehler beim Abrufen des Export-Status.'
          );
          this.databaseExportStatus = 'failed';
          this.databaseExportError = message;
          this.snackBar.open(message, 'Schließen', { duration: 5000 });
        }
      });
  }

  private downloadExportFile(jobId: string, headers: HttpHeaders): void {
    this.http
      .get(`${this.exportBaseUrl}/job/${jobId}/download`, {
        headers,
        responseType: 'blob'
      })
      .subscribe({
        next: blob => {
          this.saveBlob(
            blob,
            `database-export-${new Date().toISOString().split('T')[0]}.sqlite`
          );
          this.isExporting = false;
          this.databaseExportStatus = 'completed';
          this.databaseExportError = null;
          this.snackBar.open('Datenbank erfolgreich exportiert', 'Schließen', { duration: 3000 });
        },
        error: error => {
          this.isExporting = false;
          this.databaseExportStatus = 'failed';
          this.databaseExportError = this.extractErrorMessage(
            error,
            'Fehler beim Herunterladen der Exportdatei.'
          );
          this.snackBar.open(this.databaseExportError, 'Schließen', { duration: 5000 });
        }
      });
  }

  private stopExportPolling(): void {
    if (this.exportPollingSubscription) {
      this.exportPollingSubscription.unsubscribe();
      this.exportPollingSubscription = null;
    }
  }

  private getAuthHeaders(): HttpHeaders | null {
    const token = localStorage.getItem('id_token');
    if (!token) {
      return null;
    }

    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    const payload = error as {
      error?: {
        message?: string | string[];
      };
      message?: string;
    };

    if (Array.isArray(payload?.error?.message)) {
      return payload.error.message.join(', ');
    }

    if (typeof payload?.error?.message === 'string') {
      return payload.error.message;
    }

    if (typeof payload?.message === 'string') {
      return payload.message;
    }

    return fallback;
  }
}
