import {
  Component, OnDestroy, OnInit, SecurityContext, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
import { ContentPoolSettings } from '../../../shared/models/content-pool.model';
import { AppLogoDto } from '../../../../../../../api-dto/app-logo-dto';
import { defaultLegalNoticeHtml } from '../../../../../../../api-dto/legal-notice/default-legal-notice-html';
import { DatabaseExportService } from '../../../shared/services/database-export.service';
import { extractHttpErrorMessage } from '../../../shared/utils/http-error-message.util';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-sys-admin-settings',
  templateUrl: './sys-admin-settings.component.html',
  styleUrls: ['./sys-admin-settings.component.scss'],
  standalone: true,
  providers: [DatabaseExportService],
  imports: [
    TranslateModule,
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
  private readonly databaseExport = inject(DatabaseExportService);
  private readonly translateService = inject(TranslateService);
  private logoService = inject(LogoService);
  private systemSettingsService = inject(SystemSettingsService);
  private snackBar = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly isDefaultLogo = signal(true);
  protected readonly logoAltText = signal('');
  protected readonly backgroundColorValue = signal('');
  readonly isExporting = this.databaseExport.isExporting;
  protected readonly databaseExportProgress = this.databaseExport.progress;
  readonly databaseExportStatus = this.databaseExport.status;
  readonly databaseExportError = this.databaseExport.error;
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
        this.snackBar.open(this.translateService.instant('sys-admin-settings.invalid-image'), this.translateService.instant('close'), { duration: 3000 });
        this.resetFileInput();
        return;
      }

      if (selectedFile.size > 4 * 1024 * 1024) {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.image-too-large'), this.translateService.instant('close'), { duration: 3000 });
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
              this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-updated'), this.translateService.instant('close'), { duration: 3000 });
            } else {
              this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-settings-error'), this.translateService.instant('close'), { duration: 3000 });
            }
            this.resetFileInput();
          },
          error: () => {
            this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-settings-error'), this.translateService.instant('close'), { duration: 3000 });
            this.resetFileInput();
          }
        });
      },
      error: () => {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-upload-error'), this.translateService.instant('close'), { duration: 3000 });
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
          this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-restored'), this.translateService.instant('close'), { duration: 3000 });
        } else {
          this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-reset-error'), this.translateService.instant('close'), { duration: 3000 });
        }
        this.resetFileInput();
      },
      error: () => {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.logo-reset-error'), this.translateService.instant('close'), { duration: 3000 });
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
          this.snackBar.open(this.translateService.instant('sys-admin-settings.alt-text-saved'), this.translateService.instant('close'), { duration: 3000 });
        } else {
          this.snackBar.open(this.translateService.instant('sys-admin-settings.alt-text-save-error'), this.translateService.instant('close'), { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.alt-text-save-error'), this.translateService.instant('close'), { duration: 3000 });
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
          this.snackBar.open(this.translateService.instant('sys-admin-settings.background-saved'), this.translateService.instant('close'), { duration: 3000 });
        } else {
          this.snackBar.open(this.translateService.instant('sys-admin-settings.background-save-error'), this.translateService.instant('close'), { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.background-save-error'), this.translateService.instant('close'), { duration: 3000 });
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
          this.snackBar.open(this.translateService.instant('sys-admin-settings.background-restored'), this.translateService.instant('close'), { duration: 3000 });
        } else {
          this.snackBar.open(this.translateService.instant('sys-admin-settings.background-reset-error'), this.translateService.instant('close'), { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open(this.translateService.instant('sys-admin-settings.background-reset-error'), this.translateService.instant('close'), { duration: 3000 });
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
          this.translateService.instant('sys-admin-settings.legal-notice-load-error'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
      }
    });
  }

  saveLegalNotice(): void {
    const html = (this.legalNoticeHtml() || '').trim();
    if (!html) {
      this.snackBar.open(
        this.translateService.instant('sys-admin-settings.legal-notice-required'),
        this.translateService.instant('close'),
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
          this.translateService.instant('sys-admin-settings.legal-notice-saved'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
      },
      error: error => {
        this.isSavingLegalNotice.set(false);
        const message = extractHttpErrorMessage(
          error,
          this.translateService.instant('sys-admin-settings.legal-notice-save-error')
        );
        this.snackBar.open(message, this.translateService.instant('close'), { duration: 4000 });
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
          this.translateService.instant('sys-admin-settings.legal-notice-restored'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
      },
      error: error => {
        this.isSavingLegalNotice.set(false);
        const message = extractHttpErrorMessage(
          error,
          this.translateService.instant('sys-admin-settings.legal-notice-reset-error')
        );
        this.snackBar.open(message, this.translateService.instant('close'), { duration: 4000 });
      }
    });
  }

  protected updateLegalNoticePreview(): void {
    this.legalNoticePreviewHtml.set(this.sanitizeHtml(this.legalNoticeHtml()));
  }

  ngOnDestroy(): void {
    this.databaseExport.cancel();
  }

  protected getDatabaseExportStatusLabel(): string {
    return this.databaseExport.getStatusLabel();
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
          this.translateService.instant('sys-admin-settings.content-pool-load-error'),
          this.translateService.instant('close'),
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
        this.translateService.instant('sys-admin-settings.content-pool-url-required'),
        this.translateService.instant('close'),
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
        this.translateService.instant('sys-admin-settings.content-pool-token-required'),
        this.translateService.instant('close'),
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
            this.translateService.instant('sys-admin-settings.content-pool-saved'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        },
        error: error => {
          this.isSavingContentPoolSettings.set(false);
          const message = extractHttpErrorMessage(
            error,
            this.translateService.instant('sys-admin-settings.content-pool-save-error')
          );
          this.snackBar.open(message, this.translateService.instant('close'), { duration: 4000 });
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
        this.translateService.instant('sys-admin-settings.content-pool-test-url-required'),
        this.translateService.instant('close'),
        { duration: 4000 }
      );
      return;
    }

    if (
      !applicationToken &&
      (!this.contentPoolSettings().hasApplicationToken || this.clearContentPoolApplicationToken())
    ) {
      this.snackBar.open(
        this.translateService.instant('sys-admin-settings.content-pool-test-token-required'),
        this.translateService.instant('close'),
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
              this.translateService.instant('sys-admin-settings.content-pool-test-success', { count: result.acpCount }),
            this.translateService.instant('close'),
            { duration: 4000 }
          );
        },
        error: error => {
          this.isTestingContentPoolConnection.set(false);
          const message = extractHttpErrorMessage(
            error,
            this.translateService.instant('sys-admin-settings.content-pool-test-error')
          );
          this.snackBar.open(message, this.translateService.instant('close'), { duration: 6000 });
        }
      });
  }

  exportDatabase(): void {
    this.databaseExport.start({ kind: 'system' });
  }

  private sanitizeHtml(html: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
  }

  protected setContentPoolSettingsField<K extends keyof ContentPoolSettings>(key: K, value: ContentPoolSettings[K]): void {
    this.contentPoolSettings.update(current => (current ? { ...current, [key]: value } : current));
  }
}
