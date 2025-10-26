import {
  Component, Inject, inject, OnInit,
  ViewChild
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
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
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';

import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../../services/backend.service';
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
    MatSelectModule
  ]
})
export class CodingResultsComparisonComponent implements OnInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);

  isLoading = false;
  dataSource = new MatTableDataSource<TrainingComparison | WithinTrainingComparison>([]);
  displayedColumns: string[] = ['unitName', 'variableId', 'testperson', 'match'];
  availableTrainings: CoderTraining[] = [];
  selectedTrainings = new SelectionModel<number>(true, []);
  comparisonData: TrainingComparison[] = [];
  withinTrainingData: WithinTrainingComparison[] = [];
  comparisonMode: 'between-trainings' | 'within-training' = 'between-trainings';
  selectedTrainingForWithin: number | null = null;

  totalComparisons = 0;
  matchingComparisons = 0;
  matchingPercentage = 0;

  constructor(
    public dialogRef: MatDialogRef<CodingResultsComparisonComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { workspaceId: number; selectedTraining?: CoderTraining },
    private paginatorIntl: MatPaginatorIntl
  ) {
    this.paginatorIntl.itemsPerPageLabel = 'Einträge pro Seite:';
    this.paginatorIntl.nextPageLabel = 'Nächste Seite';
    this.paginatorIntl.previousPageLabel = 'Vorherige Seite';
    this.paginatorIntl.firstPageLabel = 'Erste Seite';
    this.paginatorIntl.lastPageLabel = 'Letzte Seite';
    this.paginatorIntl.getRangeLabel = (page: number, pageSize: number, length: number) => {
      if (length === 0 || pageSize === 0) {
        return `0 von ${length}`;
      }
      const effectiveLength = Math.max(length, 0);
      const startIndex = page * pageSize;
      const endIndex = startIndex < effectiveLength ? Math.min(startIndex + pageSize, effectiveLength) : startIndex + pageSize;
      return `${startIndex + 1} - ${endIndex} von ${effectiveLength}`;
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

      this.backendService.getCoderTrainings(workspaceId).subscribe({
        next: trainings => {
          this.availableTrainings = trainings;
          resolve();
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Kodierer-Schulungen', 'Schließen', { duration: 3000 });
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
    this.updateDisplayedColumns();
  }

  onTrainingForWithinChange(): void {
    this.updateDisplayedColumns();
  }

  private updateDisplayedColumns(): void {
    const baseColumns = ['unitName', 'variableId', 'testperson', 'match'];

    if (this.comparisonMode === 'between-trainings') {
      const trainingColumns = this.selectedTrainings.selected.map(trainingId => {
        const training = this.availableTrainings.find(t => t.id === trainingId);
        return training ? `training_${trainingId}` : '';
      }).filter(col => col);
      this.displayedColumns = [...baseColumns, ...trainingColumns];
    } else if (this.comparisonMode === 'within-training') {
      if (this.selectedTrainingForWithin && this.withinTrainingData.length > 0) {
        const coderColumns = this.withinTrainingData[0].coders.map(coder => `coder_${coder.jobId}`);
        this.displayedColumns = [...baseColumns, ...coderColumns];
      } else {
        this.displayedColumns = baseColumns;
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
        this.snackBar.open('Bitte wählen Sie mindestens 2 Schulungen zum Vergleich aus', 'Schließen', { duration: 3000 });
        return;
      }

      this.isLoading = true;
      const trainingIds = this.selectedTrainings.selected.join(',');
      this.backendService.compareTrainingCodingResults(this.data.workspaceId, trainingIds).subscribe({
        next: data => {
          this.comparisonData = data.filter(d => this.hasAnyCode(d));
          this.dataSource.data = this.comparisonData;
          this.updateDisplayedColumns();
          this.calculateStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Vergleichsdaten', 'Schließen', { duration: 3000 });
          this.isLoading = false;
        }
      });
    } else if (this.comparisonMode === 'within-training') {
      if (!this.selectedTrainingForWithin) {
        this.snackBar.open('Bitte wählen Sie eine Schulung aus', 'Schließen', { duration: 3000 });
        return;
      }

      this.isLoading = true;
      this.backendService.compareWithinTrainingCodingResults(this.data.workspaceId, this.selectedTrainingForWithin).subscribe({
        next: data => {
          this.withinTrainingData = data.filter(d => this.hasAnyCode(d)).map(item => ({
            unitName: item.unitName,
            variableId: item.variableId,
            testperson: item.testPerson,
            coders: item.coders
          }));
          this.dataSource.data = this.withinTrainingData;
          this.updateDisplayedColumns();
          this.calculateStatistics();
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Vergleichsdaten', 'Schließen', { duration: 3000 });
          this.isLoading = false;
        }
      });
    }
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
    const res = codes.every(code => code === first);
    return res;
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
}
