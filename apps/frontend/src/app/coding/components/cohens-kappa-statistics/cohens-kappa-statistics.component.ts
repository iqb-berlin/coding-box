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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';
import {
  CohensKappaCalculationLevel,
  CohensKappaScope,
  CohensKappaCoderPair,
  CohensKappaStatisticsResponse,
  CohensKappaVariableSummary,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { CoderTraining } from '../../models/coder-training.model';
import {
  getTrainingOptionMeta,
  getTrainingOptionTitle
} from '../../utils/coder-training-display';

export interface CohensKappaStatisticsDialogData {
  scope?: CohensKappaScope;
  excludeTrainings?: boolean;
  availableCoderTrainings?: CoderTraining[];
  selectedCoderTrainingId?: number;
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
    MatFormFieldModule,
    MatSelectModule,
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
  private kappaStatisticsRequestId = 0;

  constructor(
    @Optional() public dialogRef: MatDialogRef<CohensKappaStatisticsComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: CohensKappaStatisticsDialogData | null
  ) {
    this.availableCoderTrainings = dialogData?.availableCoderTrainings ?? [];
    this.selectedCoderTrainingId = this.getInitialCoderTrainingId();
    this.excludeTrainings = dialogData?.excludeTrainings ??
      !(this.hasCoderTrainingSelection || this.getEffectiveKappaScope()?.coderTrainingIds?.length);
    this.excludeTrainingsLocked = this.hasCoderTrainingSelection || !!dialogData?.scope?.coderTrainingIds?.length;
  }

  isLoading = false;
  kappaStatistics: CohensKappaVariableSummary[] = [];
  showInterpretationScale = false;
  useWeightedMean = true; // Default to weighted mean (matching R reference implementation)
  useCodeLevel = true;
  excludeTrainings = true; // Default: exclude trainings
  excludeTrainingsLocked = false;
  availableCoderTrainings: CoderTraining[] = [];
  selectedCoderTrainingId: number | null = null;
  availableCoders: Array<{ id: number; name: string }> = [];
  selectedCoderIds: number[] = [];
  exportInProgress: 'summary' | 'details' | 'xlsx' | null = null;

  workspaceKappaSummary: {
    workspaceSummary: CohensKappaStatisticsResponse['workspaceSummary'];
  } | null = null;

  ngOnInit(): void {
    this.loadKappaStatistics();
  }

  get hasCoderTrainingSelection(): boolean {
    return this.availableCoderTrainings.length > 0;
  }

  get canLoadKappaStatistics(): boolean {
    if (this.hasCoderTrainingSelection && this.selectedCoderTrainingId === null) {
      return false;
    }

    return this.availableCoders.length === 0 || this.selectedCoderIds.length >= 2;
  }

  get noDataTranslationKey(): string {
    if (this.canLoadKappaStatistics) {
      return 'cohens-kappa-statistics.no-data';
    }

    return this.hasCoderTrainingSelection && this.selectedCoderTrainingId === null ?
      'cohens-kappa-statistics.select-training-hint' :
      'cohens-kappa-statistics.select-coders-hint';
  }

  get calculationLevel(): CohensKappaCalculationLevel {
    return this.useCodeLevel ? 'code' : 'score';
  }

  getSelectedCoderTraining(): CoderTraining | undefined {
    return this.availableCoderTrainings.find(training => training.id === this.selectedCoderTrainingId);
  }

  getTrainingOptionTitle(training: CoderTraining): string {
    return getTrainingOptionTitle(training);
  }

  getTrainingOptionMeta(training: CoderTraining): string {
    return getTrainingOptionMeta(training, 'Kodierer', 'Kodierer');
  }

  onCoderTrainingSelectionChange(): void {
    this.resetCoderSelection();
    this.loadKappaStatistics();
  }

  onCoderSelectionChange(): void {
    this.loadKappaStatistics();
  }

  selectAllCoders(): void {
    this.selectedCoderIds = this.availableCoders.map(coder => coder.id);
    this.loadKappaStatistics();
  }

  clearCoderSelection(): void {
    this.selectedCoderIds = [];
    this.kappaStatistics = [];
    this.workspaceKappaSummary = null;
  }

  private loadKappaStatistics(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.kappaStatisticsRequestId += 1;
    const requestId = this.kappaStatisticsRequestId;

    if (!workspaceId || !this.canLoadKappaStatistics) {
      this.kappaStatistics = [];
      this.workspaceKappaSummary = null;
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    const kappaScope = this.getEffectiveKappaScope();

    this.testPersonCodingService
      .getCohensKappaStatistics(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        kappaScope,
        this.calculationLevel
      )
      .subscribe({
        next: response => {
          if (requestId !== this.kappaStatisticsRequestId) {
            return;
          }
          this.kappaStatistics = response.variables;
          this.workspaceKappaSummary = {
            workspaceSummary: response.workspaceSummary
          };
          this.syncAvailableCoders(response);
          this.isLoading = false;
        },
        error: () => {
          if (requestId !== this.kappaStatisticsRequestId) {
            return;
          }
          this.kappaStatistics = [];
          this.workspaceKappaSummary = null;
          this.isLoading = false;
        }
      });
  }

  toggleWeightingMethod(): void {
    this.loadKappaStatistics();
  }

  toggleCalculationLevel(): void {
    this.resetCoderSelection();
    this.loadKappaStatistics();
  }

  toggleExcludeTrainings(): void {
    this.resetCoderSelection();
    this.loadKappaStatistics();
  }

  exportKappaSummaryCsv(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.canLoadKappaStatistics || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'summary';
    const kappaScope = this.getEffectiveKappaScope();
    this.testPersonCodingService
      .exportCohensKappaSummaryAsCsv(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        kappaScope,
        this.calculationLevel
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
    if (!workspaceId || !this.canLoadKappaStatistics || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'xlsx';
    const kappaScope = this.getEffectiveKappaScope();
    this.testPersonCodingService
      .exportCohensKappaStatisticsAsXlsx(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        kappaScope,
        this.calculationLevel
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
    if (!workspaceId || !this.canLoadKappaStatistics || this.exportInProgress || this.kappaStatistics.length === 0) {
      return;
    }

    this.exportInProgress = 'details';
    const kappaScope = this.getEffectiveKappaScope();
    this.testPersonCodingService
      .exportCohensKappaStatisticsAsCsv(
        workspaceId,
        this.useWeightedMean,
        this.excludeTrainings,
        undefined,
        undefined,
        kappaScope,
        this.calculationLevel
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

  private getInitialCoderTrainingId(): number | null {
    if (!this.hasCoderTrainingSelection) {
      return null;
    }

    const initialTrainingId =
      this.dialogData?.selectedCoderTrainingId ??
      (this.dialogData?.scope?.coderTrainingIds?.length === 1 ?
        this.dialogData.scope.coderTrainingIds[0] :
        undefined);

    if (
      initialTrainingId !== undefined &&
      this.availableCoderTrainings.some(training => training.id === initialTrainingId)
    ) {
      return initialTrainingId;
    }

    return this.availableCoderTrainings.length === 1 ? this.availableCoderTrainings[0].id : null;
  }

  private getEffectiveKappaScope(): CohensKappaScope | undefined {
    const selectedCoderIds = this.availableCoders.length > 0 ? this.selectedCoderIds : [];

    if (!this.hasCoderTrainingSelection) {
      return {
        ...this.dialogData?.scope,
        ...(selectedCoderIds.length ? { coderIds: selectedCoderIds } : {})
      };
    }

    if (this.selectedCoderTrainingId === null) {
      return undefined;
    }

    return {
      ...this.dialogData?.scope,
      coderTrainingIds: [this.selectedCoderTrainingId],
      ...(selectedCoderIds.length ? { coderIds: selectedCoderIds } : {})
    };
  }

  private resetCoderSelection(): void {
    this.availableCoders = [];
    this.selectedCoderIds = [];
  }

  private syncAvailableCoders(response: CohensKappaStatisticsResponse): void {
    const codersById = new Map<number, string>();
    response.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        codersById.set(pair.coder1Id, pair.coder1Name);
        codersById.set(pair.coder2Id, pair.coder2Name);
      });
    });

    if (codersById.size === 0) {
      return;
    }

    const previousSelectedIds = new Set(this.selectedCoderIds);
    const wasInitialized = this.availableCoders.length > 0;
    if (wasInitialized) {
      this.availableCoders.forEach(coder => codersById.set(coder.id, coder.name));
    }

    this.availableCoders = Array.from(codersById.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    this.selectedCoderIds = wasInitialized ?
      this.availableCoders
        .map(coder => coder.id)
        .filter(coderId => previousSelectedIds.has(coderId)) :
      this.availableCoders.map(coder => coder.id);
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
