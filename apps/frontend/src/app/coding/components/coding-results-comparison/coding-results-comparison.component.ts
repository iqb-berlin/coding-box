import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorIntl, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';

import { MatSnackBar } from '@angular/material/snack-bar';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CoderTraining } from '../../models/coder-training.model';

interface TrainingComparison {
  unitName: string;
  variableId: string;
  testperson?: string;
  trainings: Array<{
    trainingId: number;
    trainingLabel: string;
    code: string | null;
    score: number | null;
  }>;
}

interface WithinTrainingComparison {
  unitName: string;
  variableId: string;
  testperson?: string;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  coders: Array<{
    jobId: number;
    coderName: string;
    code: string | null;
    score: number | null;
  }>;
}

interface KappaCoderPair {
  coder1Id: number;
  coder1Name: string;
  coder2Id: number;
  coder2Name: string;
  kappa: number | null;
  agreement: number;
  totalItems: number;
  validPairs: number;
  interpretation: string;
}

interface KappaVariable {
  unitName: string;
  variableId: string;
  coderPairs: KappaCoderPair[];
}

interface KappaStatistics {
  variables: KappaVariable[];
  workspaceSummary: {
    totalDoubleCodedResponses: number;
    totalCoderPairs: number;
    averageKappa: number | null;
    meanAgreement?: number | null;
    variablesIncluded: number;
    codersIncluded: number;
    weightingMethod: 'weighted' | 'unweighted';
  };
}

