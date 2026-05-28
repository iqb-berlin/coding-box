import {
  Component, Inject, OnInit, OnDestroy
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialog
} from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule, Sort } from '@angular/material/sort';
import {
  MatPaginatorModule,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import {
  VariableAnalysisService,
  JobCancelResult,
  VariableAnalysisResultPageDto,
  VariableAnalysisSortBy,
  VariableAnalysisSortDirection,
  VariableAnalysisTableRowDto
} from '../../../shared/services/response/variable-analysis.service';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';

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
      totalCount?: number;
      emptyCount?: number;
      emptyPercentage?: number;
      distinctValueCount?: number;
      statusCounts?: VariableStatusCount[];
    }[];
    frequencies: {
      [key: string]: {
        unitId?: number;
        unitName?: string;
        variableId: string;
        value: string;
        label?: string;
        score?: number;
        schemaOrder?: number;
        isSchemaOnly?: boolean;
        isSchemaSupplemental?: boolean;
        count: number;
        percentage: number;
      }[];
    };
    total: number;
    unfilteredTotal?: number;
    rows?: VariableAnalysisTableRowDto[];
    rowTotal?: number;
    pageableRowTotal?: number;
    unfilteredRowTotal?: number;
    maxPage?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  jobs?: VariableAnalysisJobDto[];
}

export interface VariableFrequency {
  unitId?: number;
  unitName?: string;
  variableid: string;
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  percentage: number;
}

export interface VariableStatusCount {
  status: number | string;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  totalCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  distinctValueCount?: number;
  statusCounts?: VariableStatusCount[];
}

interface VariableComboSummary {
  totalCount: number;
  emptyCount: number;
  emptyPercentage: number;
  statusSummary: string;
}

type VariableAnalysisExportFormat = 'csv' | 'xlsx';

