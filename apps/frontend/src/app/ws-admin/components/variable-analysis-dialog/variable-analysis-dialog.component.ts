import {
  Component, Inject, OnInit, OnDestroy
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { BackendService } from '../../../services/backend.service';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

export interface VariableAnalysisData {
  unitId: number;
  title: string;
  workspaceId: number;
  responses?: {
    id: number;
    unitid: number;
    variableid: string;
    status: string;
    value: string;
    subform: string;
    code?: number;
    score?: number;
    codedstatus?: string;
    expanded?: boolean;
  }[];
  analysisResults?: {
    variableCombos: {
      unitId: number;
      unitName: string;
      variableId: string;
    }[];
    frequencies: { [key: string]: {
      unitId?: number;
      unitName?: string;
      variableId: string;
      value: string;
      count: number;
      percentage: number;
    }[] };
    total: number;
  };
  jobs?: VariableAnalysisJobDto[];
}

export interface VariableFrequency {
  unitId?: number;
  unitName?: string;
  variableid: string;
  value: string;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
}

@Component({
  selector: 'coding-box-variable-analysis-dialog',
  templateUrl: './variable-analysis-dialog.component.html',
  styleUrls: ['./variable-analysis-dialog.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatInputModule,
    MatFormFieldModule,
    MatTabsModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class VariableAnalysisDialogComponent implements OnInit, OnDestroy {
  isLoading = false;
  variableFrequencies: { [key: string]: VariableFrequency[] } = {};
  displayedColumns: string[] = ['value', 'count', 'percentage'];

  allVariableCombos: VariableCombo[] = [];

  variableCombos: VariableCombo[] = [];

  searchText = '';
  private searchSubject = new Subject<string>();
  currentPage = 0;
  pageSize = 200;
  pageSizeOptions = [100, 200, 500, 1000];

  readonly MAX_VALUES_PER_VARIABLE = 20;

  isJobsLoading = false;
  jobs: VariableAnalysisJobDto[] = [];
  jobsDisplayedColumns: string[] = ['id', 'status', 'createdAt', 'unitId', 'variableId', 'actions'];

  private refreshSubscription: Subscription | undefined;
  private readonly POLLING_INTERVAL = 10000; // 10 seconds

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisData,
    private backendService: BackendService,
    private snackBar: MatSnackBar,
    private translate: TranslateService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(searchText => {
      this.searchText = searchText;
      this.filterVariables();
    });

    this.analyzeVariables();

    if (this.data.jobs) {
      this.jobs = this.data.jobs;
    } else {
      this.refreshJobs();
    }

    // Start automatic polling for job updates
    this.refreshSubscription = timer(0, this.POLLING_INTERVAL).subscribe(() => this.refreshJobs());
  }

  analyzeVariables(): void {
    this.isLoading = true;

    if (this.data.analysisResults) {
      this.allVariableCombos = this.data.analysisResults!.variableCombos;
      Object.keys(this.data.analysisResults!.frequencies).forEach(comboKey => {
        const firstFreq = this.data.analysisResults!.frequencies[comboKey][0];
        if (firstFreq) {
          const newComboKey = `${firstFreq.unitId ?? 0}:${firstFreq.variableId}`;
          this.variableFrequencies[newComboKey] = this.data.analysisResults!.frequencies[comboKey].map(freq => ({
            unitName: freq.unitName,
            variableid: freq.variableId,
            value: freq.value,
            count: freq.count,
            percentage: freq.percentage
          }));
        }
      });
    } else if (this.data.responses && this.data.responses.length > 0) {
      const responsesByVariable: { [key: string]: { [key: string]: number } } = {};

      const variableIds = Array.from(new Set(this.data.responses.map(r => r.variableid)));
      this.allVariableCombos = variableIds.map(variableId => ({
        unitId: 0,
        unitName: 'Unknown',
        variableId
      }));

      this.data.responses.forEach(response => {
        if (!responsesByVariable[response.variableid]) {
          responsesByVariable[response.variableid] = {};
        }

        const value = response.value || '';
        if (!responsesByVariable[response.variableid][value]) {
          responsesByVariable[response.variableid][value] = 0;
        }

        responsesByVariable[response.variableid][value] += 1;
      });

      Object.keys(responsesByVariable).forEach(variableid => {
        const valueMap = responsesByVariable[variableid];
        const totalResponses = Object.values(valueMap).reduce((sum, count) => sum + count, 0);
        const comboKey = `0:${variableid}`;
        this.variableFrequencies[comboKey] = Object.keys(valueMap)
          .map(value => {
            const count = valueMap[value];
            return {
              unitName: 'Unknown',
              variableid,
              value,
              count,
              percentage: (count / totalResponses) * 100
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, this.MAX_VALUES_PER_VARIABLE);
      });
    } else {
      this.allVariableCombos = [];
    }
    this.allVariableCombos.sort((a, b) => {
      if (a.unitName !== b.unitName) {
        return a.unitName.localeCompare(b.unitName);
      }
      return a.variableId.localeCompare(b.variableId);
    });

    this.filterVariables();

    this.isLoading = false;
  }

  getComboKey(combo: { unitId: number; variableId: string }): string {
    return `${combo.unitId}:${combo.variableId}`;
  }

  filterVariables(): void {
    const filteredCombos = this.searchText ?
      this.allVariableCombos.filter(combo => combo.unitName.toLowerCase().includes(this.searchText.toLowerCase()) ||
        combo.variableId.toLowerCase().includes(this.searchText.toLowerCase())) :
      this.allVariableCombos;

    const startIndex = this.currentPage * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.variableCombos = filteredCombos.slice(startIndex, endIndex);
  }

  onSearchChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.filterVariables();
  }

  getTotalFilteredVariables(): number {
    return this.searchText ?
      this.allVariableCombos.filter(combo => combo.unitName.toLowerCase().includes(this.searchText.toLowerCase()) ||
        combo.variableId.toLowerCase().includes(this.searchText.toLowerCase())).length :
      this.allVariableCombos.length;
  }

  onClose(): void {
    this.dialogRef.close();
  }

  refreshJobs(): void {
    this.isJobsLoading = true;
    this.backendService.getAllVariableAnalysisJobs(this.data.workspaceId)
      .subscribe({
        next: jobs => {
          this.jobs = jobs.filter(job => job.type === 'variable-analysis');
          this.isJobsLoading = false;
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('variable-analysis.error-loading-jobs'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
          this.isJobsLoading = false;
        }
      });
  }

  startNewAnalysis(): void {
    this.isJobsLoading = true;
    const loadingSnackBar = this.snackBar.open(
      this.translate.instant('variable-analysis.starting-analysis'),
      '',
      { duration: 3000 }
    );

    this.backendService.createVariableAnalysisJob(
      this.data.workspaceId,
      this.data.unitId // Optional unit ID, may be undefined
    ).subscribe({
      next: job => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          this.translate.instant('variable-analysis.analysis-started', { jobId: job.id }),
          'OK',
          { duration: 5000 }
        );
        this.refreshJobs();
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          this.translate.instant('variable-analysis.error-starting-analysis'),
          this.translate.instant('error'),
          { duration: 3000 }
        );
        this.isJobsLoading = false;
      }
    });
  }

  cancelJob(jobId: number): void {
    this.isJobsLoading = true;
    this.backendService.cancelVariableAnalysisJob(this.data.workspaceId, jobId)
      .subscribe({
        next: result => {
          if (result.success) {
            this.snackBar.open(
              result.message || this.translate.instant('variable-analysis.job-cancelled'),
              'OK',
              { duration: 3000 }
            );
            this.refreshJobs();
          } else {
            this.snackBar.open(
              result.message || this.translate.instant('variable-analysis.error-cancelling-job'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
            this.isJobsLoading = false;
          }
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('variable-analysis.error-cancelling-job'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
          this.isJobsLoading = false;
        }
      });
  }

  deleteJob(jobId: number): void {
    const dialogData: ConfirmDialogData = {
      title: this.translate.instant('workspace.please-confirm'),
      content: this.translate.instant('variable-analysis.confirm-delete-job'),
      confirmButtonLabel: this.translate.instant('variable-analysis.delete-job'),
      showCancel: true
    };

    const confirmRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: dialogData
    });

    confirmRef.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed) {
        return;
      }

      this.isJobsLoading = true;
      this.backendService.deleteVariableAnalysisJob(this.data.workspaceId, jobId)
        .subscribe({
          next: result => {
            if (result.success) {
              this.snackBar.open(
                result.message || this.translate.instant('variable-analysis.job-deleted'),
                'OK',
                { duration: 3000 }
              );
              this.refreshJobs();
            } else {
              this.snackBar.open(
                result.message || this.translate.instant('variable-analysis.error-deleting-job'),
                this.translate.instant('error'),
                { duration: 3000 }
              );
              this.isJobsLoading = false;
            }
          },
          error: () => {
            this.snackBar.open(
              this.translate.instant('variable-analysis.error-deleting-job'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
            this.isJobsLoading = false;
          }
        });
    });
  }

  viewJobResults(jobId: number): void {
    this.isLoading = true;
    const loadingSnackBar = this.snackBar.open(
      this.translate.instant('variable-analysis.loading-results'),
      '',
      { duration: undefined }
    );

    this.backendService.getVariableAnalysisResults(
      this.data.workspaceId,
      jobId
    ).subscribe({
      next: results => {
        loadingSnackBar.dismiss();
        this.isLoading = false;
        this.data.analysisResults = results;
        this.analyzeVariables();
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.isLoading = false;
        this.snackBar.open(
          this.translate.instant('variable-analysis.error-loading-results'),
          this.translate.instant('error'),
          { duration: 3000 }
        );
      }
    });
  }

  formatDate(date: Date): string {
    if (!date) return '';
    return new Date(date).toLocaleString();
  }

  ngOnDestroy(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }

  getTranslatedStatus(status: string): string {
    const translationKey = `variable-analysis.status-${status}`;
    return this.translate.instant(translationKey);
  }
}
