import {
  Component, OnInit, OnDestroy, ViewChild, AfterViewInit, inject, ChangeDetectorRef
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule, MatPaginatorIntl } from '@angular/material/paginator';
import {
  MatCell, MatCellDef, MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef,
  MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import {
  MatFormField, MatLabel, MatOption, MatSelect
} from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIconButton } from '@angular/material/button';
import { DatePipe, NgClass, NgFor } from '@angular/common';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingJob, Variable } from '../../models/coding-job.model';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';

@Component({
  selector: 'coding-box-my-coding-jobs',
  templateUrl: './my-coding-jobs.component.html',
  styleUrls: ['./my-coding-jobs.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
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
    MatSortModule,
    MatPaginatorModule,
    MatIconButton,
    MatTooltipModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption
  ],
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ]
})
export class MyCodingJobsComponent implements OnInit, AfterViewInit, OnDestroy {
  appService = inject(AppService);
  codingJobBackendService = inject(CodingJobBackendService);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);
  private translateService = inject(TranslateService);

  displayedColumns: string[] = ['actions', 'name', 'description', 'status', 'variables', 'variableBundles', 'progress', 'created_at', 'updated_at'];
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
  availableJobNames: string[] = [];
  currentWorkspaces: WorkspaceFullDto[] = [];

  @ViewChild(MatSort) set sort(sort: MatSort) {
    this.dataSource.sort = sort;
  }

  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) {
    this.dataSource.paginator = paginator;
  }

  private handleWindowFocus = () => {
    if (this.isAuthorized) {
      this.appService.authData$.subscribe(authData => {
        if (authData.workspaces && authData.workspaces.length > 0) {
          this.loadMyCodingJobs(authData.workspaces);
        }
      }).unsubscribe();
    }
  };

  ngOnInit(): void {
    this.dataSource.sortingDataAccessor = (item: CodingJob, property: string) => {
      switch (property) {
        case 'variables':
          return (item.assignedVariables?.length || item.variables?.length || 0);
        case 'variableBundles':
          return (item.assignedVariableBundles?.length || item.variableBundles?.length || 0);
        case 'progress':
          return item.progress || 0;
        case 'created_at':
          return item.created_at ? new Date(item.created_at).getTime() : 0;
        case 'updated_at':
          return item.updated_at ? new Date(item.updated_at).getTime() : 0;
        case 'status':
          return item.status;
        case 'name':
          return item.name.toLowerCase();
        case 'description':
          return (item.description || '').toLowerCase();
        default:
          return (item as unknown as Record<string, unknown>)[property] as string | number;
      }
    };

    this.appService.authData$.subscribe(authData => {
      this.currentUserId = authData.userId;
      this.isAuthorized = true;
      if (authData.workspaces && authData.workspaces.length > 0) {
        this.loadMyCodingJobs(authData.workspaces);
      }
    });
    window.addEventListener('focus', this.handleWindowFocus);
  }

  ngAfterViewInit(): void {
    // ViewChildren are handled via setters
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
  }

  loadMyCodingJobs(workspaces: [] | WorkspaceFullDto[]): void {
    this.currentWorkspaces = workspaces || [];
    this.isLoading = true;
    if (workspaces) {
      const workspaceJobsObservables = workspaces.map(workspace => this.codingJobBackendService.getCodingJobs(workspace.id).pipe(
        map(response => response.data)
      )
      );

      forkJoin(workspaceJobsObservables).subscribe({
        next: allJobsArrays => {
          const allJobs = allJobsArrays.flat();
          const assignedJobs = allJobs.filter(job => job.assignedCoders && job.assignedCoders.includes(this.currentUserId)
          );
          this.originalData = [...assignedJobs];
          this.dataSource.data = assignedJobs;
          if (this.selectedWorkspaceIds.length === 0) {
            this.selectedWorkspaceIds = this.currentWorkspaces.map(ws => ws.id);
          }
          this.updateAvailableJobNames();
          this.applyAllFilters();
          this.calculateTotalProgress(assignedJobs);
          this.cdr.detectChanges();
          this.isLoading = false;
        },
        error: () => {
          const errorMessage = this.translateService.instant('coding.my-coding-jobs.error-loading-jobs');
          this.snackBar.open(errorMessage, this.translateService.instant('close'), { duration: 3000 });
          this.isLoading = false;
        }
      });
    } else {
      this.dataSource.data = [];
      this.isLoading = false;
    }
  }

  onStatusFilterChange(): void {
    this.applyAllFilters();
  }

  onJobNameFilterChange(): void {
    this.applyAllFilters();
  }

  onWorkspaceFilterChange(): void {
    if (this.isAllWorkspacesSelected()) {
      if (!this.selectedWorkspaceIds.includes(-1)) {
        this.selectedWorkspaceIds = [...this.selectedWorkspaceIds, -1];
      }
    } else {
      this.selectedWorkspaceIds = this.selectedWorkspaceIds.filter(id => id !== -1);
    }
    this.updateAvailableJobNames();
    this.applyAllFilters();
  }

  isAllWorkspacesSelected(): boolean {
    if (this.currentWorkspaces.length === 0) return false;
    return this.currentWorkspaces.every(ws => this.selectedWorkspaceIds.includes(ws.id));
  }

  toggleAllWorkspaces(): void {
    if (this.isAllWorkspacesSelected()) {
      this.selectedWorkspaceIds = [];
    } else {
      this.selectedWorkspaceIds = [...this.currentWorkspaces.map(ws => ws.id), -1];
    }
    this.updateAvailableJobNames();
    this.applyAllFilters();
  }

  private updateAvailableJobNames(): void {
    const workspaceIds = this.selectedWorkspaceIds.filter(id => id !== -1);

    if (workspaceIds.length === 0) {
      this.availableJobNames = [];
    } else {
      const relevantJobs = this.originalData.filter(job => workspaceIds.includes(job.workspace_id));
      this.availableJobNames = [...new Set(relevantJobs.map(job => job.name))].sort();
    }

    // If selected job name is no longer available, reset it
    if (this.selectedJobName && !this.availableJobNames.includes(this.selectedJobName)) {
      this.selectedJobName = null;
    }
  }

  private applyAllFilters(): void {
    let filteredData = this.originalData || [];
    const workspaceIds = this.selectedWorkspaceIds.filter(id => id !== -1);
    if (workspaceIds.length === 0) {
      filteredData = [];
    } else {
      filteredData = filteredData.filter(job => workspaceIds.includes(job.workspace_id));
    }

    if (this.selectedStatus !== null && this.selectedStatus !== 'all') {
      filteredData = filteredData.filter(job => job.status === this.selectedStatus);
    } else if (this.selectedStatus !== 'all') {
      filteredData = filteredData.filter(job => job.status !== 'review');
    }

    if (this.selectedJobName !== null && this.selectedJobName !== 'all') {
      filteredData = filteredData.filter(job => job.name === this.selectedJobName);
    }

    this.dataSource.data = filteredData;
  }

  selectRow(row: CodingJob): void {
    this.selection.toggle(row);
  }

  sendToReview(job: CodingJob): void {
    const sendingMessage = this.translateService.instant('coding.my-coding-jobs.sending-to-review', { name: job.name });
    const loadingSnack = this.snackBar.open(sendingMessage, '', { duration: 3000 });

    this.codingJobBackendService.updateCodingJob(job.workspace_id, job.id, { status: 'review' }).subscribe({
      next: () => {
        loadingSnack.dismiss();
        const sentMessage = this.translateService.instant('coding.my-coding-jobs.sent-to-review', { name: job.name });
        this.snackBar.open(sentMessage, this.translateService.instant('close'), { duration: 3000 });
        this.loadMyCodingJobs(this.currentWorkspaces);
      },
      error: () => {
        loadingSnack.dismiss();
        const errorMessage = this.translateService.instant('coding.my-coding-jobs.error-sending-to-review');
        this.snackBar.open(errorMessage, this.translateService.instant('close'), { duration: 3000 });
      }
    });
  }

  startCodingJob(job: CodingJob): void {
    const startingMessage = this.translateService.instant('coding.my-coding-jobs.starting-job', { name: job.name });
    const loadingSnack = this.snackBar.open(startingMessage, '', { duration: 3000 });

    this.codingJobBackendService.startCodingJob(job.workspace_id, job.id).subscribe({
      next: result => {
        loadingSnack.dismiss();
        if (!result || result.total === 0) {
          const noResponsesMessage = this.translateService.instant('coding.my-coding-jobs.no-matching-responses');
          this.snackBar.open(noResponsesMessage, 'Info', { duration: 3000 });
          return;
        }

        if (!result.firstReplayUrl) {
          const errorMessage = this.translateService.instant('coding.my-coding-jobs.error-starting-job');
          this.snackBar.open(errorMessage, this.translateService.instant('close'), { duration: 3000 });
          return;
        }

        this.appService
          .createToken(job.workspace_id, this.appService.loggedUser?.sub || '', 1)
          .subscribe(token => {
            const queryParams = `auth=${encodeURIComponent(token || '')}&mode=coding&codingJobId=${encodeURIComponent(job.id)}&workspaceId=${encodeURIComponent(job.workspace_id)}`;
            const replayUrl = `${result.firstReplayUrl}?${queryParams}`;

            window.open(replayUrl, '_blank');
            const preparedMessage = this.translateService.instant('coding.my-coding-jobs.preparing-replay', { count: result.total });
            this.snackBar.open(preparedMessage, this.translateService.instant('close'), { duration: 3000 });
          });
      },
      error: () => {
        loadingSnack.dismiss();
        const errorMessage = this.translateService.instant('coding.my-coding-jobs.error-starting-job');
        this.snackBar.open(errorMessage, this.translateService.instant('close'), { duration: 3000 });
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'completed':
        return 'status-completed';
      case 'pending':
        return 'status-pending';
      case 'paused':
        return 'status-paused';
      case 'review':
        return 'status-review';
      default:
        return '';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active':
        return this.translateService.instant('coding.my-coding-jobs.job-status-active');
      case 'completed':
        return this.translateService.instant('coding.my-coding-jobs.job-status-completed');
      case 'pending':
        return this.translateService.instant('coding.my-coding-jobs.job-status-pending');
      case 'paused':
        return this.translateService.instant('coding.my-coding-jobs.job-status-paused');
      case 'review':
        return this.translateService.instant('coding.my-coding-jobs.job-status-review');
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
      const bundleNames = job.assignedVariableBundles.map(b => b.name || this.translateService.instant('unknown'));

      if (bundleNames.length <= maxToShow) {
        return `${count} (${bundleNames.join(', ')})`;
      }

      const preview = bundleNames.slice(0, maxToShow).join(', ');
      return `${count} (${preview}, +${count - maxToShow} weitere)`;
    }

    return this.translateService.instant('coding.my-coding-jobs.no-variable-bundles');
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
    this.totalCodedUnits = activeJobs.reduce((sum, job) => sum + (job.codedUnits || 0), 0);
    this.totalUnits = activeJobs.reduce((sum, job) => sum + (job.totalUnits || 0), 0);
    this.totalProgress = this.totalUnits > 0 ? Math.round((this.totalCodedUnits / this.totalUnits) * 100) : 0;
    this.incompleteJobs = assignedJobs.filter(job => job.status !== 'completed' && job.status !== 'review').length;
    this.completedJobs = assignedJobs.filter(job => job.status === 'completed').length;
  }

  private formatAssignedVariables(assignedVariables: Variable[]): string {
    if (!assignedVariables || assignedVariables.length === 0) {
      return this.translateService.instant('coding.my-coding-jobs.no-variables');
    }

    const maxToShow = 3;
    const variableNames = assignedVariables.map(v => {
      const unitName = v.unitName || this.translateService.instant('unknown');
      const variableId = v.variableId || this.translateService.instant('unknown');
      return `${unitName}_${variableId}`;
    });

    if (variableNames.length <= maxToShow) {
      return variableNames.join(', ');
    }

    return `${variableNames.slice(0, maxToShow).join(', ')} +${variableNames.length - maxToShow} weitere`;
  }
}
