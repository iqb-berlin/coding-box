import {
  MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import {
  Component, OnInit, SecurityContext, inject
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButton } from '@angular/material/button';
import { catchError, of } from 'rxjs';
import { defaultLegalNoticeHtml } from '../../../../../../api-dto/legal-notice/default-legal-notice-html';
import { SystemSettingsService } from '../../core/services/system-settings.service';

@Component({
  template: `
    <h1 mat-dialog-title>IQB-Kodierbox - Impressum/Datenschutz</h1>
    <mat-dialog-content>
      <div class="legal-notice-content" [innerHTML]="legalNoticeHtml"></div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" [mat-dialog-close]="true">Schließen</button>
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
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatDialogClose]
})
export class ImpressumDialogComponent implements OnInit {
  private readonly systemSettingsService = inject(SystemSettingsService);

  private readonly sanitizer = inject(DomSanitizer);

  legalNoticeHtml = this.sanitizeHtml(defaultLegalNoticeHtml);

  ngOnInit(): void {
    this.systemSettingsService.getLegalNotice()
      .pipe(catchError(() => of({ html: defaultLegalNoticeHtml, isDefault: true })))
      .subscribe(legalNotice => {
        this.legalNoticeHtml = this.sanitizeHtml(legalNotice.html);
      });
  }

  private sanitizeHtml(html: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
  }
}
