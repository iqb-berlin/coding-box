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
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppService } from '../../../core/services/app.service';
import { ExportJobConfig, ExportJobService } from '../../../shared/services/file/export-job.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { CoderService } from '../../../coding/services/coder.service';
import { CodingExportEstimate, JobDefinition } from '../../../coding/services/coding-job-backend.service';
import { CoderTraining } from '../../../coding/models/coder-training.model';
import { Coder } from '../../../coding/models/coder.model';
import { ResponseService } from '../../../shared/services/response/response.service';
import {
  ExportSelectionDialogComponent,
  ExportSelectionDialogResult
} from './export-selection-dialog.component';

export type ExportFormat =
  | 'results-by-version'
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'by-variable-compact'
  | 'detailed'
  | 'coding-times';
type ResultsVersion = 'v1' | 'v2' | 'v3';
type ResultsExportFormat = 'csv' | 'excel';

interface ExportFormatOption {
  value: ExportFormat;
  label: string;
  description: string;
}

interface ExportFormatGroup {
  label: string;
  formats: ExportFormatOption[];
}

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
    MatSelectModule,
    MatFormFieldModule,
    MatDialogModule,
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
  private codingFacadeService = inject(CodingFacadeService);
  private coderService = inject(CoderService);
  private responseService = inject(ResponseService);
  private dialog = inject(MatDialog);

  selectedFormat: ExportFormat = 'results-by-version';
  isStartingExport = false;
  includeModalValue = false;
  includeDoubleCoded = false;
  includeComments = false;
  includeReplayUrl = false;
  includeResponseValues = true;
  includeGeoGebraFiles = false;
  hasGeoGebraResponses = false;
  outputCommentsInsteadOfCodes = false;
  anonymizeCoders = false;
  usePseudoCoders = false;
  doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent';
  excludeAutoCoded = false;
  resultsVersion: ResultsVersion = 'v2';
  resultsFormat: ResultsExportFormat = 'csv';
  largeByVariableEstimate: CodingExportEstimate | null = null;

  jobDefinitions: JobDefinition[] = [];
  coderTrainings: CoderTraining[] = [];
  coders: Coder[] = [];

  selectedJobDefinitionIds: number[] = [];
  selectedCoderTrainingIds: number[] = [];
  selectedCoderIds: number[] = [];
  selectedCombinedJobIds: string[] = [];

  exportFormatGroups: ExportFormatGroup[] = [
    {
      label: this.translateService.instant('ws-admin.export-format-groups.result-data'),
      formats: [
        {
          value: 'results-by-version',
          label: this.translateService.instant('ws-admin.export-formats.final-results'),
          description: this.translateService.instant('ws-admin.export-formats.final-results-description')
        },
        {
          value: 'aggregated',
          label: this.translateService.instant('ws-admin.export-formats.aggregated'),
          description: this.translateService.instant('ws-admin.export-formats.aggregated-description')
        }
      ]
    },
    {
      label: this.translateService.instant('ws-admin.export-format-groups.audit-quality'),
      formats: [
        {
          value: 'by-coder',
          label: this.translateService.instant('ws-admin.export-formats.by-coder'),
          description: this.translateService.instant('ws-admin.export-formats.by-coder-description')
        },
        {
          value: 'by-variable',
          label: this.translateService.instant('ws-admin.export-formats.by-variable'),
          description: this.translateService.instant('ws-admin.export-formats.by-variable-description')
        },
        {
          value: 'by-variable-compact',
          label: this.translateService.instant('ws-admin.export-formats.by-variable-compact'),
          description: this.translateService.instant('ws-admin.export-formats.by-variable-compact-description')
        },
        {
          value: 'detailed',
          label: this.translateService.instant('ws-admin.export-formats.detailed'),
          description: this.translateService.instant('ws-admin.export-formats.detailed-description')
        },
        {
          value: 'coding-times',
          label: this.translateService.instant('ws-admin.export-formats.coding-times'),
          description: this.translateService.instant('ws-admin.export-formats.coding-times-description')
        }
      ]
    }
  ];

  constructor() {
    this.loadOptions();
  }

  openSelectionDialog(): void {
    const dialogRef = this.dialog.open(ExportSelectionDialogComponent, {
      width: '1100px',
      maxWidth: '92vw',
      data: {
        jobDefinitions: this.jobDefinitions,
        coderTrainings: this.coderTrainings,
        coders: this.coders,
        selectedCombinedJobIds: this.selectedCombinedJobIds
      }
    });

    dialogRef.afterClosed().subscribe((result: ExportSelectionDialogResult | undefined) => {
      if (!result) return;
      this.selectedCombinedJobIds = result.selectedCombinedJobIds;
      this.clearLargeByVariableEstimate();
    });
  }

  getSelectionSummary(): string {
    const jobCount = this.finalJobDefinitionIds.length;
    const trainingCount = this.finalCoderTrainingIds.length;

    if (jobCount === 0 && trainingCount === 0) return 'Keine Filter gesetzt';

    const parts: string[] = [];
    if (jobCount > 0) parts.push(`${jobCount} Definition${jobCount === 1 ? '' : 'en'}`);
    if (trainingCount > 0) parts.push(`${trainingCount} Training${trainingCount === 1 ? '' : 's'}`);
    return parts.join(', ');
  }

  getCoderSelectionLabel(): string {
    if (this.selectedCoderIds.length === 0) {
      return this.translateService.instant('ws-admin.export-options.all-coders');
    }

    if (this.selectedCoderIds.length === 1) {
      const selectedCoder = this.coders.find(coder => coder.id === this.selectedCoderIds[0]);
      return selectedCoder?.displayName || selectedCoder?.name || `${this.selectedCoderIds[0]}`;
    }

    return this.translateService.instant('ws-admin.export-options.selected-coders', {
      count: this.selectedCoderIds.length
    });
  }

  getJobDefinitionLabel(def: JobDefinition): string {
    const idPart = def.id != null ? `Definition #${def.id}` : 'Definition';
    const statusPart = def.status ? `(${def.status})` : '';
    const varsCount = def.assignedVariables?.length ?? 0;
    const bundlesCount = def.assignedVariableBundles?.length ?? 0;
    const codersCount = def.assignedCoders?.length ?? 0;
    return `${idPart} ${statusPart} – ${varsCount} Variablen, ${bundlesCount} Bündel, ${codersCount} Kodierer`;
  }

  private loadOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.codingFacadeService.getJobDefinitions(workspaceId).subscribe(defs => {
      this.jobDefinitions = defs;
    });

    this.codingFacadeService.getCoderTrainings(workspaceId).subscribe(trainings => {
      this.coderTrainings = trainings;
    });

    this.coderService.getCoders().subscribe(coders => {
      this.coders = coders;
    });

    this.responseService.hasGeogebraResponses(workspaceId).subscribe(hasGeoGebraResponses => {
      this.hasGeoGebraResponses = hasGeoGebraResponses;
      this.clearUnsupportedResultsOptions();
    });
  }

  onFormatChange(): void {
    this.clearLargeByVariableEstimate();
    this.clearUnsupportedOptions();
    this.clearUnsupportedResultsOptions();
  }

  onResultsFormatChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeResponseValuesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onDoubleCodingMethodChange(): void {
    this.clearUnsupportedOptions();
  }

  clearLargeByVariableEstimate(): void {
    this.largeByVariableEstimate = null;
  }

  selectCompactVariableExport(): void {
    this.selectedFormat = 'by-variable-compact';
    this.clearLargeByVariableEstimate();
    this.clearUnsupportedOptions();
  }

  supportsReplayUrl(): boolean {
    return this.selectedFormat !== 'coding-times' &&
      (this.selectedFormat !== 'aggregated' || this.doubleCodingMethod === 'new-row-per-variable');
  }

  supportsCommentsInsteadOfCodes(): boolean {
    return this.selectedFormat !== 'coding-times' && this.selectedFormat !== 'results-by-version';
  }

  supportsJobFilters(): boolean {
    return this.selectedFormat !== 'results-by-version';
  }

  supportsCoderOptions(): boolean {
    return this.selectedFormat !== 'results-by-version';
  }

  supportsManualVariableFilter(): boolean {
    return this.selectedFormat !== 'results-by-version';
  }

  private clearUnsupportedOptions(): void {
    if (!this.supportsReplayUrl()) {
      this.includeReplayUrl = false;
    }

    if (!this.supportsCommentsInsteadOfCodes()) {
      this.outputCommentsInsteadOfCodes = false;
    }

    if (!this.supportsCoderOptions()) {
      this.anonymizeCoders = false;
      this.usePseudoCoders = false;
    }

    if (!this.supportsManualVariableFilter()) {
      this.excludeAutoCoded = false;
    }
  }

  private clearUnsupportedResultsOptions(): void {
    if (
      this.selectedFormat !== 'results-by-version' ||
      this.resultsFormat !== 'excel' ||
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses
    ) {
      this.includeGeoGebraFiles = false;
    }
  }

  get finalJobDefinitionIds(): number[] {
    return Array.from(new Set(
      this.selectedCombinedJobIds
        .filter(id => id.startsWith('job_'))
        .map(id => parseInt(id.replace('job_', ''), 10))
        .filter(id => Number.isInteger(id) && id > 0)
    ));
  }

  get finalCoderTrainingIds(): number[] {
    return Array.from(new Set(
      this.selectedCombinedJobIds
        .filter(id => id.startsWith('training_'))
        .map(id => parseInt(id.replace('training_', ''), 10))
        .filter(id => Number.isInteger(id) && id > 0)
    ));
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

    if (this.selectedFormat === 'by-variable') {
      this.exportJobService.estimateJob(workspaceId, this.buildExportConfig('')).subscribe({
        next: estimate => {
          if (estimate.exceedsWorksheetLimit) {
            this.largeByVariableEstimate = estimate;
            this.snackBar.open(
              this.translateService.instant('ws-admin.export.errors.too-many-worksheets-short'),
              this.translateService.instant('close'),
              { duration: 7000 }
            );
            this.isStartingExport = false;
            return;
          }
          this.startExportWithToken(workspaceId);
        },
        error: () => {
          this.startExportWithToken(workspaceId);
        }
      });
      return;
    }

    this.startExportWithToken(workspaceId);
  }

  private startExportWithToken(workspaceId: number): void {
    const tokenObservable = this.includeReplayUrl ?
      this.appService.createOwnToken(workspaceId, 60).pipe(catchError(() => {
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

    tokenObservable.subscribe({
      next: authToken => {
        const exportConfig = this.buildExportConfig(authToken);

        this.exportJobService.startJob(workspaceId, exportConfig).subscribe({
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
      },
      error: () => {
        this.isStartingExport = false;
      }
    });
  }

  private buildExportConfig(authToken: string): ExportJobConfig {
    const exportConfig = {
      exportType: this.selectedFormat,
      userId: this.appService.userId,
      includeReplayUrl: this.includeReplayUrl,
      authToken
    };

    if (this.selectedFormat === 'results-by-version') {
      return {
        ...exportConfig,
        version: this.resultsVersion,
        format: this.resultsFormat,
        includeResponseValues: this.includeResponseValues,
        includeGeoGebraFiles: this.includeGeoGebraFiles
      };
    }

    return {
      ...exportConfig,
      outputCommentsInsteadOfCodes: this.outputCommentsInsteadOfCodes,
      anonymizeCoders: this.anonymizeCoders,
      usePseudoCoders: this.usePseudoCoders,
      doubleCodingMethod: this.doubleCodingMethod,
      includeComments: this.includeComments,
      includeModalValue: this.includeModalValue,
      includeDoubleCoded: this.includeDoubleCoded,
      excludeAutoCoded: this.excludeAutoCoded,
      jobDefinitionIds: this.finalJobDefinitionIds,
      coderTrainingIds: this.finalCoderTrainingIds,
      coderIds: this.selectedCoderIds
    };
  }
}