@Component({
  selector: 'coding-box-coding-results-comparison',
  templateUrl: './coding-results-comparison.component.html',
  styleUrls: ['./coding-results-comparison.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatRadioModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule
  ]
})
export class CodingResultsComparisonComponent implements OnInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) set matPaginator(mp: MatPaginator) {
    if (mp) {
      this.dataSource.paginator = mp;
    }
  }

  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  isLoading = false;
  isLoadingKappa = false;
  dataSource = new MatTableDataSource<TrainingComparison | WithinTrainingComparison>([]);
  displayedColumns: string[] = ['index', 'unitName', 'variableId', 'personLogin', 'personCode', 'personGroup', 'match'];
  availableTrainings: CoderTraining[] = [];
  selectedTrainings = new SelectionModel<number>(true, []);
  comparisonData: TrainingComparison[] = [];
  withinTrainingData: WithinTrainingComparison[] = [];
  comparisonMode: 'between-trainings' | 'within-training' = 'between-trainings';
  selectedTrainingForWithin: number | null = null;

  availableCoders: Array<{ jobId: number; coderName: string }> = [];
  codersFormControl = new FormControl<number[]>([]);
  selectedCoderIds = new SelectionModel<number>(true, []);

  totalComparisons = 0;
  matchingComparisons = 0;
  matchingPercentage = 0;

  // Cohen's Kappa properties
  kappaStatistics: KappaStatistics | null = null;

  showKappaStatistics = false;
  useWeightedMean = true;
  useCodeLevel = true; // true = code level, false = score level

  originalKappaStatistics: KappaStatistics | null = null; // Store original for filtering

  constructor(
    public dialogRef: MatDialogRef<CodingResultsComparisonComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number; selectedTraining?: CoderTraining },
    private paginatorIntl: MatPaginatorIntl
  ) {
    this.paginatorIntl.itemsPerPageLabel = this.translate.instant('paginator.itemsPerPageLabel');
    this.paginatorIntl.nextPageLabel = this.translate.instant('paginator.nextPageLabel');
    this.paginatorIntl.previousPageLabel = this.translate.instant('paginator.previousPageLabel');
    this.paginatorIntl.firstPageLabel = this.translate.instant('paginator.firstPageLabel');
    this.paginatorIntl.lastPageLabel = this.translate.instant('paginator.lastPageLabel');
    this.paginatorIntl.getRangeLabel = (page: number, pageSize: number, length: number) => {
      if (length === 0 || pageSize === 0) {
        return this.translate.instant('paginator.getRangeLabel', { startIndex: 0, endIndex: 0, length });
      }
      const effectiveLength = Math.max(length, 0);
      const startIndex = page * pageSize;
      const endIndex = startIndex < effectiveLength ? Math.min(startIndex + pageSize, effectiveLength) : startIndex + pageSize;
      return this.translate.instant('paginator.getRangeLabel', { startIndex: startIndex + 1, endIndex, length: effectiveLength });
    };
  }

  ngOnInit(): void {
    this.loadCoderTrainings().then(() => {
      if (this.data.selectedTraining) {
        this.comparisonMode = 'within-training';
        this.selectedTrainingForWithin = this.data.selectedTraining.id;
        this.loadComparison();
      }
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadCoderTrainings(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workspaceId = this.data.workspaceId;
      if (!workspaceId) {
        reject();
        return;
      }

      this.codingTrainingBackendService.getCoderTrainings(workspaceId).subscribe({
        next: trainings => {
          this.availableTrainings = trainings;
          resolve();
        },
        error: () => {
          this.snackBar.open(this.translate.instant('coding.trainings.loading.error'), this.translate.instant('common.close'), { duration: 3000 });
          reject();
        }
      });
    });
  }

  onModeChange(): void {
    this.selectedTrainings.clear();
    this.selectedTrainingForWithin = null;
    this.comparisonData = [];
    this.withinTrainingData = [];
    this.dataSource.data = [];
    this.updateDisplayedColumns();
  }

  onTrainingSelectionChange(): void {
    if (this.comparisonMode === 'between-trainings' && this.selectedTrainings.selected.length >= 2) {
      this.loadComparison();
    } else {
      this.comparisonData = [];
      this.dataSource.data = [];
      this.updateDisplayedColumns();
    }
  }

  onTrainingForWithinChange(): void {
    if (this.comparisonMode === 'within-training' && this.selectedTrainingForWithin) {
      this.loadComparison();
    } else {
      this.withinTrainingData = [];
      this.dataSource.data = [];
      this.updateDisplayedColumns();
    }
  }

  private updateDisplayedColumns(): void {
    const baseColumns = ['index', 'unitName', 'variableId'];

    if (this.comparisonMode === 'between-trainings') {
      const trainingColumns = this.selectedTrainings.selected.map(trainingId => {
        const training = this.availableTrainings.find(t => t.id === trainingId);
        return training ? `training_${trainingId}` : '';
      }).filter(col => col);
      // For between trainings, we only show testperson as we don't have detailed person info consistency guaranteed
      this.displayedColumns = [...baseColumns, 'testperson', 'match', ...trainingColumns];
    } else if (this.comparisonMode === 'within-training') {
      // For within training, we show detailed person info
      const personColumns = ['personLogin', 'personCode', 'personGroup'];

      if (this.selectedTrainingForWithin && this.withinTrainingData.length > 0) {
        // Filter columns based on selected coders
        const selectedCoderIds = this.codersFormControl.value || [];
        const coderColumns = selectedCoderIds.map(jobId => `coder_${jobId}`);
        this.displayedColumns = [...baseColumns, ...personColumns, 'match', ...coderColumns];
      } else {
        this.displayedColumns = [...baseColumns, ...personColumns, 'match'];
      }
    }
  }

  calculateStatistics(): void {
    const data = this.dataSource.data;
    // Only count items with at least two codes from selected sources
    const doubleCodedItems = data.filter(item => this.countSelectedCodes(item) >= 2);

    const total = doubleCodedItems.length;
    const matching = doubleCodedItems.filter(item => this.areCodesMatching(item)).length;

    this.totalComparisons = total;
    this.matchingComparisons = matching;
    this.matchingPercentage = total > 0 ? Math.round((matching / total) * 100) : 0;
  }

  private countSelectedCodes(comparison: TrainingComparison | WithinTrainingComparison): number {
    let codes: (string | null)[];
    if ('trainings' in comparison) {
      const selectedIds = this.selectedTrainings.selected;
      codes = comparison.trainings
        .filter(t => selectedIds.includes(t.trainingId))
        .map(t => t.code);
    } else {
      const selectedIds = this.codersFormControl.value || [];
      codes = comparison.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    return codes.filter(c => c !== null).length;
  }

  private areCodesMatching(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if ('trainings' in comparison) {
      const selectedIds = this.selectedTrainings.selected;
      codes = comparison.trainings
        .filter(t => selectedIds.includes(t.trainingId))
        .map(t => t.code);
    } else {
      const selectedIds = this.codersFormControl.value || [];
      codes = comparison.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    const filteredCodes = codes.filter(c => c !== null);
    if (filteredCodes.length === 0) return true;
    const first = filteredCodes[0];
    return filteredCodes.every(code => code === first);
  }

  loadComparison(): void {
    if (this.comparisonMode === 'between-trainings') {
      if (this.selectedTrainings.selected.length < 2) {
        this.snackBar.open(this.translate.instant('coding.trainings.compare.notEnough'), this.translate.instant('common.close'), { duration: 3000 });
        return;
      }

      this.isLoading = true;
      const trainingIds = this.selectedTrainings.selected.join(',');
      this.codingTrainingBackendService.compareTrainingCodingResults(this.data.workspaceId, trainingIds).subscribe({
        next: data => {
          this.comparisonData = data.filter(d => this.hasAnyCode(d));
          this.dataSource.data = this.comparisonData;
          this.updateDisplayedColumns();
          this.calculateStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open(this.translate.instant('variable-analysis.error-loading-results'), this.translate.instant('common.close'), { duration: 3000 });
          this.isLoading = false;
        }
      });
    } else if (this.comparisonMode === 'within-training') {
      if (!this.selectedTrainingForWithin) {
        this.snackBar.open(this.translate.instant('coding.trainings.select-training'), this.translate.instant('common.close'), { duration: 3000 });
        return;
      }

      this.isLoading = true;
      this.codingTrainingBackendService.compareWithinTrainingCodingResults(this.data.workspaceId, this.selectedTrainingForWithin).subscribe({
        next: data => {
          // First map all data to ensure we have the correct structure
          const mappedData: WithinTrainingComparison[] = data.map(item => ({
            unitName: item.unitName,
            variableId: item.variableId,
            testperson: item.testPerson,
            personLogin: item.personLogin,
            personCode: item.personCode,
            personGroup: item.personGroup,
            coders: item.coders
          }));

          // Determine available coders from all data items
          if (mappedData.length > 0) {
            this.availableCoders = mappedData[0].coders.map(c => ({
              jobId: c.jobId,
              coderName: c.coderName
            }));
            // Select all coders by default
            const allCoderIds = this.availableCoders.map(c => c.jobId);
            this.codersFormControl.setValue(allCoderIds);
            this.selectedCoderIds.setSelection(...allCoderIds);
          } else {
            this.availableCoders = [];
            this.codersFormControl.setValue([]);
            this.selectedCoderIds.clear();
          }

          this.withinTrainingData = mappedData;
          // Now filter based on the (now initialized) selection
          this.dataSource.data = this.withinTrainingData.filter(d => this.hasAnyCode(d));
          this.updateDisplayedColumns();
          this.calculateStatistics();
          // Automatically load Kappa statistics to show Mean Agreement in summary
          this.loadKappaStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open(this.translate.instant('variable-analysis.error-loading-results'), this.translate.instant('common.close'), { duration: 3000 });
          this.isLoading = false;
        }
      });
    }
  }

  onCoderSelectionChange(): void {
    const selectedIds = this.codersFormControl.value || [];
    this.selectedCoderIds.clear();
    this.selectedCoderIds.select(...selectedIds);
    this.updateDisplayedColumns();

    if (this.comparisonMode === 'within-training') {
      this.dataSource.data = this.withinTrainingData.filter(d => this.hasAnyCode(d));
    }

    this.calculateStatistics();
    this.filterKappaStatistics();
  }

  getCoderCode(comparison: WithinTrainingComparison, jobId: number): string | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.code : null;
  }

  getCoderScore(comparison: WithinTrainingComparison, jobId: number): number | null {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return coder ? coder.score : null;
  }

  hasCoderCodeOrScore(comparison: WithinTrainingComparison, jobId: number): boolean {
    const coder = comparison.coders.find(c => c.jobId === jobId);
    return !!(coder && (coder.code !== null || coder.score !== null));
  }

  getTrainingColumnName(trainingId: number): string {
    const training = this.availableTrainings.find(t => t.id === trainingId);
    return training ? training.label : `Training ${trainingId}`;
  }

  getTrainingCode(comparison: TrainingComparison, trainingId: number): string | null {
    const training = comparison.trainings.find(t => t.trainingId === trainingId);
    return training ? training.code : null;
  }

  getTrainingScore(comparison: TrainingComparison, trainingId: number): number | null {
    const training = comparison.trainings.find(t => t.trainingId === trainingId);
    return training ? training.score : null;
  }

  hasCodeOrScore(comparison: TrainingComparison, trainingId: number): boolean {
    const training = comparison.trainings.find(t => t.trainingId === trainingId);
    return !!(training && (training.code !== null || training.score !== null));
  }

  applyFilter(event: Event): void {
    this.dataSource.filter = (event.target as HTMLInputElement)?.value?.trim().toLowerCase() || '';
  }

  trackByCoder(index: number, coder: { jobId: number; coderName: string }): number {
    return coder.jobId;
  }

  areCodesTheSame(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if ('trainings' in comparison) {
      const selectedIds = this.selectedTrainings.selected;
      codes = comparison.trainings
        .filter(t => selectedIds.includes(t.trainingId))
        .map(t => t.code);
    } else {
      const selectedIds = this.codersFormControl.value || [];
      codes = comparison.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    if (codes.length === 0) return true;
    const first = codes[0];
    return codes.every(code => code === first);
  }

  hasAnyCode(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if ('trainings' in comparison) {
      const selectedIds = this.selectedTrainings.selected;
      codes = comparison.trainings
        .filter(t => selectedIds.includes(t.trainingId))
        .map(t => t.code);
    } else {
      const selectedIds = this.codersFormControl.value || [];
      codes = comparison.coders
        .filter(c => selectedIds.includes(c.jobId))
        .map(c => c.code);
    }
    return codes.some(c => c !== null);
  }

  loadKappaStatistics(): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

    this.isLoadingKappa = true;
    const level = this.useCodeLevel ? 'code' : 'score';
    this.codingTrainingBackendService
      .getTrainingCohensKappa(
        this.data.workspaceId,
        this.selectedTrainingForWithin,
        this.useWeightedMean,
        level
      )
      .subscribe({
        next: stats => {
          this.originalKappaStatistics = stats;
          this.filterKappaStatistics();
          this.isLoadingKappa = false;
        },
        error: () => {
          this.isLoadingKappa = false;
          this.snackBar.open(
            this.translate.instant('coding.trainings.kappa.error'),
            this.translate.instant('common.close'),
            { duration: 3000 }
          );
        }
      });
  }

  filterKappaStatistics(): void {
    if (!this.originalKappaStatistics) return;

    const selectedCoderIds = this.codersFormControl.value || [];

    // Deep copy
    const filteredStats = JSON.parse(JSON.stringify(this.originalKappaStatistics));

    // Filter coder pairs for each variable
    filteredStats.variables = filteredStats.variables.map((variable: KappaVariable) => {
      variable.coderPairs = variable.coderPairs.filter((pair: KappaCoderPair) => selectedCoderIds.includes(pair.coder1Id) && selectedCoderIds.includes(pair.coder2Id)
      );
      return variable;
    }).filter((variable: KappaVariable) => variable.coderPairs.length > 0);

    this.kappaStatistics = filteredStats;
    this.calculateMeanAgreement();
    this.updateSummaryFromFiltered();
  }

  updateSummaryFromFiltered(): void {
    if (!this.kappaStatistics) return;

    // Recalculate totalDoubleCodedResponses based on selected coders and withinTrainingData
    const selectedCoderIds = this.codersFormControl.value || [];
    this.kappaStatistics.workspaceSummary.totalDoubleCodedResponses = this.withinTrainingData.filter(d => {
      const coderCodes = d.coders
        .filter(c => selectedCoderIds.includes(c.jobId))
        .map(c => c.code)
        .filter(c => c !== null);
      return coderCodes.length >= 2;
    }).length;

    let totalWeight = 0;
    let pairCount = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) {
          totalWeight += pair.validPairs;
          pairCount += 1;
        }
      });
    });

    // Recalculate average Kappa similarly
    let totalKappaWeighted = 0;
    let totalKappaSum = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0 && pair.kappa !== null) {
          totalKappaWeighted += pair.kappa * pair.validPairs;
          totalKappaSum += pair.kappa;
        }
      });
    });

    const meanKappaWeighted = totalWeight > 0 ? totalKappaWeighted / totalWeight : null;
    const meanKappaArithmetic = pairCount > 0 ? totalKappaSum / pairCount : null;

    this.kappaStatistics.workspaceSummary.averageKappa = this.useWeightedMean ?
      meanKappaWeighted : meanKappaArithmetic;

    this.kappaStatistics.workspaceSummary.totalCoderPairs = pairCount;
    this.kappaStatistics.workspaceSummary.codersIncluded = this.codersFormControl.value?.length || 0;
    this.kappaStatistics.workspaceSummary.variablesIncluded = this.kappaStatistics.variables.length;
  }

  calculateMeanAgreement(): void {
    if (!this.kappaStatistics) return;

    let totalAgreementWeighted = 0;
    let totalWeight = 0;
    let totalAgreementSum = 0;
    let pairCount = 0;

    this.kappaStatistics.variables.forEach(variable => {
      variable.coderPairs.forEach(pair => {
        if (pair.validPairs > 0) { // Only consider pairs with data
          totalAgreementWeighted += pair.agreement * pair.validPairs;
          totalWeight += pair.validPairs;
          totalAgreementSum += pair.agreement;
          pairCount += 1;
        }
      });
    });

    if (this.useWeightedMean) {
      this.kappaStatistics.workspaceSummary.meanAgreement = totalWeight > 0 ? totalAgreementWeighted / totalWeight : 0;
    } else {
      this.kappaStatistics.workspaceSummary.meanAgreement = pairCount > 0 ? totalAgreementSum / pairCount : 0;
    }
  }

  toggleKappaStatistics(): void {
    this.showKappaStatistics = !this.showKappaStatistics;
    if (this.showKappaStatistics && !this.kappaStatistics) {
      this.loadKappaStatistics();
    }
  }

  toggleWeightingMethod(): void {
    this.loadKappaStatistics();
  }

  toggleCalculationLevel(): void {
    this.loadKappaStatistics();
  }
}
