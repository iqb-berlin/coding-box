import {
  Component, OnInit, OnDestroy, inject, signal, input, output, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  filter,
  finalize,
  Observable,
  Subject,
  Subscription,
  take,
  takeUntil
} from 'rxjs';
import { MatSortModule, Sort } from '@angular/material/sort';
import {
  MatPaginatorModule,
  PageEvent
} from '@angular/material/paginator';
import {
  MatFormField,
  MatLabel,
  MatOption,
  MatSelect
} from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatAnchor, MatIconButton, MatButton } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { codingJobVariableSummary, codingJobIssueSummary } from './coding-job-summary';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingPermissionsService } from '../../services/coding-permissions.service';
import { AppService } from '../../../core/services/app.service';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import {
  ApplyCodingResultsResponse,
  CodingJobBackendService
} from '../../services/coding-job-backend.service';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';

import {
  CodingJob,
  Variable,
  VariableBundle
} from '../../models/coding-job.model';
import {
  CodingJobDefinitionDialogComponent,
  CodingJobDefinitionDialogData
} from '../coding-job-definition-dialog/coding-job-definition-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { Coder } from '../../models/coder.model';
import { CoderService } from '../../services/coder.service';
import { CodingJobResultDialogComponent } from './coding-job-result-dialog/coding-job-result-dialog.component';
import { CoderTraining } from '../../models/coder-training.model';
import { DoubleCodedReviewComponent } from '../double-coded-review/double-coded-review.component';
import { CohensKappaStatisticsComponent } from '../cohens-kappa-statistics/cohens-kappa-statistics.component';
import {
  TransferCodingCasesDialogComponent,
  TransferCodingCasesDialogResult
} from './transfer-coding-cases-dialog/transfer-coding-cases-dialog.component';
import {
  ApplyCodingResultsDialogComponent,
  ApplyCodingResultsDialogResult
} from './apply-coding-results-dialog.component';
import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from '../../utils/replay-url.util';
import { hasManagementWorkspaceAccess } from '../../../shared/utils/workspace-access';

interface BulkApplyResultItem {
  jobId: number;
  jobName: string;
  hasIssues: boolean;
  skipped: boolean;
  skippedReason?:
  | 'training-job'
  | 'not-completed'
  | 'freshness-stale';
  result?: {
    success: boolean;
    updatedResponsesCount: number;
    skippedReviewCount: number;
    skippedAlreadyCodedCount: number;
    overwrittenExistingCount: number;
    message: string;
  };
}

type JobPrimaryAction =
  | 'start'
  | 'review'
  | 'results'
  | 'apply'
  | 'notAssigned';
type CodingJobScope = 'all' | 'training' | 'productive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-jobs',
  templateUrl: './coding-jobs.component.html',
  styleUrls: ['./coding-jobs.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatTable,
    MatAnchor,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatSortModule,
    MatPaginatorModule,
    MatDialogModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    MatIconButton,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatLabel,
    MatInputModule,
    MatSelect,
    MatOption
  ]
})
export class CodingJobsComponent implements OnInit, OnDestroy {
  private readonly uiTranslate = injectUiTranslator();

  readonly permissions = inject(CodingPermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  appService = inject(AppService);
  codingJobBackendService = inject(CodingJobBackendService);
  codingTrainingBackendService = inject(CodingTrainingBackendService);
  private userBackendService = inject(UserBackendService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private testPersonCodingService = inject(TestPersonCodingService);

  readonly canApplyResults = signal(false);
  readonly canReviewCodingJobs = signal(false);
  readonly canManageCodingJobs = signal(false);

  private coderNamesByJobId = new Map<number, string>();
  readonly allCoders = signal<Coder[]>([]);

  private jobDetailsCache = new Map<
    number,
    { variables?: Variable[]; variableBundles?: VariableBundle[] }
  >();

  private preloadedVariables: Variable[] | null = null;

  protected displayedColumns: string[] = [
    'select',
    'actions',
    'name',
    'description',
    'status',
    'assignedCoders',
    'variables',
    'variableBundles',
    'progress',
    'createdAt',
    'updatedAt',
    'hasIssues'
  ];

  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  readonly isLoading = signal(false);
  readonly hasLoadedJobs = signal(false);

  protected readonly coderTrainings = signal<CoderTraining[]>([]);
  protected readonly selectedTrainingId = signal<number | string | null>(null);
  readonly selectedStatus = signal<string | null>(null);
  readonly selectedCoderId = signal<number | null>(null);
  readonly selectedJobName = signal<string | null>(null);
  readonly originalData = signal<CodingJob[]>([]);
  readonly jobsTotal = signal(0);
  protected readonly pageSize = signal(50);
  protected readonly pageIndex = signal(0);
  protected readonly sortBy = signal<'name' | 'description' | 'status' | 'createdAt' | 'updatedAt'>('createdAt');

  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  private loadJobsSubscription?: Subscription;
  private jobNameFilterSubscription?: Subscription;
  private permissionsSubscription?: Subscription;
  private coderTrainingsSubscription?: Subscription;
  private codersSubscription?: Subscription;
  private workspaceGeneration = 0;
  private readonly destroy$ = new Subject<void>();
  private readonly jobNameFilterChanges = new Subject<{ value: string; generation: number }>();
  private readonly windowFocusReloadThrottleMs = 10000;
  private lastWindowFocusReloadAt = 0;

  readonly jobsChanged = output<void>();
  readonly jobScope = input<CodingJobScope>('all');
  readonly showTrainingFilter = input(true);
  readonly showComparisonActions = input(true);
  readonly showTransferAction = input(true);
  readonly showApplyActions = input(true);
  readonly showBulkDeleteAction = input(true);
  readonly showRefreshAction = input(true);
  readonly autoReloadOnFocus = input(false);

  private handleWindowFocus = () => {
    if (!this.autoReloadOnFocus() || this.isLoading()) {
      return;
    }
    const now = Date.now();
    if (now - this.lastWindowFocusReloadAt < this.windowFocusReloadThrottleMs) {
      return;
    }
    this.lastWindowFocusReloadAt = now;
    this.loadCodingJobs();
  };

  ngOnInit(): void {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id === workspaceId) return;
      workspaceId = id;
      this.workspaceGeneration += 1;
      this.resetWorkspaceState();
      this.loadWorkspaceData();
    });

