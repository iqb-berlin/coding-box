import { TranslateModule } from '@ngx-translate/core';
import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import {
  Component, OnInit, SecurityContext, inject, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButton } from '@angular/material/button';
import { catchError, of } from 'rxjs';
import { defaultLegalNoticeHtml } from '../../../../../../api-dto/legal-notice/default-legal-notice-html';
import { SystemSettingsService } from '../../core/services/system-settings.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 mat-dialog-title>@switch (section) {
      @case ('privacy') { {{ 'ui-text.app-info.privacy' | translate }} }
      @case ('imprint') { {{ 'ui-text.app-info.imprint' | translate }} }
      @default { {{ 'ui-text.impressum-dialog.title' | translate }} }
    }</h1>
    <mat-dialog-content>
      @if (loadFailed()) {
        <p role="status">{{ 'ui-text.impressum-dialog.unavailable' | translate }}</p>
      } @else if (section === 'privacy' && isDefault()) {
        <p role="status">{{ 'ui-text.impressum-dialog.no-instance-policy' | translate }}</p>
      }
      @if (legalNoticeHtml() === null) {
        <p role="status">{{ 'deferred-view.loading' | translate }}</p>
      } @else {
        <div class="legal-notice-content" [innerHTML]="legalNoticeHtml()"></div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" [mat-dialog-close]="true">{{ 'deferred-view.close' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      max-height: 70vh;
      padding: 20px;
      line-height: 1.5;
    }
    h1 {
      color: #07465e;
      font-size: 20px;
      margin-bottom: 15px;
    }
    :host ::ng-deep .legal-notice-content h2 {
      color: #07465e;
      font-size: 16px;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    :host ::ng-deep .legal-notice-content p {
      margin-bottom: 15px;
    }
  `],
  standalone: true,
  imports: [TranslateModule, MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatDialogClose]
})
export class ImpressumDialogComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  private readonly systemSettingsService = inject(SystemSettingsService);

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly section = inject<{ section?: 'privacy' | 'imprint' }>(MAT_DIALOG_DATA, { optional: true })?.section;
  protected readonly isDefault = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly legalNoticeHtml = signal<string | null>(null);

  ngOnInit(): void {
    this.systemSettingsService.getLegalNotice()
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return of({ html: defaultLegalNoticeHtml, isDefault: true });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(legalNotice => {
        this.isDefault.set(legalNotice.isDefault);
        this.legalNoticeHtml.set(this.sanitizeHtml(legalNotice.html));
      });
  }

  private sanitizeHtml(html: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
  }
}
