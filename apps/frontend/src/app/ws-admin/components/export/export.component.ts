import { Component, inject, OnDestroy } from '@angular/core';
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
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

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
export class ExportComponent implements OnDestroy {
  private appService = inject(AppService);
  private backendService = inject(BackendService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  selectedFormat: ExportFormat = 'aggregated';
  isExporting = false;
  exportProgress = 0;
  exportJobId: string | null = null;
  includeModalValue = false;
  includeDoubleCoded = false;
  includeComments = false;
  includeReplayUrl = false;
  outputCommentsInsteadOfCodes = false;
  anonymizeCoders = false;
  usePseudoCoders = false;
  doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent';
  excludeAutoCoded = true;
  private pollInterval: any = null;

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

    this.isExporting = true;

    const loggedUser = this.appService.loggedUser;
    const tokenObservable = this.includeReplayUrl && loggedUser?.sub ?
      this.appService.createToken(workspaceId, loggedUser.sub, 60).pipe(catchError(() => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.token-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isExporting = false;
        throw new Error('Token generation failed');
      })) :
      new Observable<string>(subscriber => {
        subscriber.next('');
        subscriber.complete();
      });

    tokenObservable.subscribe(authToken => {
      const userId = loggedUser?.id || 0;

      // Prepare export configuration
      const exportConfig = {
        exportType: this.selectedFormat,
        userId,
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

      // Start the background export job
      this.backendService.startExportJob(workspaceId, exportConfig).subscribe({
        next: (response) => {
          this.exportJobId = response.jobId;
          this.exportProgress = 0;
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.job-started'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );

          // Start polling for job status
          this.startPolling(workspaceId, response.jobId);
        },
        error: (error) => {
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.errors.job-start-failed'),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          this.isExporting = false;
        }
      });
    });
  }

  private startPolling(workspaceId: number, jobId: string): void {
    this.pollInterval = setInterval(() => {
      this.backendService.getExportJobStatus(workspaceId, jobId).subscribe({
        next: (status) => {
          this.exportProgress = status.progress || 0;

          if (status.status === 'completed') {
            this.stopPolling();
            this.isExporting = false;
            this.exportJobId = null;
            
            // Trigger download
            this.downloadExport(workspaceId, jobId);
          } else if (status.status === 'failed') {
            this.stopPolling();
            this.isExporting = false;
            this.exportJobId = null;
            
            this.snackBar.open(
              this.translateService.instant('ws-admin.export.errors.export-failed') + (status.error ? `: ${status.error}` : ''),
              this.translateService.instant('close'),
              { duration: 5000 }
            );
          }
        },
        error: () => {
          this.stopPolling();
          this.isExporting = false;
          this.exportJobId = null;
          
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.errors.status-check-failed'),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      });
    }, 2000); // Poll every 2 seconds
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private downloadExport(workspaceId: number, jobId: string): void {
    this.backendService.downloadExportFile(workspaceId, jobId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export-${this.selectedFormat}-${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.snackBar.open(
          this.translateService.instant('ws-admin.export.success'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.download-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
      }
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
