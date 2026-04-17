import { Component, OnInit, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AppService, standardLogo } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { ContentPoolSettings } from '../../../ws-admin/models/content-pool.model';
import { AppLogoDto } from '../../../../../../../api-dto/app-logo-dto';

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
    MatProgressBarModule,
    MatSlideToggleModule
  ]
})
export class SysAdminSettingsComponent implements OnInit {
  appService = inject(AppService);
  private logoService = inject(LogoService);
  private systemSettingsService = inject(SystemSettingsService);
  private snackBar = inject(MatSnackBar);

  selectedFile: File | null = null;
  previewUrl: string | null = null;
  isDefaultLogo = true;
  logoAltText = '';
  backgroundColorValue = '';
  isExporting = false;
  isLoadingContentPoolSettings = false;
  isSavingContentPoolSettings = false;
  contentPoolSettings: ContentPoolSettings = {
    enabled: false,
    baseUrl: ''
  };
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];

  constructor() {
    this.isDefaultLogo = this.appService.appLogo.data === standardLogo.data;
    this.logoAltText = this.appService.appLogo.alt;
    this.backgroundColorValue = this.appService.appLogo.bodyBackground || '';
  }

  ngOnInit(): void {
    this.loadContentPoolSettings();
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

  loadContentPoolSettings(): void {
    this.isLoadingContentPoolSettings = true;
    this.systemSettingsService.getContentPoolSettings().subscribe({
      next: settings => {
        this.contentPoolSettings = {
          enabled: !!settings.enabled,
          baseUrl: (settings.baseUrl || '').trim()
        };
        this.isLoadingContentPoolSettings = false;
      },
      error: () => {
        this.isLoadingContentPoolSettings = false;
        this.snackBar.open(
          'Content-Pool-Einstellungen konnten nicht geladen werden.',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  saveContentPoolSettings(): void {
    const normalizedBaseUrl = (this.contentPoolSettings.baseUrl || '').trim();
    if (this.contentPoolSettings.enabled && !normalizedBaseUrl) {
      this.snackBar.open(
        'Bitte eine Content-Pool URL hinterlegen, bevor das Feature aktiviert wird.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }

    this.isSavingContentPoolSettings = true;
    this.systemSettingsService
      .updateContentPoolSettings({
        enabled: this.contentPoolSettings.enabled,
        baseUrl: normalizedBaseUrl
      })
      .subscribe({
        next: settings => {
          this.contentPoolSettings = {
            enabled: !!settings.enabled,
            baseUrl: (settings.baseUrl || '').trim()
          };
          this.isSavingContentPoolSettings = false;
          this.snackBar.open(
            'Content-Pool-Einstellungen wurden gespeichert.',
            'Schließen',
            { duration: 3000 }
          );
        },
        error: error => {
          this.isSavingContentPoolSettings = false;
          const message = this.extractErrorMessage(
            error,
            'Content-Pool-Einstellungen konnten nicht gespeichert werden.'
          );
          this.snackBar.open(message, 'Schließen', { duration: 4000 });
        }
      });
  }

  exportDatabase(): void {
    if (this.isExporting) {
      return;
    }

    this.isExporting = true;
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    const apiUrl = `${window.location.origin}/api/admin/database/export/sqlite`;
    const token = localStorage.getItem('id_token');

    if (!token) {
      this.snackBar.open('Nicht authentifiziert. Bitte melden Sie sich erneut an.', 'Schließen', { duration: 5000 });
      this.isExporting = false;
      return;
    }

    fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/x-sqlite3'
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        anchor.href = url;
        anchor.download = `database-export-${new Date().toISOString().split('T')[0]}.sqlite`;
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);

        this.snackBar.open('Datenbank erfolgreich exportiert', 'Schließen', { duration: 3000 });
      })
      .catch(() => {
        this.snackBar.open('Fehler beim Exportieren der Datenbank. Bitte versuchen Sie es erneut.', 'Schließen', { duration: 5000 });
        if (document.body.contains(anchor)) {
          document.body.removeChild(anchor);
        }
      })
      .finally(() => {
        this.isExporting = false;
      });
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
