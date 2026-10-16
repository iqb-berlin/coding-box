import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  Component, OnDestroy, OnInit, SecurityContext, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AppService, standardLogo } from '../../../core/services/app.service';
import { LogoService } from '../../../core/services/logo.service';
import { SystemSettingsService } from '../../../core/services/system-settings.service';
import { ContentPoolSettings } from '../../../ws-admin/models/content-pool.model';
import { AppLogoDto } from '../../../../../../../api-dto/app-logo-dto';
import { defaultLegalNoticeHtml } from '../../../../../../../api-dto/legal-notice/default-legal-notice-html';
import { SERVER_URL } from '../../../injection-tokens';

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
    fileName: string;
    fileSize: number;
    createdAt: number;
    requestedByUserId: number;
  };
  error?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
export class SysAdminSettingsComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  protected appService = inject(AppService);
  private http = inject(HttpClient);
  private logoService = inject(LogoService);
  private systemSettingsService = inject(SystemSettingsService);
  private snackBar = inject(MatSnackBar);
  private rawServerUrl = inject(SERVER_URL);
  private sanitizer = inject(DomSanitizer);

  private exportPollingSubscription: Subscription | null = null;

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly isDefaultLogo = signal(true);
  protected readonly logoAltText = signal('');
  protected readonly backgroundColorValue = signal('');
  readonly isExporting = signal(false);
  protected readonly databaseExportProgress = signal(0);
  readonly databaseExportStatus = signal<DatabaseExportStatus | null>(null);
  readonly databaseExportError = signal<string | null>(null);
  protected readonly isLoadingLegalNotice = signal(false);
  protected readonly isSavingLegalNotice = signal(false);
  readonly isLegalNoticeDefault = signal(true);
  readonly legalNoticeHtml = signal(defaultLegalNoticeHtml);
  protected readonly legalNoticePreviewHtml = signal(this.sanitizeHtml(defaultLegalNoticeHtml));
  protected readonly isLoadingContentPoolSettings = signal(false);
  protected readonly isSavingContentPoolSettings = signal(false);
  readonly isTestingContentPoolConnection = signal(false);
  readonly contentPoolSettings = signal<ContentPoolSettings>({
    enabled: false,
    baseUrl: '',
    hasApplicationToken: false
  });

  readonly contentPoolApplicationToken = signal('');
  protected readonly clearContentPoolApplicationToken = signal(false);

  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
  constructor() {
    this.isDefaultLogo.set(this.appService.appLogo.data === standardLogo.data);
    this.logoAltText.set(this.appService.appLogo.alt);
    this.backgroundColorValue.set(this.appService.appLogo.bodyBackground || '');
  }

  ngOnInit(): void {
    this.loadLegalNotice();
    this.loadContentPoolSettings();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const selectedFile = input.files[0];
      this.selectedFile.set(selectedFile);

      if (!this.ALLOWED_MIME_TYPES.includes(selectedFile.type)) {
        this.snackBar.open('Bitte wählen Sie eine gültige Bilddatei aus (JPEG, PNG, GIF, SVG, WebP).', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      if (selectedFile.size > 4 * 1024 * 1024) {
        this.snackBar.open('Die Datei ist zu groß. Maximale Größe: 4MB', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      this.createImagePreview();
    }
  }

  private createImagePreview(): void {
    const selectedFileSnapshot = this.selectedFile();

    if (!selectedFileSnapshot) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl.set(reader.result as string);
    };
    reader.readAsDataURL(selectedFileSnapshot);
  }

  protected resetFileInput(): void {
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    const fileInput = document.getElementById('logo-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  protected uploadLogo(): void {
    const selectedFileSnapshot = this.selectedFile();

    if (!selectedFileSnapshot || !this.previewUrl()) return;

    this.logoService.uploadLogo(selectedFileSnapshot).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        const newLogo: AppLogoDto = {
          data: response.path,
          alt: this.logoAltText(),
          bodyBackground: this.backgroundColorValue(),
          boxBackground: this.appService.appLogo.boxBackground
        };

        this.appService.appLogo = newLogo;
        this.isDefaultLogo.set(false);
        this.logoService.saveLogoSettings(newLogo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  protected resetToDefaultLogo(): void {
    this.logoService.deleteLogo().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (response.success) {
          this.appService.appLogo = standardLogo;
          this.isDefaultLogo.set(true);
          this.logoAltText.set(standardLogo.alt);
          this.backgroundColorValue.set(standardLogo.bodyBackground || '');
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

  protected saveAltText(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      alt: this.logoAltText()
    };

    this.appService.appLogo = updatedLogo;

    this.logoService.saveLogoSettings(updatedLogo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  protected saveBackgroundColor(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue()
    };

    this.appService.appLogo = updatedLogo;
    this.logoService.saveLogoSettings(updatedLogo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  protected resetToDefaultBackground(): void {
    this.backgroundColorValue.set(standardLogo.bodyBackground || '');
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue()
    };
    this.appService.appLogo = updatedLogo;
    this.logoService.saveLogoSettings(updatedLogo).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  loadLegalNotice(): void {
    this.isLoadingLegalNotice.set(true);
    this.systemSettingsService.getLegalNotice().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: legalNotice => {
        this.legalNoticeHtml.set(legalNotice.html || defaultLegalNoticeHtml);
        this.isLegalNoticeDefault.set(legalNotice.isDefault);
        this.updateLegalNoticePreview();
        this.isLoadingLegalNotice.set(false);
      },
      error: () => {
        this.legalNoticeHtml.set(defaultLegalNoticeHtml);
        this.isLegalNoticeDefault.set(true);
        this.updateLegalNoticePreview();
        this.isLoadingLegalNotice.set(false);
        this.snackBar.open(
          'Impressum/Datenschutz-Text konnte nicht geladen werden.',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  saveLegalNotice(): void {
    const html = (this.legalNoticeHtml() || '').trim();
    if (!html) {
      this.snackBar.open(
        'Bitte einen Impressum/Datenschutz-Text hinterlegen.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }

    this.isSavingLegalNotice.set(true);
    this.systemSettingsService.updateLegalNotice({ html }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: legalNotice => {
        this.legalNoticeHtml.set(legalNotice.html);
        this.isLegalNoticeDefault.set(legalNotice.isDefault);
        this.updateLegalNoticePreview();
        this.isSavingLegalNotice.set(false);
        this.snackBar.open(
          'Impressum/Datenschutz-Text wurde gespeichert.',
          'Schließen',
          { duration: 3000 }
        );
      },
      error: error => {
        this.isSavingLegalNotice.set(false);
        const message = this.extractErrorMessage(
          error,
          'Impressum/Datenschutz-Text konnte nicht gespeichert werden.'
        );
        this.snackBar.open(message, 'Schließen', { duration: 4000 });
      }
    });
  }

  resetLegalNoticeToDefault(): void {
    this.isSavingLegalNotice.set(true);
    this.systemSettingsService.resetLegalNotice().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: legalNotice => {
        this.legalNoticeHtml.set(legalNotice.html);
        this.isLegalNoticeDefault.set(legalNotice.isDefault);
        this.updateLegalNoticePreview();
        this.isSavingLegalNotice.set(false);
        this.snackBar.open(
          'Impressum/Datenschutz-Text wurde auf den Standard zurückgesetzt.',
          'Schließen',
          { duration: 3000 }
        );
      },
      error: error => {
        this.isSavingLegalNotice.set(false);
        const message = this.extractErrorMessage(
          error,
          'Impressum/Datenschutz-Text konnte nicht zurückgesetzt werden.'
        );
        this.snackBar.open(message, 'Schließen', { duration: 4000 });
      }
    });
  }

  protected updateLegalNoticePreview(): void {
    this.legalNoticePreviewHtml.set(this.sanitizeHtml(this.legalNoticeHtml()));
  }

  ngOnDestroy(): void {
    this.stopExportPolling();
  }

  protected getDatabaseExportStatusLabel(): string {
    switch (this.databaseExportStatus()) {
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

  loadContentPoolSettings(): void {
    this.isLoadingContentPoolSettings.set(true);
    this.systemSettingsService.getContentPoolSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: settings => {
        this.contentPoolSettings.set({
          enabled: !!settings.enabled,
          baseUrl: (settings.baseUrl || '').trim(),
          hasApplicationToken: !!settings.hasApplicationToken
        });
        this.contentPoolApplicationToken.set('');
        this.clearContentPoolApplicationToken.set(false);
        this.isLoadingContentPoolSettings.set(false);
      },
      error: () => {
        this.isLoadingContentPoolSettings.set(false);
        this.snackBar.open(
          'Content-Pool-Einstellungen konnten nicht geladen werden.',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  protected saveContentPoolSettings(): void {
    const normalizedBaseUrl = (this.contentPoolSettings().baseUrl || '').trim();
    const applicationToken = this.contentPoolApplicationToken().trim();
    if (this.contentPoolSettings().enabled && !normalizedBaseUrl) {
      this.snackBar.open(
        'Bitte eine Content-Pool URL hinterlegen, bevor das Feature aktiviert wird.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }
    if (
      this.contentPoolSettings().enabled &&
      !applicationToken &&
      (!this.contentPoolSettings().hasApplicationToken || this.clearContentPoolApplicationToken())
    ) {
      this.snackBar.open(
        'Bitte ein Content-Pool Application-Token hinterlegen, bevor das Feature aktiviert wird.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }

    this.isSavingContentPoolSettings.set(true);
    this.systemSettingsService
      .updateContentPoolSettings({
        enabled: this.contentPoolSettings().enabled,
        baseUrl: normalizedBaseUrl,
        applicationToken: applicationToken || undefined,
        clearApplicationToken: this.clearContentPoolApplicationToken() && !applicationToken
      }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: settings => {
          this.contentPoolSettings.set({
            enabled: !!settings.enabled,
            baseUrl: (settings.baseUrl || '').trim(),
            hasApplicationToken: !!settings.hasApplicationToken
          });
          this.contentPoolApplicationToken.set('');
          this.clearContentPoolApplicationToken.set(false);
          this.isSavingContentPoolSettings.set(false);
          this.snackBar.open(
            'Content-Pool-Einstellungen wurden gespeichert.',
            'Schließen',
            { duration: 3000 }
          );
        },
        error: error => {
          this.isSavingContentPoolSettings.set(false);
          const message = this.extractErrorMessage(
            error,
            'Content-Pool-Einstellungen konnten nicht gespeichert werden.'
          );
          this.snackBar.open(message, 'Schließen', { duration: 4000 });
        }
      });
  }

  protected clearStoredContentPoolToken(): void {
    this.contentPoolApplicationToken.set('');
    this.clearContentPoolApplicationToken.set(true);
  }

  protected onContentPoolTokenInputChange(value: string): void {
    if ((value || '').trim()) {
      this.clearContentPoolApplicationToken.set(false);
    }
  }

  testContentPoolConnection(): void {
    const normalizedBaseUrl = (this.contentPoolSettings().baseUrl || '').trim();
    const applicationToken = this.contentPoolApplicationToken().trim();
    if (!normalizedBaseUrl) {
      this.snackBar.open(
        'Bitte eine Content-Pool URL für den Verbindungstest hinterlegen.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }

    if (
      !applicationToken &&
      (!this.contentPoolSettings().hasApplicationToken || this.clearContentPoolApplicationToken())
    ) {
      this.snackBar.open(
        'Bitte ein Content-Pool Application-Token für den Verbindungstest hinterlegen.',
        'Schließen',
        { duration: 4000 }
      );
      return;
    }

    this.isTestingContentPoolConnection.set(true);
    this.systemSettingsService
      .testContentPoolConnection({
        baseUrl: normalizedBaseUrl,
        applicationToken: applicationToken || undefined,
        clearApplicationToken: this.clearContentPoolApplicationToken() && !applicationToken
      }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.isTestingContentPoolConnection.set(false);
          this.snackBar.open(
            result.message ||
              `Verbindung erfolgreich. ${result.acpCount} ACPs erreichbar.`,
            'Schließen',
            { duration: 4000 }
          );
        },
        error: error => {
          this.isTestingContentPoolConnection.set(false);
          const message = this.extractErrorMessage(
            error,
            'Content-Pool-Verbindung konnte nicht getestet werden. Token und Scopes prüfen.'
          );
          this.snackBar.open(message, 'Schließen', { duration: 6000 });
        }
      });
  }

  exportDatabase(): void {
    if (this.isExporting()) {
      return;
    }

    const authHeaders = this.getAuthHeaders();
    this.isExporting.set(true);
    this.databaseExportProgress.set(0);
    this.databaseExportStatus.set('queued');
    this.databaseExportError.set(null);

    this.http
      .post<{ jobId: string; message: string }>(`${this.exportBaseUrl}/job`, {}, { headers: authHeaders }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ jobId }) => {
          this.startExportPolling(jobId, authHeaders);
        },
        error: error => {
          this.isExporting.set(false);
          const message = this.extractErrorMessage(
            error,
            'Fehler beim Starten des Datenbank-Exports.'
          );
          this.databaseExportError.set(message);
          this.databaseExportStatus.set('failed');
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
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: state => {
          this.databaseExportStatus.set(state.status);
          this.databaseExportProgress.set(Math.max(0, Math.min(100, Math.round(state.progress || 0))));

          if (state.status === 'completed') {
            this.databaseExportProgress.set(100);
            this.stopExportPolling();
            this.downloadExportFile(jobId, headers);
            return;
          }

          if (state.status === 'failed' || state.status === 'cancelled') {
            this.stopExportPolling();
            this.isExporting.set(false);
            this.databaseExportError.set(state.error ||
    'Der Datenbank-Export ist fehlgeschlagen. Sie können den Export erneut starten.');
            this.snackBar.open(this.databaseExportError() ?? '', 'Schließen', { duration: 5000 });
          }
        },
        error: error => {
          this.stopExportPolling();
          this.isExporting.set(false);
          const message = this.extractErrorMessage(
            error,
            'Fehler beim Abrufen des Export-Status.'
          );
          this.databaseExportStatus.set('failed');
          this.databaseExportError.set(message);
          this.snackBar.open(message, 'Schließen', { duration: 5000 });
        }
      });
  }

  private downloadExportFile(jobId: string, headers: HttpHeaders): void {
    this.http
      .get(`${this.exportBaseUrl}/job/${jobId}/download`, {
        headers,
        responseType: 'blob'
      }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          this.saveBlob(
            blob,
            `database-export-${new Date().toISOString().split('T')[0]}.sqlite`
          );
          this.isExporting.set(false);
          this.databaseExportStatus.set('completed');
          this.databaseExportError.set(null);
          this.snackBar.open('Datenbank erfolgreich exportiert', 'Schließen', { duration: 3000 });
        },
        error: error => {
          this.isExporting.set(false);
          this.databaseExportStatus.set('failed');
          this.databaseExportError.set(this.extractErrorMessage(error, 'Fehler beim Herunterladen der Exportdatei.'));
          this.snackBar.open(this.databaseExportError() ?? '', 'Schließen', { duration: 5000 });
        }
      });
  }

  private stopExportPolling(): void {
    if (this.exportPollingSubscription) {
      this.exportPollingSubscription.unsubscribe();
      this.exportPollingSubscription = null;
    }
  }

  private getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({
      Accept: 'application/json'
    });
  }

  private get exportBaseUrl(): string {
    return `${this.serverUrl}/admin/database/export/sqlite`;
  }

  private get serverUrl(): string {
    return this.rawServerUrl.endsWith('/') ?
      this.rawServerUrl.slice(0, -1) :
      this.rawServerUrl;
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

  private sanitizeHtml(html: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
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

  protected setContentPoolSettingsField<K extends keyof ContentPoolSettings>(key: K, value: ContentPoolSettings[K]): void {
    this.contentPoolSettings.update(current => (current ? { ...current, [key]: value } : current));
  }
}
