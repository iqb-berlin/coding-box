import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';

export type ExportFormat = 'aggregated' | 'by-coder' | 'by-variable' | 'detailed' | 'coding-times';

@Component({
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    FormsModule,
    CommonModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  selectedFormat: ExportFormat = 'aggregated';
  isStartingExport = false;
  includeModalValue = false;
  includeDoubleCoded = false;
  includeComments = false;
  includeReplayUrl = false;
  outputCommentsInsteadOfCodes = false;
  anonymizeCoders = false;
  usePseudoCoders = false;
  doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent';
  excludeAutoCoded = true;

  exportFormats = [
    {
      value: 'aggregated' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.aggregated'),
      description: this.translateService.instant('ws-admin.export-formats.aggregated-description')
    },
    {
      value: 'by-coder' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-coder'),
      description: this.translateService.instant('ws-admin.export-formats.by-coder-description')
    },
    {
      value: 'by-variable' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-variable'),
      description: this.translateService.instant('ws-admin.export-formats.by-variable-description')
    },
    {
      value: 'detailed' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.detailed'),
      description: this.translateService.instant('ws-admin.export-formats.detailed-description')
    },
    {
      value: 'coding-times' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.coding-times'),
      description: this.translateService.instant('ws-admin.export-formats.coding-times-description')
    }
  ];

  onFormatChange(): void {
    this.clearReplayUrlIfNeeded();
  }

  onDoubleCodingMethodChange(): void {
    this.clearReplayUrlIfNeeded();
  }

  private clearReplayUrlIfNeeded(): void {
    if (this.selectedFormat === 'coding-times' ||
        (this.selectedFormat === 'aggregated' && this.doubleCodingMethod === 'new-column-per-coder')) {
      this.includeReplayUrl = false;
    }
  }

  onExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translateService.instant('ws-admin.export.errors.no-workspace'),
        this.translateService.instant('close'),
        { duration: 5000 }
      );
      return;
    }

    this.isStartingExport = true;

    const loggedUser = this.appService.loggedUser;
    const tokenObservable = this.includeReplayUrl && loggedUser?.sub ?
      this.appService.createToken(workspaceId, loggedUser.sub, 60).pipe(catchError(() => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.token-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isStartingExport = false;
        throw new Error('Token generation failed');
      })) :
      new Observable<string>(subscriber => {
        subscriber.next('');
        subscriber.complete();
      });

    tokenObservable.subscribe(authToken => {
      // Prepare export configuration
      const exportConfig = {
        exportType: this.selectedFormat,
        userId: this.appService.userId,
        outputCommentsInsteadOfCodes: this.outputCommentsInsteadOfCodes,
        includeReplayUrl: this.includeReplayUrl,
        anonymizeCoders: this.anonymizeCoders,
        usePseudoCoders: this.usePseudoCoders,
        doubleCodingMethod: this.doubleCodingMethod,
        includeComments: this.includeComments,
        includeModalValue: this.includeModalValue,
        includeDoubleCoded: this.includeDoubleCoded,
        excludeAutoCoded: this.excludeAutoCoded,
        authToken
      };

      this.exportJobService.startJob(workspaceId, exportConfig);

      this.snackBar.open(
        this.translateService.instant('ws-admin.export.job-started'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );

      this.isStartingExport = false;
    });
  }
}
