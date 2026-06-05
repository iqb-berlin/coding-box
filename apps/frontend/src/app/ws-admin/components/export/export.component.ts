import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AppService } from '../../../core/services/app.service';
import { ExportJobConfig, ExportJobService } from '../../../shared/services/file/export-job.service';
import { ResponseService } from '../../../shared/services/response/response.service';

export type ExportFormat = 'results-by-version';
type ResultsVersion = 'v1' | 'v2' | 'v3';
type ResultsExportFormat = 'csv' | 'excel';

@Component({
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatIconModule,
    FormsModule,
    CommonModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private responseService = inject(ResponseService);

  selectedFormat: ExportFormat = 'results-by-version';
  isStartingExport = false;
  includeResponseValues = true;
  includeGeoGebraResponseValues = false;
  includeGeoGebraFiles = false;
  hasGeoGebraResponses = false;
  resultsVersion: ResultsVersion = 'v2';
  resultsFormat: ResultsExportFormat = 'csv';

  constructor() {
    this.loadOptions();
  }

  private loadOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.responseService.hasGeogebraResponses(workspaceId).subscribe(hasGeoGebraResponses => {
      this.hasGeoGebraResponses = hasGeoGebraResponses;
      this.clearUnsupportedResultsOptions();
    });
  }

  onResultsFormatChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeResponseValuesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeGeoGebraFilesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  private clearUnsupportedResultsOptions(): void {
    if (
      this.resultsFormat !== 'excel' ||
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses
    ) {
      this.includeGeoGebraFiles = false;
    }

    if (
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses ||
      this.includeGeoGebraFiles
    ) {
      this.includeGeoGebraResponseValues = false;
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

    this.exportJobService.startJob(workspaceId, this.buildExportConfig()).subscribe({
      next: () => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.job-started'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
        this.isStartingExport = false;
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.start-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isStartingExport = false;
      }
    });
  }

  private buildExportConfig(): ExportJobConfig {
    return {
      exportType: this.selectedFormat,
      userId: this.appService.userId,
      includeReplayUrl: false,
      version: this.resultsVersion,
      format: this.resultsFormat,
      includeResponseValues: this.includeResponseValues,
      includeGeoGebraResponseValues: this.includeGeoGebraResponseValues,
      includeGeoGebraFiles: this.includeGeoGebraFiles
    };
  }
}
