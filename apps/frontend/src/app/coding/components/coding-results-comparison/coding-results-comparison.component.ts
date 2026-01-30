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
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private codingTrainingBackendService = inject(CodingTrainingBackendService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  isLoading = false;
  dataSource = new MatTableDataSource<TrainingComparison | WithinTrainingComparison>([]);
  displayedColumns: string[] = ['unitName', 'variableId', 'personLogin', 'personCode', 'personGroup', 'match'];
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
  kappaStatistics: {
    variables: Array<{
      unitName: string;
      variableId: string;
      coderPairs: Array<{
        coder1Id: number;
        coder1Name: string;
        coder2Id: number;
        coder2Name: string;
        kappa: number | null;
        agreement: number;
        totalItems: number;
        validPairs: number;
        interpretation: string;
      }>;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      meanAgreement?: number | null;
      variablesIncluded: number;
      codersIncluded: number;
      weightingMethod: 'weighted' | 'unweighted';
    };
  } | null = null;

  showKappaStatistics = false;
  useWeightedMean = true;
  useCodeLevel = true; // true = code level, false = score level

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
    this.dataSource.paginator = this.paginator;
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
    const baseColumns = ['unitName', 'variableId'];

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
        const coderColumns = this.selectedCoderIds.selected.map(jobId => `coder_${jobId}`);
        this.displayedColumns = [...baseColumns, ...personColumns, 'match', ...coderColumns];
      } else {
        this.displayedColumns = [...baseColumns, ...personColumns, 'match'];
      }
    }
  }

  calculateStatistics(): void {
    const data = this.comparisonMode === 'between-trainings' ? this.comparisonData : this.withinTrainingData;
    const total = data.length;
    const matching = data.filter(item => this.areCodesTheSame(item)).length;
    this.totalComparisons = total;
    this.matchingComparisons = matching;
    this.matchingPercentage = total > 0 ? Math.round((matching / total) * 100) : 0;
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
          this.withinTrainingData = data.filter(d => this.hasAnyCode(d)).map(item => ({
            unitName: item.unitName,
            variableId: item.variableId,
            testperson: item.testPerson,
            personLogin: item.personLogin,
            personCode: item.personCode,
            personGroup: item.personGroup,
            coders: item.coders
          }));

          // Extract available coders from the first data item (assuming all items have same coders structure)
          if (this.withinTrainingData.length > 0) {
            this.availableCoders = this.withinTrainingData[0].coders.map(c => ({
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

          this.dataSource.data = this.withinTrainingData;
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
      codes = comparison.trainings.map(t => t.code);
    } else {
      codes = comparison.coders.map(c => c.code);
    }
    if (codes.length === 0) return true;
    const first = codes[0];
    return codes.every(code => code === first);
  }

  hasAnyCode(comparison: TrainingComparison | WithinTrainingComparison): boolean {
    let codes: (string | null)[];
    if ('trainings' in comparison) {
      codes = comparison.trainings.map(t => t.code);
    } else {
      codes = comparison.coders.map(c => c.code);
    }
    return codes.some(c => c !== null);
  }

  loadKappaStatistics(): void {
    if (this.comparisonMode !== 'within-training' || !this.selectedTrainingForWithin) {
      return;
    }

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
          this.kappaStatistics = stats;
          this.calculateMeanAgreement();
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('coding.trainings.kappa.error'),
            this.translate.instant('common.close'),
            { duration: 3000 }
          );
        }
      });
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
    this.useWeightedMean = !this.useWeightedMean;
    this.loadKappaStatistics();
  }

  toggleCalculationLevel(): void {
    this.useCodeLevel = !this.useCodeLevel;
    this.loadKappaStatistics();
  }
}
