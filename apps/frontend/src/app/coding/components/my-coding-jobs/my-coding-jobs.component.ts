import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
  Input,
  OnChanges,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  MatPaginator,
  MatPaginatorModule,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import {
  MatFormField,
  MatLabel,
  MatOption,
  MatSelect
} from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIconButton } from '@angular/material/button';
import { DatePipe, NgClass, NgFor } from '@angular/common';
import {
  debounceTime, distinctUntilChanged, forkJoin, Subject, Subscription
} from 'rxjs';
import { map } from 'rxjs/operators';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingJob, Variable } from '../../models/coding-job.model';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from '../../utils/replay-url.util';

@Component({
  selector: 'coding-box-my-coding-jobs',
  templateUrl: './my-coding-jobs.component.html',
  styleUrls: ['./my-coding-jobs.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    FormsModule,
    DatePipe,
    NgClass,
    NgFor,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatTable,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatPaginatorModule,
    MatIconButton,
    MatTooltipModule,
    MatFormField,
    MatLabel,
    MatInputModule,
    MatSelect,
    MatOption
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }]
})
export class MyCodingJobsComponent
implements OnInit, OnDestroy, OnChanges {
  appService = inject(AppService);
  codingJobBackendService = inject(CodingJobBackendService);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);
  private translateService = inject(TranslateService);

  displayedColumns: string[] = [
    'actions',
    'name',
    'description',
    'status',
    'variables',
    'variableBundles',
    'progress',
    'created_at',
    'updated_at'
  ];

  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;
  currentUserId = 0;
  isAuthorized = false;

  totalProgress = 0;
  totalCodedUnits = 0;
  totalUnits = 0;
  incompleteJobs = 0;
  completedJobs = 0;

  selectedStatus: string | null = null;
  selectedJobName: string | null = null;
  selectedWorkspaceIds: number[] = [];
  originalData: CodingJob[] = [];
  currentWorkspaces: WorkspaceFullDto[] = [];
  jobsTotal = 0;
  pageSize = 50;
  pageIndex = 0;
  serverPagingEnabled = false;
  private authWorkspaces: WorkspaceFullDto[] = [];
  private loadJobsSubscription?: Subscription;
  private jobNameFilterSubscription?: Subscription;
  private workspaceToggleInProgress = false;
  private workspaceSelectionInitialized = false;
  private paginator?: MatPaginator;
  private readonly jobNameFilterChanges = new Subject<string>();
  private readonly windowFocusReloadThrottleMs = 10000;
  private lastWindowFocusReloadAt = 0;

  @Input() workspaceId: number | null = null;

  @ViewChild(MatPaginator) set paginatorRef(
    paginator: MatPaginator | undefined
  ) {
    this.paginator = paginator;
    this.configureClientPaginator();
  }

  private handleWindowFocus = () => {
    if (!this.isAuthorized || this.isLoading) {
      return;
    }
    const now = Date.now();
    if (now - this.lastWindowFocusReloadAt < this.windowFocusReloadThrottleMs) {
      return;
    }
    this.lastWindowFocusReloadAt = now;
    if (this.authWorkspaces.length > 0) {
      this.loadMyCodingJobs(this.authWorkspaces);
    }
  };

  ngOnInit(): void {
    this.jobNameFilterSubscription = this.jobNameFilterChanges
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.reloadFirstPage());

    this.appService.authData$.subscribe(authData => {
      this.currentUserId = authData.userId;
      this.isAuthorized = true;
      if (authData.workspaces && authData.workspaces.length > 0) {
        this.authWorkspaces = authData.workspaces;
        this.loadMyCodingJobs(authData.workspaces);
      }
    });
    window.addEventListener('focus', this.handleWindowFocus);
  }

  ngOnChanges(): void {
    if (this.authWorkspaces.length > 0) {
      this.reloadFirstPage();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
    this.loadJobsSubscription?.unsubscribe();
    this.jobNameFilterSubscription?.unsubscribe();
  }

  loadMyCodingJobs(workspaces: [] | WorkspaceFullDto[]): void {
    const targetWorkspaces = this.getTargetWorkspaces(workspaces || []);
    this.currentWorkspaces = targetWorkspaces;
    this.isLoading = true;
    this.loadJobsSubscription?.unsubscribe();

    if (targetWorkspaces.length > 0) {
      if (this.shouldResetWorkspaceFilter()) {
        this.selectedWorkspaceIds = this.currentWorkspaces.map(ws => ws.id);
        this.workspaceSelectionInitialized = true;
      }
      const selectedWorkspaces = this.getSelectedWorkspaces();
      if (selectedWorkspaces.length === 0) {
        this.clearLoadedJobData();
        this.isLoading = false;
        return;
      }

      this.serverPagingEnabled = selectedWorkspaces.length === 1;
      this.configureClientPaginator();
      const workspaceJobsObservables = selectedWorkspaces.map(workspace => this.codingJobBackendService
        .getCodingJobs(
          workspace.id,
          this.serverPagingEnabled ? this.pageIndex + 1 : undefined,
          this.serverPagingEnabled ? this.pageSize : undefined,
          {
            assignedTo: 'me',
            status: this.selectedStatus || undefined,
            excludeStatus: this.selectedStatus ? undefined : 'review',
            jobName: this.normalizeJobNameFilter()
          }
        )
        .pipe(map(response => ({
          data: response.data,
          total: response.total ?? response.data.length
        })))
      );

      this.loadJobsSubscription = forkJoin(workspaceJobsObservables).subscribe({
        next: workspaceJobResponses => {
          const assignedJobs = workspaceJobResponses.flatMap(
            response => response.data
          );
          this.originalData = [...assignedJobs];
          this.dataSource.data = assignedJobs;
          this.jobsTotal = workspaceJobResponses.reduce(
            (sum, response) => sum + response.total,
            0
          );
          this.calculateTotalProgress(assignedJobs);
          this.isLoading = false;
          this.cdr.detectChanges();
          this.configureClientPaginator();
        },
        error: () => {
          const errorMessage = this.translateService.instant(
            'coding.my-coding-jobs.error-loading-jobs'
          );
          this.snackBar.open(
            errorMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.clearLoadedJobs();
          this.isLoading = false;
        }
      });
    } else {
      this.clearLoadedJobs();
      this.isLoading = false;
    }
  }

  private clearLoadedJobData(): void {
    this.dataSource.data = [];
    this.originalData = [];
    this.jobsTotal = 0;
    this.serverPagingEnabled = false;
    this.totalProgress = 0;
    this.totalCodedUnits = 0;
    this.totalUnits = 0;
    this.incompleteJobs = 0;
    this.completedJobs = 0;
    this.configureClientPaginator();
  }

  private clearLoadedJobs(): void {
    this.clearLoadedJobData();
    this.selectedWorkspaceIds = [];
    this.workspaceSelectionInitialized = false;
  }

  private configureClientPaginator(): void {
    this.dataSource.paginator = !this.serverPagingEnabled ?
      this.paginator ?? null :
      null;
  }

  private getTargetWorkspaces(
    workspaces: WorkspaceFullDto[]
  ): WorkspaceFullDto[] {
    if (!this.workspaceId) {
      return workspaces;
    }

    return workspaces.filter(workspace => workspace.id === this.workspaceId);
  }

  private getSelectedWorkspaces(): WorkspaceFullDto[] {
    const selectedWorkspaceIds = this.selectedWorkspaceIds.filter(
      id => id !== -1
    );
    return this.currentWorkspaces.filter(workspace => selectedWorkspaceIds.includes(workspace.id)
    );
  }

  private normalizeJobNameFilter(): string | undefined {
    const normalized = this.selectedJobName?.trim();
    return normalized || undefined;
  }

  private shouldResetWorkspaceFilter(): boolean {
    const currentWorkspaceIds = this.currentWorkspaces.map(
      workspace => workspace.id
    );
    const selectedWorkspaceIds = this.selectedWorkspaceIds.filter(
      workspaceId => workspaceId !== -1
    );
    return (
      !this.workspaceSelectionInitialized ||
      selectedWorkspaceIds.some(
        workspaceId => !currentWorkspaceIds.includes(workspaceId)
      )
    );
  }

  onStatusFilterChange(): void {
    this.reloadFirstPage();
  }

  onJobNameFilterChange(): void {
    this.jobNameFilterChanges.next(this.selectedJobName ?? '');
  }

  onWorkspaceFilterChange(): void {
    if (this.workspaceToggleInProgress) {
      return;
    }
    if (this.isAllWorkspacesSelected()) {
      if (!this.selectedWorkspaceIds.includes(-1)) {
        this.selectedWorkspaceIds = [...this.selectedWorkspaceIds, -1];
      }
    } else {
      this.selectedWorkspaceIds = this.selectedWorkspaceIds.filter(
        id => id !== -1
      );
    }
    this.reloadFirstPage();
  }

  isAllWorkspacesSelected(): boolean {
    if (this.currentWorkspaces.length === 0) return false;
    return this.currentWorkspaces.every(ws => this.selectedWorkspaceIds.includes(ws.id)
    );
  }

  toggleAllWorkspaces(): void {
    this.workspaceToggleInProgress = true;
    if (this.isAllWorkspacesSelected()) {
      this.selectedWorkspaceIds = [];
    } else {
      this.selectedWorkspaceIds = [
        ...this.currentWorkspaces.map(ws => ws.id),
        -1
      ];
    }
    this.reloadFirstPage();
    queueMicrotask(() => {
      this.workspaceToggleInProgress = false;
    });
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.selection.clear();
    if (this.serverPagingEnabled) {
      this.loadMyCodingJobs(this.authWorkspaces);
    }
  }

  private reloadFirstPage(): void {
    this.pageIndex = 0;
    this.selection.clear();
    this.loadMyCodingJobs(this.authWorkspaces);
  }

  selectRow(row: CodingJob): void {
    this.selection.toggle(row);
  }

  startCodingJob(job: CodingJob): void {
    const startingMessage = this.translateService.instant(
      'coding.my-coding-jobs.starting-job',
      { name: job.name }
    );
    const loadingSnack = this.snackBar.open(startingMessage, '', {
      duration: 3000
    });

    this.codingJobBackendService
      .startCodingJob(job.workspace_id, job.id)
      .subscribe({
        next: result => {
          loadingSnack.dismiss();
          if (!result || result.total === 0) {
            const noResponsesMessage = this.translateService.instant(
              'coding.my-coding-jobs.no-matching-responses'
            );
            this.snackBar.open(noResponsesMessage, 'Info', { duration: 3000 });
            return;
          }

          if (!result.firstReplayUrl) {
            const errorMessage = this.translateService.instant(
              'coding.my-coding-jobs.error-starting-job'
            );
            this.snackBar.open(
              errorMessage,
              this.translateService.instant('close'),
              { duration: 3000 }
            );
            return;
          }

          const replayUrl = appendReplayUrlParams(
            normalizeReplayUrlToCurrentOrigin(result.firstReplayUrl),
            {
              mode: 'coding',
              codingJobId: job.id,
              workspaceId: job.workspace_id
            }
          );

          window.open(replayUrl, '_blank');
          const preparedMessage = this.translateService.instant(
            'coding.my-coding-jobs.preparing-replay',
            { count: result.total }
          );
          this.snackBar.open(
            preparedMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        },
        error: () => {
          loadingSnack.dismiss();
          const errorMessage = this.translateService.instant(
            'coding.my-coding-jobs.error-starting-job'
          );
          this.snackBar.open(
            errorMessage,
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        }
      });
  }

  getStartCodingJobLabel(job: CodingJob): string {
    if (this.isFinishedJob(job)) {
      return 'Review öffnen';
    }

    return this.translateService.instant('coding.my-coding-jobs.start-coding');
  }

  getStartCodingJobIcon(job: CodingJob): string {
    if (this.isFinishedJob(job)) {
      return 'visibility';
    }

    return 'play_arrow';
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'completed':
        return 'status-completed';
      case 'results_applied':
        return 'status-results-applied';
      case 'pending':
        return 'status-pending';
      case 'paused':
        return 'status-paused';
      case 'open':
        return 'status-open';
      case 'review':
        return 'status-review';
      default:
        return '';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-active'
        );
      case 'completed':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-completed'
        );
      case 'results_applied':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-results-applied'
        );
      case 'pending':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-pending'
        );
      case 'paused':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-paused'
        );
      case 'open':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-open'
        );
      case 'review':
        return this.translateService.instant(
          'coding.my-coding-jobs.job-status-review'
        );
      default:
        return status;
    }
  }

  getVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      return this.formatAssignedVariables(job.assignedVariables);
    }
    if (job.variables && job.variables.length > 0) {
      return this.formatAssignedVariables(job.variables);
    }
    return this.translateService.instant('coding.my-coding-jobs.no-variables');
  }

  getVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const count = job.assignedVariableBundles.length;
      const maxToShow = 2;
      const bundleNames = job.assignedVariableBundles.map(
        b => b.name || this.translateService.instant('unknown')
      );

      if (bundleNames.length <= maxToShow) {
        return `${count} (${bundleNames.join(', ')})`;
      }

      const preview = bundleNames.slice(0, maxToShow).join(', ');
      return `${count} (${preview}, +${count - maxToShow} weitere)`;
    }

    return this.translateService.instant(
      'coding.my-coding-jobs.no-variable-bundles'
    );
  }

  getProgress(job: CodingJob): string {
    if (!job.totalUnits || job.totalUnits === 0) {
      return this.translateService.instant('coding.my-coding-jobs.no-tasks');
    }
    const progress = job.progress || 0;
    const coded = job.codedUnits || 0;
    const total = job.totalUnits;

    return `${progress}% (${coded}/${total})`;
  }

  private calculateTotalProgress(assignedJobs: CodingJob[]): void {
    const activeJobs = assignedJobs.filter(job => job.status !== 'review');
    this.totalCodedUnits = activeJobs.reduce(
      (sum, job) => sum + (job.codedUnits || 0),
      0
    );
    this.totalUnits = activeJobs.reduce(
      (sum, job) => sum + (job.totalUnits || 0),
      0
    );
    this.totalProgress =
      this.totalUnits > 0 ?
        Math.round((this.totalCodedUnits / this.totalUnits) * 100) :
        0;
    this.incompleteJobs = assignedJobs.filter(
      job => !this.isFinishedJob(job) && job.status !== 'review'
    ).length;
    this.completedJobs = assignedJobs.filter(job => this.isFinishedJob(job)
    ).length;
  }

  private isFinishedJob(job: CodingJob): boolean {
    return job.status === 'completed' || job.status === 'results_applied';
  }

  private formatAssignedVariables(assignedVariables: Variable[]): string {
    if (!assignedVariables || assignedVariables.length === 0) {
      return this.translateService.instant(
        'coding.my-coding-jobs.no-variables'
      );
    }

    const maxToShow = 3;
    const variableNames = assignedVariables.map(v => {
      const unitName = v.unitName || this.translateService.instant('unknown');
      const variableId =
        v.variableId || this.translateService.instant('unknown');
      return `${unitName}_${variableId}`;
    });

    if (variableNames.length <= maxToShow) {
      return variableNames.join(', ');
    }

    return `${variableNames.slice(0, maxToShow).join(', ')} +${variableNames.length - maxToShow} weitere`;
  }
}