    this.jobNameFilterSubscription = this.jobNameFilterChanges
      .pipe(
        debounceTime(300),
        filter(change => change.generation === this.workspaceGeneration),
        distinctUntilChanged((previous, current) => previous.value === current.value && previous.generation === current.generation),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.selection.clear();
        this.reloadFirstPage();
      });

    this.loadWorkspaceData();
    window.addEventListener('focus', this.handleWindowFocus);
  }

  private resetWorkspaceState(): void {
    this.selection.clear();
    this.dataSource.data = [];
    this.originalData.set([]);
    this.jobsTotal.set(0);
    this.hasLoadedJobs.set(false);
    this.pageIndex.set(0);
    this.selectedTrainingId.set(null);
    this.selectedStatus.set(null);
    this.selectedCoderId.set(null);
    this.selectedJobName.set(null);
    this.coderTrainings.set([]);
    this.allCoders.set([]);
    this.canApplyResults.set(false);
    this.canReviewCodingJobs.set(false);
    this.canManageCodingJobs.set(false);
    this.jobDetailsCache.clear();
    this.coderNamesByJobId.clear();
    this.preloadedVariables = null;
    this.lastWindowFocusReloadAt = 0;
  }

  private loadWorkspaceData(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) this.permissions.load(workspaceId);
    this.codersSubscription?.unsubscribe();
    this.codersSubscription = this.coderService.getCoders()
      .pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
      .subscribe(coders => {
        this.allCoders.set(coders);
        this.updateCoderNamesMap(this.dataSource.data);
      });
    this.loadCodingJobs();
  }

  private observeWorkspaceDialog<T, R>(dialogRef: MatDialogRef<T, R>): Observable<R | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    const unregisterClose = this.destroyRef.onDestroy(() => dialogRef.close());
    this.appService.selectedWorkspaceId$.pipe(
      filter(id => id !== workspaceId),
      take(1),
      takeUntil(dialogRef.afterClosed()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => dialogRef.close());
    return dialogRef.afterClosed().pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      finalize(unregisterClose)
    );
  }

  private updateCodingJobPermissions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const userId = this.appService.authData.userId;
    if (this.appService.authData.isAdmin || !workspaceId || userId <= 0) {
      this.permissionsSubscription?.unsubscribe();
      this.canApplyResults.set(this.appService.authData.isAdmin);
      this.canReviewCodingJobs.set(this.appService.authData.isAdmin);
      this.canManageCodingJobs.set(this.appService.authData.isAdmin);
      return;
    }
    this.permissionsSubscription?.unsubscribe();
    this.permissionsSubscription = this.userBackendService.getUsers(workspaceId)
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe(users => {
        if (workspaceId !== this.appService.selectedWorkspaceId ||
          userId !== this.appService.authData.userId) {
          return;
        }
        const currentUser = users.find(u => u.id === userId);
        const accessLevel = currentUser?.accessLevel ?? 0;
        this.canManageCodingJobs.set(accessLevel >= 2);
        this.canApplyResults.set(accessLevel >= 3);
        this.canReviewCodingJobs.set(currentUser ?
          hasManagementWorkspaceAccess(currentUser) :
          false);
      });
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
    this.destroy$.next();
    this.destroy$.complete();
    this.loadJobsSubscription?.unsubscribe();
    this.jobNameFilterSubscription?.unsubscribe();
    this.permissionsSubscription?.unsubscribe();
    this.coderTrainingsSubscription?.unsubscribe();
    this.codersSubscription?.unsubscribe();
    this.jobNameFilterChanges.complete();
  }

  loadCodingJobs(): void {
    this.loadJobsSubscription?.unsubscribe();
    this.isLoading.set(true);
    this.updateCodingJobPermissions();
    this.loadCoderTrainings();

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.isLoading.set(false);
      this.hasLoadedJobs.set(true);
      return;
    }

    this.loadJobsSubscription = this.codingJobBackendService
      .getCodingJobs(
        workspaceId,
        this.pageIndex() + 1,
        this.pageSize(),
        this.getListOptions()
      )
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const processedData = this.normalizeCodingJobs(response.data);
          this.originalData.set([...processedData]);
          this.dataSource.data = processedData;
          this.jobsTotal.set(response.total ?? processedData.length);
          this.updateCoderNamesMap(processedData);

          this.jobDetailsCache.clear();
          this.hasLoadedJobs.set(true);
          this.isLoading.set(false);
        },
        error: () => {
          this.snackBar.open(this.uiTranslate('coding.my-coding-jobs.error-loading-jobs'), this.uiTranslate('deferred-view.close'), {
            duration: 3000
          });
          this.hasLoadedJobs.set(true);
          this.isLoading.set(false);
        }
      });
  }

  private getListOptions() {
    return {
      scope: this.jobScope(),
      status: this.selectedStatus() || undefined,
      coderId: this.selectedCoderId() || undefined,
      jobName: this.normalizeJobNameFilter(),
      trainingId: this.showTrainingFilter() ?
        ((this.selectedTrainingId() ?? undefined) as
            | number
            | 'none'
            | undefined) :
        undefined,
      includeIssueSummary: true,
      sortBy: this.sortBy(),
      sortDirection: this.sortDirection()
    };
  }

  private normalizeJobNameFilter(): string | undefined {
    const normalized = this.selectedJobName()?.trim();
    return normalized || undefined;
  }

  private normalizeCodingJobs(jobs: CodingJob[]): CodingJob[] {
    return jobs.map((job: CodingJob) => ({
      ...job,
      createdAt: job.created_at ? new Date(job.created_at) : new Date(),
      updatedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
      assignedVariableBundles:
        job.assignedVariableBundles ?? job.variableBundles ?? [],
      issueSummary: job.issueSummary ?? {
        total: 0,
        open: 0,
        codeAssignmentUncertain: 0,
        newCodeNeeded: 0
      },
      hasIssues: job.hasIssues ?? (job.issueSummary?.total ?? 0) > 0
    }));
  }

  getCodingIssueTooltip(job: CodingJob): string { return codingJobIssueSummary(job, this.translateService.instant.bind(this.translateService)); }

  applyFilter(): void {
    this.reloadFirstPage();
  }

  onStatusFilterChange(): void {
    this.selection.clear();
    this.reloadFirstPage();
  }

  onCoderFilterChange(): void {
    this.selection.clear();
    this.reloadFirstPage();
  }

  onJobNameFilterChange(): void {
    this.jobNameFilterChanges.next({ value: this.selectedJobName() ?? '', generation: this.workspaceGeneration });
  }

  protected onSortChange(sort: Sort): void {
    if (!this.isSupportedServerSort(sort.active) || !sort.direction) {
      this.sortBy.set('createdAt');
      this.sortDirection.set('desc');
    } else {
      this.sortBy.set(sort.active);
      this.sortDirection.set(sort.direction);
    }
    this.selection.clear();
    this.reloadFirstPage();
  }

  protected onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.selection.clear();
    this.loadCodingJobs();
  }

  private reloadFirstPage(): void {
    this.pageIndex.set(0);
    this.loadCodingJobs();
  }

  private isSupportedServerSort(
    sortBy: string
  ): sortBy is 'name' | 'description' | 'status' | 'createdAt' | 'updatedAt' {
    return [
      'name',
      'description',
      'status',
      'createdAt',
      'updatedAt'
    ].includes(sortBy);
  }

  private reloadCurrentOrPreviousPageAfterDelete(deletedCount: number): void {
    const remainingTotal = Math.max(0, this.jobsTotal() - deletedCount);
    const maxPageIndex =
      remainingTotal > 0 ? Math.ceil(remainingTotal / this.pageSize()) - 1 : 0;
    this.pageIndex.set(Math.min(this.pageIndex(), maxPageIndex));
    this.loadCodingJobs();
  }

  getVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      return this.formatAssignedVariables(job.assignedVariables);
    }
    if (job.variables && job.variables.length > 0) {
      return this.formatAssignedVariables(job.variables);
    }
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (
      cachedDetails &&
      cachedDetails.variables &&
      cachedDetails.variables.length > 0
    ) {
      return this.formatAssignedVariables(cachedDetails.variables);
    }
    return this.uiTranslate('coding.my-coding-jobs.no-variables');
  }

  getVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const count = job.assignedVariableBundles.length;
      const maxToShow = 2;
      const bundleNames = job.assignedVariableBundles.map(
        b => b.name || this.uiTranslate('ws-admin.unknown')
      );

      if (bundleNames.length <= maxToShow) {
        return `${count} (${bundleNames.join(', ')})`;
      }

      const preview = bundleNames.slice(0, maxToShow).join(', ');
      return `${count} (${preview}, +${count - maxToShow} weitere)`;
    }

    return this.uiTranslate('coding.my-coding-jobs.no-variable-bundles');
  }

  private formatAssignedVariables(assignedVariables: Variable[]): string {
    if (!assignedVariables || assignedVariables.length === 0) {
      return this.uiTranslate('coding.my-coding-jobs.no-variables');
    }

    const maxToShow = 3;
    const variableNames = assignedVariables.map(v => {
      const unitName = v.unitName || this.uiTranslate('ws-admin.unknown');
      const variableId = v.variableId || this.uiTranslate('ws-admin.unknown');
      return `${unitName}_${variableId}`;
    });

    if (variableNames.length <= maxToShow) {
      return variableNames.join(', ');
    }

    return `${variableNames.slice(0, maxToShow).join(', ')} +${variableNames.length - maxToShow} weitere`;
  }

  protected getFullVariables(job: CodingJob): string { return codingJobVariableSummary(job, this.jobDetailsCache.get(job.id), this.uiTranslate); }

  protected getFullVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const bundleNames = job.assignedVariableBundles.map(
        b => b.name || this.uiTranslate('ws-admin.unknown')
      );
      return this.uiTranslate('ui-text.coding-jobs.variablen-buendel', { length: job.assignedVariableBundles.length, value2: bundleNames.join(', ') });
    }

    if (job.variableBundles && job.variableBundles.length > 0) {
      return job.variableBundles.map(b => b.name || this.uiTranslate('ws-admin.unknown')).join(', ');
    }

    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (
      cachedDetails &&
      cachedDetails.variableBundles &&
      cachedDetails.variableBundles.length > 0
    ) {
      return cachedDetails.variableBundles
        .map(b => b.name || this.uiTranslate('ws-admin.unknown'))
        .join(', ');
    }

    return this.uiTranslate('ui-text.coding-jobs.keine-variablen-buendel-zugewiesen');
  }

  createCodingJob(): void {
    if (!this.permissions.canCreate) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    if (this.preloadedVariables) {
      this.openCreateCodingJobDialog(this.preloadedVariables);
      return;
    }

    this.codingJobBackendService
      .getCodingIncompleteVariables(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: variables => {
          this.preloadedVariables = variables;
          this.openCreateCodingJobDialog(variables);
        },
        error: () => {
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.fehler-beim-laden-der-kodierpflichtigen-variablen'),
            this.uiTranslate('deferred-view.close'),
            { duration: 3000 }
          );
          this.openCreateCodingJobDialog([]);
        }
      });
  }

  private openCreateCodingJobDialog(preloadedVariables: Variable[]): void {
    const dialogRef = this.dialog.open(CodingJobDefinitionDialogComponent, {
      width: '95vw',
      maxWidth: '1600px',
      data: {
        isEdit: false,
        preloadedVariables
      } as CodingJobDefinitionDialogData
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        const newId = this.getNextId();
        const now = new Date();
        const newCodingJob: CodingJob = {
          ...result,
          assignedVariables: result.assignedVariables ?? result.variables ?? [],
          assignedVariableBundles:
            result.assignedVariableBundles ?? result.variableBundles ?? [],
          id: newId,
          createdAt: now,
          updatedAt: now
        };
        const currentData = this.dataSource.data;
        this.dataSource.data = [...currentData, newCodingJob];
        this.snackBar.open(
          this.uiTranslate('ui-text.coding-jobs.kodierjob-wurde-erstellt', { name: newCodingJob.name }),
          this.uiTranslate('deferred-view.close'),
          { duration: 3000 }
        );
        this.loadCodingJobs();
      }
    });
  }

  private getNextId(): number {
    const jobs = this.dataSource.data;
    return jobs.length > 0 ? Math.max(...jobs.map(job => job.id)) + 1 : 1;
  }

  deleteCodingJob(job: CodingJob): void {
    if (!this.permissions.canEdit(job)) return;
    if (!this.canManageCodingJobs()) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.keine-berechtigung-zum-verwalten-von-kodierjobs'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    const confirmMessage = this.uiTranslate('ui-text.coding-jobs.moechten-sie-den-kodierjob-wirklich-loeschen', { name: job.name });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.uiTranslate('coding.trainings.delete.confirm.title'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('delete'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.codingJobBackendService
          .deleteCodingJob(workspaceId, job.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: response => {
              if (response.success) {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.kodierjob-wurde-erfolgreich-geloescht', { name: job.name }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 3000 }
                );
                this.reloadCurrentOrPreviousPageAfterDelete(1);
                this.jobsChanged.emit();
              } else {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.fehler-beim-loeschen-von-kodierjob', { name: job.name }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.fehler-beim-loeschen-von-kodierjob', { name: job.name }),
                this.uiTranslate('deferred-view.close'),
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  getProgress(job: CodingJob): string {
    if (!job) {
      return this.uiTranslate('ui-text.coding-jobs.keine-daten');
    }

    const totalUnits = job.totalUnits ?? 0;
    const codedUnits = job.codedUnits ?? 0;
    const openUnits = job.openUnits ?? 0;
    const progress = job.progress ?? 0;

    if (totalUnits === 0) {
      return this.uiTranslate('coding.my-coding-jobs.no-tasks');
    }

    if (openUnits > 0) {
      return this.uiTranslate('ui-text.coding-jobs.offen', {
        progress: progress, codedUnits: codedUnits, totalUnits: totalUnits, openUnits: openUnits
      });
    }

    return `${progress}% (${codedUnits}/${totalUnits})`;
  }

  getPrimaryJobAction(job: CodingJob): JobPrimaryAction {
    if (this.showApplyActions() && this.canApplyCodingResults(job)) {
      return 'apply';
    }

    if (job.status === 'review') {
      return this.canReviewCodingJob(job) ? 'review' : 'results';
    }

    if (
      this.canReviewCodingJob(job) &&
      (job.status === 'completed' ||
        job.status === 'results_applied' ||
        !this.canStartCodingJob(job))
    ) {
      return 'review';
    }

    if (job.status === 'completed' || job.status === 'results_applied') {
      return 'results';
    }

    if (!this.canStartCodingJob(job)) {
      return 'notAssigned';
    }

    return 'start';
  }

  protected canStartCodingJob(job: CodingJob): boolean {
    const userId = this.appService.authData.userId;
    return (
      userId > 0 &&
      Array.isArray(job.assignedCoders) &&
      job.assignedCoders.includes(userId)
    );
  }

  canReviewCodingJob(job: CodingJob): boolean {
    return !!job?.id && this.canReviewCodingJobs();
  }

  protected getStartCodingJobLabel(): string {
    return this.uiTranslate('coding.my-coding-jobs.start-coding');
  }

  protected getStartCodingJobIcon(): string {
    return 'play_arrow';
  }

  getReviewCodingJobLabel(): string {
    return this.uiTranslate('coding.my-coding-jobs.open-review');
  }

  canApplyCodingResults(job: CodingJob): boolean {
    return (
      this.showApplyActions() &&
      this.canApplyResults() &&
      ['completed', 'review'].includes(job.status) &&
      this.isCodingJobFreshnessApplyable(job) &&
      !job.training?.id &&
      !job.training_id
    );
  }

  private isCodingJobFreshnessApplyable(job: CodingJob): boolean {
    return job.freshnessStatus !== 'stale_source';
  }

  canRestartCodingJob(job: CodingJob): boolean {
    if (!this.permissions.canEdit(job)) return false;
    return (
      this.canManageCodingJobs() &&
      !['review', 'results_applied'].includes(job.status) &&
      (job.totalUnits || 0) > 0 &&
      (job.openUnits || 0) > 0 &&
      this.canStartCodingJob(job) &&
      !job.training_id &&
      !job.training
    );
  }

  protected getJobActionAriaLabel(action: string, job: CodingJob): string {
    const jobName = this.getDisplayName(job);
    switch (action) {
      case 'start':
        return `${this.getStartCodingJobLabel()}: ${jobName}`;
      case 'review':
        return `${this.getReviewCodingJobLabel()}: ${jobName}`;
      case 'results':
        return this.uiTranslate('ui-text.coding-jobs.ergebnisse-anzeigen', { jobName: jobName });
      case 'restart':
        return this.uiTranslate('ui-text.coding-jobs.offene-faelle-ansehen-91e22f', { jobName: jobName });
      case 'apply':
        return this.uiTranslate('ui-text.coding-jobs.ergebnisse-anwenden', { jobName: jobName });
      case 'notAssigned':
        return this.uiTranslate('ui-text.coding-jobs.kodierjob-nicht-zugewiesen', { jobName: jobName });
      case 'delete':
        return this.uiTranslate('ui-text.coding-jobs.kodierjob-loeschen-1ab107', { jobName: jobName });
      case 'more':
        return `Weitere Aktionen: ${jobName}`;
      default:
        return `${action}: ${jobName}`;
    }
  }

  startCodingJob(job: CodingJob): void {
    const selectedJob = job;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    if (!this.canStartCodingJob(selectedJob)) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.dieser-kodierjob-ist-ihnen-nicht-als-kodierer-zugewiesen'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('coding.my-coding-jobs.starting-job', { name: selectedJob.name }),
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService
      .startCodingJob(workspaceId, selectedJob.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: startResult => {
          loadingSnack.dismiss();
          if (!startResult || startResult.total === 0) {
            this.snackBar.open(this.uiTranslate('coding.my-coding-jobs.no-matching-responses'), 'Info', {
              duration: 3000
            });
            return;
          }

          if (!startResult.firstReplayUrl) {
            this.snackBar.open(
              this.uiTranslate('ui-text.coding-jobs.fehler-beim-generieren-der-replay-url'),
              this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
              { duration: 3000 }
            );
            return;
          }

          const replayUrl = appendReplayUrlParams(
            normalizeReplayUrlToCurrentOrigin(startResult.firstReplayUrl),
            {
              mode: 'coding',
              codingJobId: selectedJob.id,
              workspaceId
            }
          );

          window.open(replayUrl, '_blank');
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.kodierjob-gestartet', { name: selectedJob.name }),
            this.uiTranslate('deferred-view.close'),
            { duration: 3000 }
          );
        },
        error: (error: { status?: number }) => {
          loadingSnack.dismiss();
          const message =
            error?.status === 403 ?
              this.uiTranslate('ui-text.coding-jobs.dieser-kodierjob-ist-ihnen-nicht-als-kodierer-zugewiesen') :
              this.uiTranslate('coding.my-coding-jobs.error-starting-job');
          this.snackBar.open(message, this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'), { duration: 3000 });
        }
      });
  }

  openCodingJobReview(job: CodingJob): void {
    const selectedJob = job;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.coding-jobs.oeffne-review-fuer-kodierjob', { name: selectedJob.name }),
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService
      .prepareCodingJobReview(workspaceId, selectedJob.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: reviewResult => {
          loadingSnack.dismiss();
          if (!reviewResult || reviewResult.total === 0) {
            this.snackBar.open(this.uiTranslate('coding.my-coding-jobs.no-matching-responses'), 'Info', {
              duration: 3000
            });
            return;
          }

          if (!reviewResult.firstReplayUrl) {
            this.snackBar.open(
              this.uiTranslate('ui-text.coding-jobs.fehler-beim-generieren-der-replay-url'),
              this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
              { duration: 3000 }
            );
            return;
          }

          const replayUrl = appendReplayUrlParams(
            normalizeReplayUrlToCurrentOrigin(reviewResult.firstReplayUrl),
            {
              mode: 'coding-review',
              codingJobId: selectedJob.id,
              workspaceId
            }
          );

          window.open(replayUrl, '_blank');
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.review-fuer-kodierjob-geoeffnet', { name: selectedJob.name }),
            this.uiTranslate('deferred-view.close'),
            { duration: 3000 }
          );
        },
        error: (error: { status?: number }) => {
          loadingSnack.dismiss();
          const message =
            error?.status === 403 ?
              this.uiTranslate('ui-text.coding-jobs.sie-haben-keinen-zugriff-auf-diesen-kodierjob') :
              this.uiTranslate('ui-text.coding-jobs.fehler-beim-oeffnen-des-reviews');
          this.snackBar.open(message, this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'), { duration: 3000 });
        }
      });
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
        return 'Aktiv';
      case 'completed':
        return this.uiTranslate('status-completed');
      case 'results_applied':
        return this.uiTranslate('coding.my-coding-jobs.filter-results-applied');
      case 'pending':
        return this.uiTranslate('status-pending');
      case 'paused':
        return 'Pausiert';
      case 'open':
        return this.uiTranslate('coding.my-coding-jobs.filter-open');
      case 'review':
        return this.uiTranslate('coding.my-coding-jobs.filter-review');
      default:
        return status;
    }
  }

  getAssignedCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      const full = this.coderNamesByJobId.get(job.id)!;
      if (full === 'Keine') {
        return full;
      }
      const names = full.split(', ').filter(n => n && n.trim().length > 0);
      if (names.length > 2) {
        return `${names[0]}, ${names[1]} +${names.length - 2} weitere`;
      }
      return names.join(', ');
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return this.uiTranslate('coding.trainings.compare.none');
    }

    return this.uiTranslate('ui-text.coding-jobs.kodierer', { length: job.assignedCoders.length });
  }

  protected getFullCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      const full = this.coderNamesByJobId.get(job.id)!;
      return full === 'Keine' ? this.uiTranslate('ui-text.coding-jobs.keine-kodierer-zugewiesen') : full;
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return this.uiTranslate('ui-text.coding-jobs.keine-kodierer-zugewiesen');
    }

    // Fallback
    return this.uiTranslate('ui-text.coding-jobs.kodierer', { length: job.assignedCoders.length });
  }

  protected getDisplayName(job: CodingJob): string {
    if (job.training_id) {
      const prefix = this.translateService.instant(
        'coding.trainings.job-name-prefix'
      );
      return `${prefix}${job.name}`;
    }
    return job.name;
  }

  private updateCoderNamesMap(jobs: CodingJob[]): void {
    if (!jobs || jobs.length === 0) {
      return;
    }

    const byId = new Map<number, Coder>(this.allCoders().map(c => [c.id, c]));
    jobs.forEach(job => {
      const ids = job.assignedCoders || [];
      if (ids.length === 0) {
        this.coderNamesByJobId.set(job.id, this.uiTranslate('coding.trainings.compare.none'));
        return;
      }
      const names = ids
        .map(id => byId.get(id))
        .filter((c): c is Coder => !!c)
        .map(c => c.displayName || c.name || `Coder ${c.id}`);

      if (names.length === 0) {
        this.coderNamesByJobId.set(job.id, this.uiTranslate('ui-text.coding-jobs.kodierer', { length: ids.length }));
      } else {
        this.coderNamesByJobId.set(job.id, names.join(', '));
      }
    });
  }

  loadCoderTrainings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.coderTrainingsSubscription?.unsubscribe();
      return;
    }

    this.coderTrainingsSubscription?.unsubscribe();
    this.coderTrainingsSubscription = this.codingTrainingBackendService.getCoderTrainings(workspaceId)
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntil(this.destroy$))
      .subscribe({
        next: trainings => {
          if (workspaceId !== this.appService.selectedWorkspaceId) {
            return;
          }
          this.coderTrainings.set(trainings);
        },
        error: () => {
          if (workspaceId !== this.appService.selectedWorkspaceId) {
            return;
          }
          this.coderTrainings.set([]);
        }
      });
  }

  protected onTrainingFilterChange(): void {
    this.selection.clear();
    this.reloadFirstPage();
  }

  restartCodingJob(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    if (!this.canRestartCodingJob(job)) {
      return;
    }

    const confirmMessage = this.uiTranslate('ui-text.coding-jobs.moechten-sie-den-kodierjob-wirklich-neu-starten-alle-einheiten-werden-fuer-eine-aktualisie', { name: job.name });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.coding-jobs.neustart-bestaetigen'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('ui-text.coding-jobs.neustart'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result && this.canRestartCodingJob(job)) {
        this.codingJobBackendService
          .restartCodingJobWithOpenUnits(workspaceId, job.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: restartedJob => {
              const loadingSnack = this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.neustart-von-kodierjob-mit-offenen-einheiten', { name: restartedJob.name }),
                '',
                { duration: 3000 }
              );

              this.codingJobBackendService
                .startCodingJob(workspaceId, restartedJob.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
                .subscribe({
                  next: restartResult => {
                    loadingSnack.dismiss();
                    if (!restartResult || restartResult.total === 0) {
                      this.snackBar.open(
                        this.uiTranslate('ui-text.coding-jobs.keine-offenen-einheiten-gefunden'),
                        'Info',
                        { duration: 3000 }
                      );
                      return;
                    }

                    if (!restartResult.firstReplayUrl) {
                      this.snackBar.open(
                        this.uiTranslate('ui-text.coding-jobs.fehler-beim-generieren-der-replay-url'),
                        this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
                        { duration: 3000 }
                      );
                      return;
                    }

                    const replayUrl = appendReplayUrlParams(
                      normalizeReplayUrlToCurrentOrigin(restartResult.firstReplayUrl),
                      {
                        mode: 'coding',
                        codingJobId: restartedJob.id,
                        workspaceId,
                        onlyOpen: true
                      }
                    );

                    window.open(replayUrl, '_blank');
                    this.snackBar.open(
                      this.uiTranslate('ui-text.coding-jobs.offene-einheiten-fuer-replay-vorbereitet', { total: restartResult.total }),
                      this.uiTranslate('deferred-view.close'),
                      { duration: 3000 }
                    );
                  },
                  error: () => {
                    loadingSnack.dismiss();
                    this.snackBar.open(
                      this.uiTranslate('ui-text.coding-jobs.fehler-beim-starten-des-neu-gestarteten-kodierjobs', { name: restartedJob.name }),
                      this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'),
                      { duration: 3000 }
                    );
                  }
                });
            },
            error: () => {
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.fehler-beim-neustart-des-kodierjobs', { name: job.name }),
                this.uiTranslate('deferred-view.close'),
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  viewCodingResults(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }
    const dialogRef = this.dialog.open(CodingJobResultDialogComponent, {
      width: 'min(1400px, 96vw)',
      maxWidth: '96vw',
      height: '85vh',
      maxHeight: '90vh',
      panelClass: 'coding-results-dialog-panel',
      disableClose: true,
      data: {
        codingJob: job,
        workspaceId: workspaceId,
        canApplyResults: this.canApplyResults(),
        canEdit: this.permissions.canEdit(job)
      }
    });

    dialogRef.backdropClick().pipe(takeUntil(dialogRef.afterClosed()), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      dialogRef.componentInstance.closeDialog();
    });

    dialogRef.keydownEvents()
      .pipe(filter(event => event.key === 'Escape'), takeUntil(dialogRef.afterClosed())).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        dialogRef.componentInstance.closeDialog();
      });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result?.resultsApplied) {
        this.notifyCodingResultsApplied(workspaceId);
        this.loadCodingJobs();
        this.jobsChanged.emit();
      }
    });
  }

  protected isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  protected masterToggle(): void {
    this.isAllSelected() ?
      this.selection.clear() :
      this.dataSource.data.forEach(row => this.selection.select(row));
  }

  protected checkboxLabel(row?: CodingJob): string {
    if (!row) {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selection.isSelected(row) ? 'deselect' : 'select'} row ${row.id + 1}`;
  }

  protected openDoubleCodedReviewDialog(): void {
    const dialogRef = this.dialog.open(DoubleCodedReviewComponent, {
      width: '98vw',
      maxWidth: '100vw',
      height: '95vh',
      maxHeight: '100vh',
      data: { canApplyResults: this.canApplyResults() }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result?.resultsApplied) {
        this.jobsChanged.emit();
      }
    });
  }

  openTransferCodingCasesDialog(): void {
    if (!this.canManageCodingJobs()) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.keine-berechtigung-zum-verwalten-von-kodierjobs'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    if (!this.allCoders()?.length) {
      this.snackBar.open(this.uiTranslate('coding-job-definition-dialog.empty-states.no-coders'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const dialogRef = this.dialog.open(TransferCodingCasesDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { coders: this.allCoders() }
    });

    this.observeWorkspaceDialog(dialogRef)
      .subscribe((result?: TransferCodingCasesDialogResult) => {
        if (!result) {
          return;
        }

        this.codingJobBackendService
          .transferCodingCases(
            workspaceId,
            result.sourceCoderId,
            result.targetCoderId
          ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: transferResult => {
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.uebertragung-erfolgreich-faelle-in-job-s-angepasst', { transferredCases: transferResult.transferredCases, affectedJobs: transferResult.affectedJobs }),
                this.uiTranslate('deferred-view.close'),
                { duration: 4000 }
              );
              this.loadCodingJobs();
              this.jobsChanged.emit();
            },
            error: error => {
              const apiMessage = error?.error?.message;
              this.snackBar.open(
                apiMessage || this.uiTranslate('ui-text.coding-jobs.fehler-beim-uebertragen-der-kodierfaelle'),
                this.uiTranslate('deferred-view.close'),
                { duration: 5000 }
              );
            }
          });
      });
  }

  protected openCohensKappaStatisticsDialog(): void {
    const dialogRef = this.dialog.open(CohensKappaStatisticsComponent, {
      width: '90vw',
      maxWidth: '1400px',
      height: '95vh',
      data: {}
    });
    this.observeWorkspaceDialog(dialogRef).subscribe();
  }

  canDeleteSelectedJobs(): boolean {
    return this.selection.selected.length > 0 && this.selection.selected.every(job => this.permissions.canEdit(job));
  }

  bulkDeleteCodingJobs(): void {
    if (!this.canDeleteSelectedJobs()) return;
    if (!this.canManageCodingJobs()) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.keine-berechtigung-zum-verwalten-von-kodierjobs'),
        this.uiTranslate('deferred-view.close'),
        { duration: 4000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    const selectedJobs = [...this.selection.selected];
    if (selectedJobs.length === 0) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-jobs.keine-kodierjobs-ausgewaehlt'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const jobNamesHTML = selectedJobs
      .map(job => `"${job.name}"`)
      .join('<br>');
    const confirmMessage = this.uiTranslate('ui-text.coding-jobs.moechten-sie-wirklich-kodierjob-s-loeschen-br-br', { length: selectedJobs.length, jobNamesHTML: jobNamesHTML });

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.coding-jobs.massenloeschung-bestaetigen'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('export-toast.clear-all'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.performBulkDelete(selectedJobs, workspaceId);
      }
    });
  }

  private async performBulkDelete(jobs: CodingJob[], workspaceId: number): Promise<void> {
    if (!jobs.every(job => this.permissions.canEdit(job))) return;
    const generation = this.workspaceGeneration;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.coding-jobs.loesche-kodierjob-s', { length: jobs.length }),
      '',
      { duration: 3000 }
    );

    let successCount = 0;
    let failureCount = 0;
    const failedJobs: string[] = [];

    try {
      const response = await firstValueFrom(this.codingJobBackendService.deleteCodingJobs(workspaceId, jobs.map(job => job.id)).pipe(
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => loadingSnack.dismiss())
      ), { defaultValue: undefined });
      if (!response) return;
      if (response.success) successCount = jobs.length;
      else { failureCount = jobs.length; failedJobs.push(...jobs.map(job => job.name)); }
    } catch {
      failureCount = jobs.length;
      failedJobs.push(...jobs.map(job => job.name));
    }

    loadingSnack.dismiss();
    if (this.destroyRef.destroyed || generation !== this.workspaceGeneration) return;

    this.selection.clear();

    if (failureCount === 0) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.kodierjob-s-erfolgreich-geloescht', { successCount: successCount }),
        this.uiTranslate('deferred-view.close'),
        { duration: 3000 }
      );
    } else if (successCount === 0) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.fehler-beim-loeschen-aller-kodierjob-s', { failureCount: failureCount }),
        this.uiTranslate('deferred-view.close'),
        { duration: 5000 }
      );
    } else {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-jobs.kodierjob-s-erfolgreich-geloescht-fehlgeschlagen', { successCount: successCount, failureCount: failureCount, value3: failedJobs.join(', ') }),
        this.uiTranslate('deferred-view.close'),
        { duration: 5000 }
      );
    }

    this.reloadCurrentOrPreviousPageAfterDelete(successCount);
    if (successCount > 0) {
      this.jobsChanged.emit();
    }
  }

  applyCodingResults(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const dialogRef = this.dialog.open(ApplyCodingResultsDialogComponent, {
      width: '600px',
      data: {
        jobName: job.name,
        totalResults: job.totalUnits,
        codedResults: job.codedUnits,
        hasReviewIssues: job.hasIssues
      }
    });

    this.observeWorkspaceDialog(dialogRef)
      .subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
        if (!dialogResult) {
          return;
        }

        const loadingSnack = this.snackBar.open(
          this.uiTranslate('ui-text.coding-jobs.wende-ergebnisse-fuer-kodierjob-an', { name: job.name }),
          '',
          { duration: 3000 }
        );

        this.codingJobBackendService
          .applyCodingResults(workspaceId, job.id, {
            overwriteExisting: dialogResult.overwriteExisting
          }).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: result => {
              loadingSnack.dismiss();
              if (result.success) {
                this.snackBar.open(
                  this.formatApplyCodingResultsMessage(result),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 6000 }
                );
                this.loadCodingJobs(); // Refresh the list to show updated status
                this.notifyCodingResultsApplied(workspaceId);
                this.jobsChanged.emit();
              } else {
                this.snackBar.open(
                  this.uiTranslate('ui-text.coding-jobs.fehler-beim-anwenden-der-ergebnisse', { value1: this.translateService.instant(result.messageKey, result.messageParams || {}) }),
                  this.uiTranslate('deferred-view.close'),
                  { duration: 5000 }
                );
              }
            },
            error: error => {
              loadingSnack.dismiss();
              this.snackBar.open(
                this.uiTranslate('ui-text.coding-jobs.fehler-beim-anwenden-der-ergebnisse', { value1: error.message || this.uiTranslate('error.unknown') }),
                this.uiTranslate('deferred-view.close'),
                { duration: 5000 }
              );
            }
          });
      });
  }

  private formatApplyCodingResultsMessage(
    result: ApplyCodingResultsResponse
  ): string {
    const parts = [
      this.uiTranslate('ui-text.coding-jobs.ergebnisse-erfolgreich-angewendet-antworten-aktualisiert', { updatedResponsesCount: result.updatedResponsesCount })
    ];

    if (result.skippedAlreadyCodedCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.bereits-vorhandene-kodierungen-nicht-ueberschrieben-antworten', { skippedAlreadyCodedCount: result.skippedAlreadyCodedCount })
      );
    }

    if (result.overwrittenExistingCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.vorhandene-kodierungen-ueberschrieben-antworten', { overwrittenExistingCount: result.overwrittenExistingCount })
      );
    }

    if (result.skippedReviewCount > 0) {
      parts.push(
        this.uiTranslate('ui-text.coding-jobs.uebersprungen-manuelle-pruefung-benoetigt-antworten', { skippedReviewCount: result.skippedReviewCount })
      );
    }

    return parts.join('\n');
  }

  protected getAggregationSettingsText(job: CodingJob): string {
    if (!job.aggregationSettingsVersion) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.aggregation-aeltere-jobs-nutzen-aktuelle-workspace-einstellungen');
    }

    if (
      !job.aggregationEnabled ||
      job.aggregationThreshold === null ||
      job.aggregationThreshold === undefined
    ) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.aggregation-beim-erstellen-aus');
    }

    const flags = job.responseMatchingFlags || [];
    const matchingText =
      flags.length > 0 ?
        flags
          .map(flag => this.getResponseMatchingFlagLabel(flag))
          .join(', ') :
        this.uiTranslate('ui-text.coding-job-result-dialog.exakte-uebereinstimmung');

    return `Aggregation beim Erstellen: Schwellenwert ${job.aggregationThreshold}, ${matchingText}`;
  }

  private getResponseMatchingFlagLabel(flag: string): string {
    switch (flag) {
      case 'IGNORE_CASE':
        return this.uiTranslate('ui-text.coding-job-result-dialog.gross-kleinschreibung-ignoriert');
      case 'IGNORE_WHITESPACE':
        return this.uiTranslate('ui-text.coding-job-result-dialog.leerzeichen-ignoriert');
      case 'NO_AGGREGATION':
        return this.uiTranslate('ui-text.coding-job-result-dialog.nicht-aggregiert');
      default:
        return flag;
    }
  }

  private notifyCodingResultsApplied(workspaceId: number): void {
    this.testPersonCodingService.notifyTestResultsChanged({
      workspaceId,
      statisticsVersion: 'v2'
    });
  }

  bulkApplyCodingResults(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const confirmMessage = [
      this.uiTranslate('ui-text.coding-jobs.moechten-sie-die-ergebnisse-fuer-alle-geeigneten-kodierjobs-anwenden'),
      this.uiTranslate('ui-text.coding-jobs.bei-jobs-mit-offenen-kodierungshinweisen-werden-gueltige-antworten-angewendet'),
      this.uiTranslate('ui-text.coding-jobs.offene-hinweise-bleiben-zur-manuellen-pruefung-bestehen')
    ].join(' ');

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: this.uiTranslate('ui-text.coding-jobs.massenanwendung-bestaetigen'),
        message: confirmMessage,
        confirmButtonText: this.uiTranslate('coding.trainings.compare.apply-dialog.apply'),
        cancelButtonText: this.uiTranslate('cancel')
      }
    });

    this.observeWorkspaceDialog(dialogRef).subscribe(result => {
      if (result) {
        this.performBulkApply(workspaceId);
      }
    });
  }

  private performBulkApply(workspaceId: number): void {
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), {
        duration: 3000
      });
      return;
    }

    const loadingSnack = this.snackBar.open(
      this.uiTranslate('ui-text.coding-jobs.wende-ergebnisse-fuer-alle-geeigneten-kodierjobs-an'),
      '',
      { duration: 3000 }
    );

    this.codingJobBackendService.bulkApplyCodingResults(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        loadingSnack.dismiss();
        if (result.success) {
          const skippedCount = result.results.filter(
            (r: BulkApplyResultItem) => r.skipped
          ).length;
          const failedCount = result.results.filter(
            (r: BulkApplyResultItem) => r.result && !r.result.success
          ).length;
          const processedCount = result.jobsProcessed;
          const alreadyCodedInfo =
            result.totalSkippedAlreadyCoded > 0 ?
              this.uiTranslate('ui-text.coding-jobs.vorhandene-kodierungen-beibehalten', { totalSkippedAlreadyCoded: result.totalSkippedAlreadyCoded }) :
              '';
          const failedInfo =
            failedCount > 0 ?
              this.uiTranslate('ui-text.coding-jobs.jobs-mit-konflikten-fehlern-nicht-angewendet', { failedCount: failedCount }) :
              '';
          const reviewInfo =
            result.totalSkippedReview > 0 ?
              this.uiTranslate('ui-text.coding-jobs.ergebnisse-zur-manuellen-pruefung-offen', { totalSkippedReview: result.totalSkippedReview }) :
              '';
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.massenanwendung-abgeschlossen-jobs-verarbeitet-antworten-aktualisiert', {
              processedCount: processedCount, totalUpdatedResponses: result.totalUpdatedResponses, alreadyCodedInfo: alreadyCodedInfo, reviewInfo: reviewInfo, value5: skippedCount > 0 ? this.uiTranslate('ui-text.coding-jobs.jobs-uebersprungen', { skippedCount: skippedCount }) : '', failedInfo: failedInfo
            }),
            this.uiTranslate('deferred-view.close'),
            { duration: 5000 }
          );
          this.loadCodingJobs(); // Refresh the list
          this.notifyCodingResultsApplied(workspaceId);
          this.jobsChanged.emit();
        } else {
          this.snackBar.open(
            this.uiTranslate('ui-text.coding-jobs.fehler-bei-der-massenanwendung', { message: result.message }),
            this.uiTranslate('deferred-view.close'),
            { duration: 5000 }
          );
        }
      },
      error: error => {
        loadingSnack.dismiss();
        this.snackBar.open(
          this.uiTranslate('ui-text.coding-jobs.fehler-bei-der-massenanwendung-473110', { value1: error.message || this.uiTranslate('error.unknown') }),
          this.uiTranslate('deferred-view.close'),
          { duration: 5000 }
        );
      }
    });
  }
}