@Component({
  selector: 'coding-box-variable-analysis-dialog',
  templateUrl: './variable-analysis-dialog.component.html',
  styleUrls: ['./variable-analysis-dialog.component.scss'],
  standalone: true,
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }],
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class VariableAnalysisDialogComponent implements OnInit, OnDestroy {
  private readonly responseStatusLabels: Record<number, string> = {
    0: 'UNSET',
    1: 'NOT_REACHED',
    2: 'DISPLAYED',
    3: 'VALUE_CHANGED',
    4: 'DERIVE_ERROR',
    5: 'CODING_COMPLETE',
    6: 'NO_CODING'
  };

  isLoading = false;
  variableFrequencies: { [key: string]: VariableFrequency[] } = {};
  displayedColumns: string[] = [
    'unitName',
    'variableId',
    'value',
    'label',
    'score',
    'count',
    'percentage',
    'totalCount',
    'emptyCount',
    'statusSummary',
    'metric'
  ];

  analysisRows: VariableAnalysisTableRowDto[] = [];

  private serverAnalysisRows: VariableAnalysisTableRowDto[] = [];

  allVariableCombos: VariableCombo[] = [];

  variableCombos: VariableCombo[] = [];

  searchText = '';
  onlyWithEmptyValues = false;
  includeSchemaCodes = false;
  isInfoVisible = false;
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | undefined;
  currentPage = 0;
  pageSize = 50;
  pageSizeOptions = [25, 50, 100, 200];
  totalFilteredVariables = 0;
  sortBy: VariableAnalysisSortBy = 'unitName';
  sortDirection: VariableAnalysisSortDirection = 'asc';
  private currentAnalysisJobId: number | string | undefined;
  private isUsingServerSideResults = false;
  private latestResultsRequestId = 0;
  private resultsLoadingSnackBar: { dismiss: () => void } | undefined;

  readonly MAX_VALUES_PER_VARIABLE = 20;

  isJobsLoading = false;
  jobs: VariableAnalysisJobDto[] = [];
  jobsDisplayedColumns: string[] = [
    'id',
    'status',
    'createdAt',
    'unitId',
    'variableId',
    'actions'
  ];

  activeJob: VariableAnalysisJobDto | undefined;
  private refreshSubscription: Subscription | undefined;
  private readonly POLLING_INTERVAL = 5000;
  private readonly ACTIVE_JOB_STATUSES = [
    'pending',
    'waiting',
    'processing'
  ] as const;

  isStartingJob = false;
  private hasAutoStarted = false;
  isInitializing = false;
  isExporting = false;

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisData,
    private variableAnalysisService: VariableAnalysisService,
    private snackBar: MatSnackBar,
    private translate: TranslateService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(searchText => {
        this.searchText = searchText;
        this.currentPage = 0;
        if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
          this.loadAnalysisResultsPage(this.currentAnalysisJobId);
          return;
        }
        this.filterVariables();
      });

    this.analyzeVariables();

    if (this.data.jobs) {
      this.isInitializing = false;
      this.applyJobs(this.data.jobs, true);
    } else {
      this.initialize();
    }
  }

  private initialize(): void {
    this.isInitializing = true;
    this.isJobsLoading = true;

    this.variableAnalysisService.getAllJobs(this.data.workspaceId).subscribe({
      next: (jobs: VariableAnalysisJobDto[]) => {
        this.isJobsLoading = false;
        this.isInitializing = false;
        this.applyJobs(jobs, true);
      },
      error: () => {
        this.isJobsLoading = false;
        this.isInitializing = false;
        this.updatePollingState();
      }
    });
  }

  private startPolling(): void {
    if (this.refreshSubscription || (!this.activeJob && !this.isStartingJob)) {
      return;
    }

    this.refreshSubscription = timer(
      this.POLLING_INTERVAL,
      this.POLLING_INTERVAL
    ).subscribe(() => this.refreshJobs(false));
  }

  private stopPolling(): void {
    this.refreshSubscription?.unsubscribe();
    this.refreshSubscription = undefined;
  }

  private updatePollingState(): void {
    if (this.activeJob || this.isStartingJob) {
      this.startPolling();
      return;
    }

    this.stopPolling();
  }

  private isActiveJob(job: VariableAnalysisJobDto): boolean {
    return this.ACTIVE_JOB_STATUSES.some(status => status === job.status);
  }

  private applyJobs(
    jobs: VariableAnalysisJobDto[],
    autoStartIfEmpty = false
  ): void {
    const previousActiveJob = this.activeJob;
    this.jobs = jobs.filter(job => job.type === 'variable-analysis');
    this.activeJob = this.jobs.find(job => this.isActiveJob(job));

    if (previousActiveJob && !this.activeJob) {
      const justCompletedJob = this.jobs.find(
        job => job.id === previousActiveJob.id && job.status === 'completed'
      );
      if (justCompletedJob) {
        this.viewJobResults(justCompletedJob.id);
      }
    } else if (this.shouldLoadAnalysisResult()) {
      const latestCompletedJob = this.jobs.find(
        job => job.status === 'completed'
      );
      if (latestCompletedJob) {
        this.viewJobResults(latestCompletedJob.id);
      }
    }

    if (
      autoStartIfEmpty &&
      this.jobs.length === 0 &&
      !this.isLoading &&
      !this.isStartingJob &&
      !this.hasAutoStarted
    ) {
      this.startNewAnalysis();
      return;
    }

    this.updatePollingState();
  }

  private shouldLoadAnalysisResult(): boolean {
    return (
      !this.currentAnalysisJobId &&
      (!this.data.analysisResults ||
        this.data.analysisResults.variableCombos.length === 0)
    );
  }

  analyzeVariables(): void {
    this.isLoading = true;
    this.variableFrequencies = {};
    this.serverAnalysisRows = [];

    if (this.data.analysisResults) {
      Object.keys(this.data.analysisResults!.frequencies).forEach(
        comboKey => {
          const firstFreq = this.data.analysisResults!.frequencies[comboKey][0];
          if (firstFreq) {
            const newComboKey = `${firstFreq.unitId ?? 0}:${firstFreq.variableId}`;
            this.variableFrequencies[newComboKey] =
              this.data.analysisResults!.frequencies[comboKey].map(freq => ({
                unitName: freq.unitName,
                variableid: freq.variableId,
                value: freq.value,
                label: freq.label,
                score: freq.score,
                schemaOrder: freq.schemaOrder,
                isSchemaOnly: freq.isSchemaOnly,
                isSchemaSupplemental: freq.isSchemaSupplemental,
                count: freq.count,
                percentage: freq.percentage
              }));
          }
        }
      );
      this.allVariableCombos = this.data.analysisResults!.variableCombos.map(
        combo => this.withDerivedSummary(combo)
      );
      this.serverAnalysisRows = this.data.analysisResults!.rows ||
        this.createRowsFromCombos(this.allVariableCombos);
      this.totalFilteredVariables = this.isUsingServerSideResults ?
        this.data.analysisResults!.pageableRowTotal ??
          this.data.analysisResults!.rowTotal ??
          this.serverAnalysisRows.length :
        this.allVariableCombos.length;
    } else if (this.data.responses && this.data.responses.length > 0) {
      const responsesByVariable: { [key: string]: { [key: string]: number } } =
        {};
      const comboSummaries = new Map<string, VariableCombo>();

      const variableIds = Array.from(
        new Set(this.data.responses.map(r => r.variableid))
      );
      this.allVariableCombos = variableIds.map(variableId => ({
        unitId: 0,
        unitName: 'Unknown',
        variableId,
        totalCount: 0,
        emptyCount: 0,
        emptyPercentage: 0,
        distinctValueCount: 0,
        statusCounts: []
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

        const comboKey = `0:${response.variableid}`;
        const summary = comboSummaries.get(comboKey) || {
          unitId: 0,
          unitName: 'Unknown',
          variableId: response.variableid,
          totalCount: 0,
          emptyCount: 0,
          emptyPercentage: 0,
          distinctValueCount: 0,
          statusCounts: []
        };
        summary.totalCount = (summary.totalCount || 0) + 1;
        if (value === '') {
          summary.emptyCount = (summary.emptyCount || 0) + 1;
        }

        const status = response.status;
        const statusCounts = summary.statusCounts || [];
        const existingStatus = statusCounts.find(
          item => item.status === status
        );
        if (existingStatus) {
          existingStatus.count += 1;
        } else {
          statusCounts.push({ status, count: 1, percentage: 0 });
        }
        summary.statusCounts = statusCounts;
        comboSummaries.set(comboKey, summary);
      });

      Object.keys(responsesByVariable).forEach(variableid => {
        const valueMap = responsesByVariable[variableid];
        const totalResponses = Object.values(valueMap).reduce(
          (sum, count) => sum + count,
          0
        );
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
      this.allVariableCombos = this.allVariableCombos.map(combo => {
        const comboKey = this.getComboKey(combo);
        const summary = comboSummaries.get(comboKey) || combo;
        const totalCount = summary.totalCount || 0;
        const emptyCount = summary.emptyCount || 0;
        return {
          ...summary,
          emptyPercentage: totalCount > 0 ? (emptyCount / totalCount) * 100 : 0,
          distinctValueCount: Object.keys(
            responsesByVariable[combo.variableId] || {}
          ).length,
          statusCounts: (summary.statusCounts || [])
            .map(item => ({
              ...item,
              percentage: totalCount > 0 ? (item.count / totalCount) * 100 : 0
            }))
            .sort((a, b) => b.count - a.count)
        };
      });
      this.totalFilteredVariables = this.allVariableCombos.length;
    } else {
      this.allVariableCombos = [];
      this.analysisRows = [];
      this.totalFilteredVariables = 0;
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

  private withDerivedSummary(combo: VariableCombo): VariableCombo {
    const frequencies = this.variableFrequencies[this.getComboKey(combo)] || [];
    const totalCount =
      combo.totalCount ??
      frequencies.reduce((sum, item) => sum + item.count, 0);
    const emptyCount =
      combo.emptyCount ??
      frequencies
        .filter(item => item.value === '')
        .reduce((sum, item) => sum + item.count, 0);

    return {
      ...combo,
      totalCount,
      emptyCount,
      emptyPercentage:
        combo.emptyPercentage ??
        (totalCount > 0 ? (emptyCount / totalCount) * 100 : 0),
      distinctValueCount: combo.distinctValueCount ?? frequencies.length,
      statusCounts: combo.statusCounts || []
    };
  }

  getComboSummary(combo: VariableCombo): VariableComboSummary {
    const frequencies = this.variableFrequencies[this.getComboKey(combo)] || [];
    const totalCount =
      combo.totalCount ??
      frequencies.reduce((sum, item) => sum + item.count, 0);
    const emptyCount =
      combo.emptyCount ??
      frequencies
        .filter(item => item.value === '')
        .reduce((sum, item) => sum + item.count, 0);
    const emptyPercentage =
      combo.emptyPercentage ??
      (totalCount > 0 ? (emptyCount / totalCount) * 100 : 0);

    return {
      totalCount,
      emptyCount,
      emptyPercentage,
      statusSummary: this.getStatusSummary(combo.statusCounts || [])
    };
  }

  formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private getStatusSummary(statusCounts: VariableStatusCount[]): string {
    if (!statusCounts.length) {
      return this.translate.instant('variable-analysis.no-status-data');
    }

    const visibleItems = statusCounts.slice(0, 3).map(item => {
      const status = this.getStatusLabel(item.status);
      return `${status}: ${item.count} (${this.formatPercentage(item.percentage)})`;
    });
    const remainingCount = statusCounts.length - visibleItems.length;

    return remainingCount > 0 ?
      `${visibleItems.join(', ')} +${remainingCount}` :
      visibleItems.join(', ');
  }

  getStatusLabel(status: number | string): string {
    return typeof status === 'number' ?
      this.responseStatusLabels[status] || status.toString() :
      status;
  }

  getVisibleStatusCounts(combo: VariableCombo): VariableStatusCount[] {
    return (combo.statusCounts || []).slice(0, 3);
  }

  getHiddenValueCount(combo: VariableCombo): number {
    const frequencies = this.variableFrequencies[this.getComboKey(combo)] || [];
    const distinctValueCount = combo.distinctValueCount ?? frequencies.length;
    const displayedObservedValueCount = frequencies.filter(
      item => !item.isSchemaOnly
    ).length;
    return Math.max(0, distinctValueCount - displayedObservedValueCount);
  }

  private getFilteredCombos(): VariableCombo[] {
    const normalizedSearchText = this.searchText.toLowerCase();
    let filteredCombos = this.allVariableCombos;

    if (normalizedSearchText) {
      filteredCombos = this.allVariableCombos.filter(
        combo => combo.unitName.toLowerCase().includes(normalizedSearchText) ||
          combo.variableId.toLowerCase().includes(normalizedSearchText)
      );
    }

    if (this.onlyWithEmptyValues) {
      filteredCombos = filteredCombos.filter(
        combo => this.getComboSummary(combo).emptyCount > 0
      );
    }

    return filteredCombos;
  }

  filterVariables(): void {
    if (this.isUsingServerSideResults) {
      this.variableCombos = this.allVariableCombos;
      this.analysisRows = this.serverAnalysisRows;
      return;
    }

    const filteredRows = this.getFilteredRows();
    const startIndex = this.currentPage * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.analysisRows = filteredRows.slice(startIndex, endIndex);
    this.variableCombos = this.getCombosForRows(this.analysisRows);
  }

  onSearchChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }

  clearSearch(): void {
    this.searchText = '';
    this.currentPage = 0;
    if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
      this.loadAnalysisResultsPage(this.currentAnalysisJobId);
      return;
    }
    this.filterVariables();
  }

  onEmptyValuesFilterChange(): void {
    this.currentPage = 0;
    if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
      this.loadAnalysisResultsPage(this.currentAnalysisJobId);
      return;
    }
    this.filterVariables();
  }

  onSchemaCodesToggleChange(): void {
    this.currentPage = 0;
    if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
      this.loadAnalysisResultsPage(this.currentAnalysisJobId);
      return;
    }
    this.filterVariables();
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
      this.loadAnalysisResultsPage(this.currentAnalysisJobId);
      return;
    }
    this.filterVariables();
  }

  onSortChange(sort: Sort): void {
    this.sortBy = this.isSupportedSortBy(sort.active) ?
      sort.active :
      'unitName';
    this.sortDirection = sort.direction === 'desc' ? 'desc' : 'asc';
    this.currentPage = 0;

    if (this.currentAnalysisJobId && this.isUsingServerSideResults) {
      this.loadAnalysisResultsPage(this.currentAnalysisJobId);
      return;
    }

    this.filterVariables();
  }

  getTotalFilteredVariables(): number {
    if (this.isUsingServerSideResults) {
      return this.totalFilteredVariables;
    }
    return this.getFilteredRows().length;
  }

  hasLimitedPageableRows(): boolean {
    const rowTotal = this.data.analysisResults?.rowTotal;
    const pageableRowTotal = this.data.analysisResults?.pageableRowTotal;
    return Boolean(
      this.isUsingServerSideResults &&
        rowTotal !== undefined &&
        pageableRowTotal !== undefined &&
        rowTotal > pageableRowTotal
    );
  }

  getPageableRowLimitInfoParams(): {
    pageable: number;
    total: number;
    maxPage: number;
  } {
    return {
      pageable: this.data.analysisResults?.pageableRowTotal ?? 0,
      total: this.data.analysisResults?.rowTotal ?? 0,
      maxPage: this.data.analysisResults?.maxPage ?? 0
    };
  }

  getMetricValue(row: VariableAnalysisTableRowDto): number | null {
    return row.pointBiserial ?? row.codePbc ?? row.categoryPbc ?? null;
  }

  formatMetric(row: VariableAnalysisTableRowDto): string {
    const metric = this.getMetricValue(row);
    return metric === null ? '-' : metric.toFixed(3);
  }

  formatOptionalNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '-' : value.toString();
  }

  getEmptyStateMessageKey(): string {
    return this.hasLoadedAnalysisContext() ?
      'variable-analysis.no-variables-found' :
      'variable-analysis.no-results-yet';
  }

  shouldShowStartAnalysisButton(): boolean {
    return (
      !this.hasLoadedAnalysisContext() &&
      !this.activeJob &&
      !this.isStartingJob
    );
  }

  private hasLoadedAnalysisContext(): boolean {
    return Boolean(
      this.currentAnalysisJobId ||
        this.data.analysisResults ||
        this.allVariableCombos.length > 0
    );
  }

  onClose(): void {
    this.dialogRef.close();
  }

  refreshJobs(showError = true): void {
    if (this.isStartingJob || this.isInitializing) return;
    this.isJobsLoading = showError;

    this.variableAnalysisService.getAllJobs(this.data.workspaceId).subscribe({
      next: (jobs: VariableAnalysisJobDto[]) => {
        this.isJobsLoading = false;
        this.applyJobs(jobs);
      },
      error: () => {
        if (showError) {
          this.snackBar.open(
            this.translate.instant('variable-analysis.error-loading-jobs'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
        this.isJobsLoading = false;
        this.updatePollingState();
      }
    });
  }

  startNewAnalysis(): void {
    if (this.isStartingJob || this.activeJob) return;
    this.isStartingJob = true;
    this.hasAutoStarted = true;
    this.isJobsLoading = true;
    const loadingSnackBar = this.snackBar.open(
      this.translate.instant('variable-analysis.starting-analysis'),
      '',
      { duration: 3000 }
    );

    this.variableAnalysisService
      .createAnalysisJob(
        this.data.workspaceId,
        this.data.unitId // Optional unit ID, may be undefined
      )
      .subscribe({
        next: (job: VariableAnalysisJobDto) => {
          this.isStartingJob = false;
          this.isJobsLoading = false; // Reset loading flag here too
          loadingSnackBar.dismiss();
          this.snackBar.open(
            this.translate.instant('variable-analysis.analysis-started', {
              jobId: job.id
            }),
            'OK',
            { duration: 5000 }
          );
          this.refreshJobs();
        },
        error: error => {
          this.isStartingJob = false;
          loadingSnackBar.dismiss();
          const errorMessage = error?.error?.message || error?.message || '';
          this.snackBar.open(
            `${this.translate.instant('variable-analysis.error-starting-analysis')}${errorMessage ? `: ${errorMessage}` : ''}`,
            this.translate.instant('error'),
            { duration: 5000 }
          );
          this.isJobsLoading = false;
          this.updatePollingState();
        }
      });
  }

  cancelJob(jobId: number | string): void {
    this.isJobsLoading = true;
    this.variableAnalysisService
      .cancelJob(this.data.workspaceId, jobId)
      .subscribe({
        next: (result: JobCancelResult) => {
          if (result.success) {
            if (jobId === this.currentAnalysisJobId) {
              this.clearCurrentAnalysisResults();
            }
            this.snackBar.open(
              result.message ||
                this.translate.instant('variable-analysis.job-cancelled'),
              'OK',
              { duration: 3000 }
            );
            this.refreshJobs();
          } else {
            this.snackBar.open(
              result.message ||
                this.translate.instant(
                  'variable-analysis.error-cancelling-job'
                ),
              this.translate.instant('error'),
              { duration: 3000 }
            );
            this.isJobsLoading = false;
          }
        },
        error: error => {
          const errorMessage = error?.error?.message || error?.message || '';
          this.snackBar.open(
            `${this.translate.instant('variable-analysis.error-cancelling-job')}${errorMessage ? `: ${errorMessage}` : ''}`,
            this.translate.instant('error'),
            { duration: 5000 }
          );
          this.isJobsLoading = false;
        }
      });
  }

  deleteJob(jobId: number | string): void {
    const dialogData: ConfirmDialogData = {
      title: this.translate.instant('workspace.please-confirm'),
      content: this.translate.instant('variable-analysis.confirm-delete-job'),
      confirmButtonLabel: this.translate.instant(
        'variable-analysis.delete-job'
      ),
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
      this.variableAnalysisService
        .deleteJob(this.data.workspaceId, jobId)
        .subscribe({
          next: (result: JobCancelResult) => {
            if (result.success) {
              if (jobId === this.currentAnalysisJobId) {
                this.clearCurrentAnalysisResults();
              }
              this.snackBar.open(
                result.message ||
                  this.translate.instant('variable-analysis.job-deleted'),
                'OK',
                { duration: 3000 }
              );
              this.refreshJobs();
            } else {
              this.snackBar.open(
                result.message ||
                  this.translate.instant(
                    'variable-analysis.error-deleting-job'
                  ),
                this.translate.instant('error'),
                { duration: 3000 }
              );
              this.isJobsLoading = false;
            }
          },
          error: error => {
            const errorMessage = error?.error?.message || error?.message || '';
            this.snackBar.open(
              `${this.translate.instant('variable-analysis.error-deleting-job')}${errorMessage ? `: ${errorMessage}` : ''}`,
              this.translate.instant('error'),
              { duration: 5000 }
            );
            this.isJobsLoading = false;
          }
        });
    });
  }

  deleteAllJobs(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('variable-analysis.delete-all-jobs'),
        content: this.translate.instant(
          'variable-analysis.confirm-delete-all-jobs'
        ),
        confirmButtonLabel: this.translate.instant(
          'variable-analysis.delete-all-jobs'
        ),
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isJobsLoading = true;
        this.variableAnalysisService
          .deleteAllJobs(this.data.workspaceId)
          .subscribe({
            next: () => {
              this.snackBar.open(
                this.translate.instant('variable-analysis.all-jobs-deleted'),
                'OK',
                { duration: 3000 }
              );
              this.jobs = [];
              this.activeJob = undefined;
              this.clearCurrentAnalysisResults();
              this.isJobsLoading = false;
              this.updatePollingState();
              this.refreshJobs();
            },
            error: error => {
              this.isJobsLoading = false;
              const errorMessage =
                error?.error?.message || error?.message || '';
              this.snackBar.open(
                `${this.translate.instant('variable-analysis.error-deleting-all-jobs')}${errorMessage ? `: ${errorMessage}` : ''}`,
                this.translate.instant('error'),
                { duration: 5000 }
              );
            }
          });
      }
    });
  }

  viewJobResults(jobId: number | string): void {
    this.currentAnalysisJobId = jobId;
    this.currentPage = 0;
    this.isUsingServerSideResults = true;
    this.loadAnalysisResultsPage(jobId, true);
  }

  canExportAnalysisResults(): boolean {
    return Boolean(
      this.currentAnalysisJobId &&
        this.isUsingServerSideResults &&
        !this.isLoading &&
        !this.isExporting
    );
  }

  downloadAnalysisResults(format: VariableAnalysisExportFormat): void {
    const jobId = this.currentAnalysisJobId;
    if (!jobId || this.isExporting) {
      return;
    }

    this.isExporting = true;
    const options = {
      search: this.searchText.trim() || undefined,
      onlyEmpty: this.onlyWithEmptyValues,
      includeSchemaCodes: this.includeSchemaCodes
    };
    const request = format === 'csv' ?
      this.variableAnalysisService.exportAnalysisResultsAsCsv(
        this.data.workspaceId,
        jobId,
        options
      ) :
      this.variableAnalysisService.exportAnalysisResultsAsXlsx(
        this.data.workspaceId,
        jobId,
        options
      );

    request.subscribe({
      next: blob => {
        this.saveBlob(blob, this.createExportFileName(format));
        this.isExporting = false;
        this.snackBar.open(
          this.translate.instant('variable-analysis.export-success'),
          'OK',
          { duration: 3000 }
        );
      },
      error: error => {
        this.isExporting = false;
        const errorMessage = error?.error?.message || error?.message || '';
        this.snackBar.open(
          `${this.translate.instant('variable-analysis.export-error')}${errorMessage ? `: ${errorMessage}` : ''}`,
          this.translate.instant('error'),
          { duration: 5000 }
        );
      }
    });
  }

  private createExportFileName(format: VariableAnalysisExportFormat): string {
    const date = new Date().toISOString().slice(0, 10);
    return `variable-analysis-${this.data.workspaceId}-${date}.${format}`;
  }

  private saveBlob(blob: Blob, fileName: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }

  private loadAnalysisResultsPage(
    jobId: number | string,
    showLoadingMessage = false
  ): void {
    this.latestResultsRequestId += 1;
    const requestId = this.latestResultsRequestId;
    this.isLoading = true;
    this.dismissTrackedResultsLoadingSnackBar();
    const loadingSnackBar = showLoadingMessage ?
      this.snackBar.open(
        this.translate.instant('variable-analysis.loading-results'),
        '',
        { duration: undefined }
      ) :
      undefined;
    this.resultsLoadingSnackBar = loadingSnackBar;

    this.variableAnalysisService
      .getAnalysisResultsPage(this.data.workspaceId, jobId, {
        page: this.currentPage + 1,
        pageSize: this.pageSize,
        search: this.searchText,
        onlyEmpty: this.onlyWithEmptyValues,
        includeSchemaCodes: this.includeSchemaCodes,
        sortBy: this.sortBy,
        sortDirection: this.sortDirection
      })
      .subscribe({
        next: (results: VariableAnalysisResultPageDto) => {
          if (requestId !== this.latestResultsRequestId) {
            this.dismissResultsLoadingSnackBar(loadingSnackBar);
            return;
          }

          this.dismissResultsLoadingSnackBar(loadingSnackBar);
          this.isLoading = false;
          this.data.analysisResults = results;
          this.totalFilteredVariables = results.total;
          this.pageSize = results.pageSize;
          this.currentPage = Math.max(0, results.page - 1);
          this.analyzeVariables();
        },
        error: () => {
          if (requestId !== this.latestResultsRequestId) {
            this.dismissResultsLoadingSnackBar(loadingSnackBar);
            return;
          }

          this.dismissResultsLoadingSnackBar(loadingSnackBar);
          this.isLoading = false;
          this.snackBar.open(
            this.translate.instant('variable-analysis.error-loading-results'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  private clearCurrentAnalysisResults(): void {
    this.latestResultsRequestId += 1;
    this.isLoading = false;
    this.dismissTrackedResultsLoadingSnackBar();
    this.currentAnalysisJobId = undefined;
    this.isUsingServerSideResults = false;
    this.data.analysisResults = undefined;
    this.variableFrequencies = {};
    this.allVariableCombos = [];
    this.variableCombos = [];
    this.analysisRows = [];
    this.serverAnalysisRows = [];
    this.totalFilteredVariables = 0;
    this.currentPage = 0;
  }

  private dismissTrackedResultsLoadingSnackBar(): void {
    this.resultsLoadingSnackBar?.dismiss();
    this.resultsLoadingSnackBar = undefined;
  }

  private dismissResultsLoadingSnackBar(
    snackBar: { dismiss: () => void } | undefined
  ): void {
    snackBar?.dismiss();
    if (snackBar === this.resultsLoadingSnackBar) {
      this.resultsLoadingSnackBar = undefined;
    }
  }

  formatDate(date: Date): string {
    if (!date) return '';
    return new Date(date).toLocaleString();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.searchSubscription?.unsubscribe();
  }

  getTranslatedStatus(status: string): string {
    const translationKey = `variable-analysis.status-${status}`;
    return this.translate.instant(translationKey);
  }

  private getFilteredRows(): VariableAnalysisTableRowDto[] {
    return this.sortRows(this.createRowsFromCombos(this.getFilteredCombos()));
  }

  private createRowsFromCombos(
    combos: VariableCombo[]
  ): VariableAnalysisTableRowDto[] {
    return combos.flatMap(combo => {
      const comboKey = this.getComboKey(combo);
      const frequencies = this.variableFrequencies[comboKey] || [];
      const summary = this.getComboSummary(combo);
      const distinctValueCount = combo.distinctValueCount ?? frequencies.length;
      const displayedObservedValueCount = frequencies.filter(
        item => !item.isSchemaOnly
      ).length;
      const hiddenValueCount = Math.max(
        0,
        distinctValueCount - displayedObservedValueCount
      );

      return frequencies.map(frequency => ({
        unitId: combo.unitId,
        unitName: combo.unitName,
        variableId: combo.variableId,
        value: frequency.value,
        label: frequency.label,
        score: frequency.score,
        schemaOrder: frequency.schemaOrder,
        isSchemaOnly: frequency.isSchemaOnly,
        isSchemaSupplemental: frequency.isSchemaSupplemental,
        count: frequency.count,
        percentage: frequency.percentage,
        totalCount: summary.totalCount,
        emptyCount: summary.emptyCount,
        emptyPercentage: summary.emptyPercentage,
        distinctValueCount,
        hiddenValueCount,
        statusCounts: combo.statusCounts,
        statusSummary: summary.statusSummary
      }));
    });
  }

  private sortRows(
    rows: VariableAnalysisTableRowDto[]
  ): VariableAnalysisTableRowDto[] {
    return [...rows].sort((a, b) => this.compareRows(a, b));
  }

  private compareRows(
    a: VariableAnalysisTableRowDto,
    b: VariableAnalysisTableRowDto
  ): number {
    return this.compareSortValues(
      this.getSortValue(a, this.sortBy),
      this.getSortValue(b, this.sortBy)
    ) ||
      this.compareValues(a.unitName, b.unitName) ||
      this.compareValues(a.unitId, b.unitId) ||
      this.compareValues(a.variableId, b.variableId) ||
      this.compareValues(a.schemaOrder, b.schemaOrder) ||
      this.compareValues(a.value, b.value) ||
      this.compareValues(a.label, b.label);
  }

  private getSortValue(
    row: VariableAnalysisTableRowDto,
    sortBy: VariableAnalysisSortBy
  ): string | number | null | undefined {
    return row[sortBy];
  }

  private compareSortValues(
    a: string | number | null | undefined,
    b: string | number | null | undefined
  ): number {
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return 1;
    }
    if (b === null || b === undefined) {
      return -1;
    }

    const result = this.compareDefinedValues(a, b);
    return this.sortDirection === 'desc' ? -result : result;
  }

  private compareValues(
    a: string | number | null | undefined,
    b: string | number | null | undefined
  ): number {
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return 1;
    }
    if (b === null || b === undefined) {
      return -1;
    }
    return this.compareDefinedValues(a, b);
  }

  private compareDefinedValues(
    a: string | number,
    b: string | number
  ): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a).localeCompare(String(b), 'de', {
      numeric: true,
      sensitivity: 'base'
    });
  }

  private getCombosForRows(
    rows: VariableAnalysisTableRowDto[]
  ): VariableCombo[] {
    const comboByKey = new Map(
      this.allVariableCombos.map(combo => [this.getComboKey(combo), combo])
    );
    const seenKeys = new Set<string>();
    const combos: VariableCombo[] = [];

    rows.forEach(row => {
      const comboKey = this.getComboKey(row);
      if (seenKeys.has(comboKey)) {
        return;
      }
      const combo = comboByKey.get(comboKey);
      if (combo) {
        combos.push(combo);
        seenKeys.add(comboKey);
      }
    });

    return combos;
  }

  private isSupportedSortBy(sortBy: string): sortBy is VariableAnalysisSortBy {
    return [
      'unitName',
      'variableId',
      'value',
      'label',
      'score',
      'count',
      'percentage',
      'totalCount',
      'emptyCount',
      'emptyPercentage',
      'statusSummary'
    ].includes(sortBy);
  }
}
