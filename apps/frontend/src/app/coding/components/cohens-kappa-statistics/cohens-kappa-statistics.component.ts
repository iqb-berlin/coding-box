import {
  Component, OnInit, Inject, Optional, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';
import {
  CohensKappaScope,
  CohensKappaCoderPair,
  CohensKappaStatisticsResponse,
  CohensKappaVariableSummary,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';

export interface CohensKappaStatisticsDialogData {
  scope?: CohensKappaScope;
  excludeTrainings?: boolean;
}

@Component({
  selector: 'coding-box-cohens-kappa-statistics',
  templateUrl: './cohens-kappa-statistics.component.html',
  styleUrls: ['./cohens-kappa-statistics.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    FormsModule,
    TranslateModule
  ]
})
export class CohensKappaStatisticsComponent implements OnInit {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  constructor(
    @Optional() public dialogRef: MatDialogRef<CohensKappaStatisticsComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: CohensKappaStatisticsDialogData | null
  ) {
    this.kappaScope = dialogData?.scope;
    this.excludeTrainings = dialogData?.excludeTrainings ?? !dialogData?.scope?.coderTrainingIds?.length;
    this.excludeTrainingsLocked = !!dialogData?.scope?.coderTrainingIds?.length;
  }

  isLoading = false;
  kappaStatistics: CohensKappaVariableSummary[] = [];
  showInterpretationScale = false;
  useWeightedMean = true; // Default to weighted mean (matching R reference implementation)
  excludeTrainings = true; // Default: exclude trainings
  excludeTrainingsLocked = false;
  private kappaScope?: CohensKappaScope;
  exportInProgress: 'summary' | 'details' | 'xlsx' | null = null;

  workspaceKappaSummary: {
    workspaceSummary: CohensKappaStatisticsResponse['workspaceSummary'];
  } | null = null;

  ngOnInit(): void {
    this.loadKappaStatistics();
  }

  private loadKappaStatistics(): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.isLoading = false;
      return;
    }

    this.testPersonCodingService
      .getCohensKappaStatistics(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        this.kappaScope
      )
      .subscribe({
        next: response => {
          this.kappaStatistics = response.variables;
          this.workspaceKappaSummary = {
            workspaceSummary: response.workspaceSummary
          };
          this.isLoading = false;
        },
        error: () => {
          this.kappaStatistics = [];
          this.workspaceKappaSummary = null;
          this.isLoading = false;
        }
      });
  }

  toggleWeightingMethod(): void {
    this.loadKappaStatistics();
  }

  toggleExcludeTrainings(): void {
    this.loadKappaStatistics();
  }

  exportKappaSummaryCsv(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'summary';
    this.testPersonCodingService
      .exportCohensKappaSummaryAsCsv(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        this.kappaScope
      )
      .pipe(finalize(() => {
        this.exportInProgress = null;
      }))
      .subscribe({
        next: blob => {
          this.saveBlob(blob, `cohens-kappa-summary-${this.getDateString()}.csv`);
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('cohens-kappa-statistics.export-summary-error'),
            this.translateService.instant('cohens-kappa-statistics.close'),
            { duration: 5000, panelClass: ['error-snackbar'] }
          );
        }
      });
  }

  exportKappaWorkbook(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'xlsx';
    this.testPersonCodingService
      .exportCohensKappaStatisticsAsXlsx(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        this.kappaScope
      )
      .pipe(finalize(() => {
        this.exportInProgress = null;
      }))
      .subscribe({
        next: blob => {
          this.saveBlob(blob, `cohens-kappa-${this.getDateString()}.xlsx`);
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('cohens-kappa-statistics.export-xlsx-error'),
            this.translateService.instant('cohens-kappa-statistics.close'),
            { duration: 5000, panelClass: ['error-snackbar'] }
          );
        }
      });
  }

  exportKappaDetails(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'details';
    this.testPersonCodingService
      .exportCohensKappaStatisticsAsCsv(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        this.kappaScope
      )
      .pipe(finalize(() => {
        this.exportInProgress = null;
      }))
      .subscribe({
        next: blob => {
          this.saveBlob(blob, `cohens-kappa-details-${this.getDateString()}.csv`);
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('cohens-kappa-statistics.export-details-error'),
            this.translateService.instant('cohens-kappa-statistics.close'),
            { duration: 5000, panelClass: ['error-snackbar'] }
          );
        }
      });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private getDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getKappaClass(kappa: number | null): string {
    if (kappa === null) return 'kappa-na';
    if (kappa < 0) return 'kappa-poor';
    if (kappa < 0.2) return 'kappa-poor';
    if (kappa < 0.4) return 'kappa-fair';
    if (kappa < 0.6) return 'kappa-moderate';
    if (kappa < 0.81) return 'kappa-substantial';
    if (kappa <= 0.95) return 'kappa-good';
    return 'kappa-perfect';
  }

  getVariableLabel(variable: Pick<CohensKappaVariableSummary, 'unitName' | 'variableId'>): string {
    return `${variable.unitName} - ${variable.variableId}`;
  }

  getCoderPairLabel(pair: CohensKappaCoderPair): string {
    return `${pair.coder1Name} ↔ ${pair.coder2Name}`;
  }

  getKappaInterpretationText(kappa: number | null): string {
    if (kappa === null) {
      return this.translateService.instant('cohens-kappa-statistics.no-data-available');
    }
    if (kappa < 0) {
      return this.translateService.instant('cohens-kappa-statistics.interpretation-poor-negative');
    }
    if (kappa < 0.2) {
      return this.translateService.instant('kappa.slight');
    }
    if (kappa < 0.4) {
      return this.translateService.instant('kappa.fair');
    }
    if (kappa < 0.6) {
      return this.translateService.instant('kappa.moderate');
    }
    if (kappa < 0.81) {
      return this.translateService.instant('kappa.substantial');
    }
    if (kappa <= 0.95) {
      return this.translateService.instant('kappa.good');
    }
    return this.translateService.instant('kappa.almost_perfect');
  }

  getKappaInterpretationClass(kappa: number | null): string {
    if (kappa === null) {
      return 'kappa-no-data';
    }
    if (kappa < 0) {
      return 'kappa-poor';
    }
    if (kappa < 0.2) {
      return 'kappa-poor';
    }
    if (kappa < 0.4) {
      return 'kappa-fair';
    }
    if (kappa < 0.6) {
      return 'kappa-moderate';
    }
    if (kappa < 0.81) {
      return 'kappa-substantial';
    }
    if (kappa <= 0.95) {
      return 'kappa-good';
    }
    return 'kappa-excellent';
  }

  toggleInterpretationScale(): void {
    this.showInterpretationScale = !this.showInterpretationScale;
  }

  getTranslatedInterpretation(interpretationKey: string): string {
    if (!interpretationKey) return '';
    return this.translateService.instant(interpretationKey);
  }
}
