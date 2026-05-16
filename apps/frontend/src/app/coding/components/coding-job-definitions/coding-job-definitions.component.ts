import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  Output,
  EventEmitter,
  Input
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import {
  CodingJobDefinitionDialogComponent,
  CodingJobDefinitionDialogData
} from '../coding-job-definition-dialog/coding-job-definition-dialog.component';
import {
  CodingJobBulkCreationDialogComponent,
  BulkCreationData
} from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';

interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  assignedCoderConfigs?: { coderId: number; capacityPercent: number }[];
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  blockingCreatedJobsCount?: number;
  created_at?: Date;
  updated_at?: Date;
}

interface Coder {
  id: number;
  name: string;
  capacityPercent?: number;
}

@Component({
  selector: 'coding-box-coding-job-definitions',
  templateUrl: './coding-job-definitions.component.html',
  styleUrls: ['./coding-job-definitions.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatCardModule,
    MatChipsModule,
    MatTooltipModule
  ]
})
export class CodingJobDefinitionsComponent implements OnInit, OnDestroy {
  private codingJobBackendService = inject(CodingJobBackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private codingJobService = inject(CodingJobService);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  jobDefinitions: JobDefinition[] = [];
  isLoading = false;
  isBulkCreating = false;
  coders: Coder[] = [];
  showInfo = false;
  private readonly variablePreviewLimit = 12;
  private expandedVariableDefinitions = new WeakSet<JobDefinition>();

  displayedColumns: string[] = [
    'actions',
    'status',
    'variables',
    'codersCount',
    'bundlesCount'
  ];

  @Output() bulkCreationCompleted = new EventEmitter<void>();
  @Output() jobDefinitionChanged = new EventEmitter<void>();
  @Input() selectionMode = false;
  @Output() definitionSelected = new EventEmitter<JobDefinition>();

  ngOnInit(): void {
    this.loadCoders();
    this.loadJobDefinitions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Public method to refresh job definitions from parent component
   */
  refresh(): void {
    this.loadJobDefinitions();
  }

  private loadCoders(): void {
    this.coderService
      .getCoders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: coders => {
          this.coders = coders || [];
        },
        error: () => {
          this.coders = [];
        }
      });
  }

  private loadJobDefinitions(): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      this.isLoading = false;
      return;
    }

    this.codingJobBackendService
      .getJobDefinitions(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: definitions => {
          this.jobDefinitions = definitions;
          this.isLoading = false;
        },
        error: error => {
          this.showError(
            this.translateService.instant('error.general', {
              error: error.message
            })
          );
          this.isLoading = false;
        }
      });
  }

  getCoderNames(definition: JobDefinition): string {
    if (!definition.assignedCoders || definition.assignedCoders.length === 0) {
      return '-';
    }
    const coderNames = definition.assignedCoders
      .map(id => this.coders.find(c => c.id === id)?.name)
      .filter(name => name)
      .join(', ');
    return coderNames || '-';
  }

  getBundleNames(definition: JobDefinition): string {
    if (
      !definition.assignedVariableBundles ||
      definition.assignedVariableBundles.length === 0
    ) {
      return '-';
    }
    return definition.assignedVariableBundles
      .map(bundle => bundle.name)
      .join(', ');
  }

  getVariableNames(definition: JobDefinition): string {
    if (
      !definition.assignedVariables ||
      definition.assignedVariables.length === 0
    ) {
      return '-';
    }
    return definition.assignedVariables
      .map(variable => `${variable.unitName}.${variable.variableId}`)
      .join(', ');
  }

  getVariableItems(definition: JobDefinition): string[] {
    if (!definition.assignedVariables || definition.assignedVariables.length === 0) {
      return [];
    }
    return definition.assignedVariables.map(
      variable => `${variable.unitName}.${variable.variableId}`
    );
  }

  getVisibleVariableItems(definition: JobDefinition): string[] {
    const variables = this.getVariableItems(definition);
    if (this.isVariableListExpanded(definition)) {
      return variables;
    }
    return variables.slice(0, this.variablePreviewLimit);
  }

  hasHiddenVariables(definition: JobDefinition): boolean {
    return this.getVariableItems(definition).length > this.variablePreviewLimit;
  }

  getHiddenVariableCount(definition: JobDefinition): number {
    return Math.max(0, this.getVariableItems(definition).length - this.variablePreviewLimit);
  }

  isVariableListExpanded(definition: JobDefinition): boolean {
    return this.expandedVariableDefinitions.has(definition);
  }

  toggleVariableList(definition: JobDefinition, event: Event): void {
    event.stopPropagation();
    if (this.expandedVariableDefinitions.has(definition)) {
      this.expandedVariableDefinitions.delete(definition);
      return;
    }
    this.expandedVariableDefinitions.add(definition);
  }

  getStatusLabel(status?: string): string {
    if (!status) {
      return '-';
    }

    return (
      this.translateService.instant(
        `coding-job-definition-dialog.status.definition.${status}`
      ) ||
      status ||
      '-'
    );
  }

  getDefinitionCountByStatus(
    status: NonNullable<JobDefinition['status']>
  ): number {
    return this.jobDefinitions.filter(definition => definition.status === status)
      .length;
  }

  getDefinitionsReadyForJobsCount(): number {
    return this.jobDefinitions.filter(definition => this.canCreateCodingJobs(definition)).length;
  }

  getStatusHint(status?: JobDefinition['status']): string {
    if (!status) {
      return '';
    }

    return this.translateService.instant(
      `coding-job-definitions.status-hints.${status}`
    );
  }

  getDefinitionStatusHint(definition: JobDefinition): string {
    const createdJobsCount = this.getCreatedJobsCount(definition);

    if (definition.status === 'approved' && createdJobsCount === undefined) {
      return this.translateService.instant(
        'coding-job-definitions.status-hints.approved_count_unavailable'
      );
    }

    if (definition.status === 'approved' && createdJobsCount !== undefined && createdJobsCount > 0) {
      return this.translateService.instant(
        'coding-job-definitions.status-hints.approved_created',
        { count: createdJobsCount }
      );
    }

    return this.getStatusHint(definition.status);
  }

  getActionAriaLabel(action: string, definition: JobDefinition): string {
    const createdJobsCount = this.getCreatedJobsCount(definition);
    const actionKey = action === 'jobs-already-created' && createdJobsCount === undefined ?
      'jobs-count-unavailable' :
      action;
    const params = actionKey === 'jobs-already-created' && createdJobsCount !== undefined ?
      { count: createdJobsCount } :
      undefined;
    const actionLabel = this.translateService.instant(
      `coding-job-definitions.actions.${actionKey}`,
      params
    );

    if (!definition.id) {
      return actionLabel;
    }

    return `${actionLabel}: Definition ${definition.id}`;
  }

  getCreatedJobsCount(definition: JobDefinition): number | undefined {
    const count = definition.createdJobsCount;

    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return undefined;
    }

    return Math.max(0, count);
  }

  getBlockingCreatedJobsCount(definition: JobDefinition): number | undefined {
    const count = definition.blockingCreatedJobsCount;

    if (typeof count !== 'number' || !Number.isFinite(count)) {
      return undefined;
    }

    return Math.max(0, count);
  }

  canCreateCodingJobs(definition: JobDefinition): boolean {
    return definition.status === 'approved' && this.getCreatedJobsCount(definition) === 0;
  }

  canModifyDefinition(definition: JobDefinition): boolean {
    return this.getCreatedJobsCount(definition) === 0;
  }

  canDeleteDefinition(definition: JobDefinition): boolean {
    return this.getBlockingCreatedJobsCount(definition) === 0;
  }

  getEditDefinitionLabel(definition: JobDefinition): string {
    return this.translateService.instant(
      this.canModifyDefinition(definition) ?
        'coding-job-definitions.actions.edit' :
        'coding-job-definitions.actions.view'
    );
  }

  getEditDefinitionIcon(definition: JobDefinition): string {
    return this.canModifyDefinition(definition) ? 'edit' : 'visibility';
  }

  getEditDefinitionTooltip(definition: JobDefinition): string {
    if (this.canModifyDefinition(definition)) {
      return this.translateService.instant('coding-job-definitions.actions.edit');
    }

    return this.translateService.instant('coding-job-definitions.actions.view-readonly');
  }

  getCreateCodingJobsTooltip(definition: JobDefinition): string {
    const createdJobsCount = this.getCreatedJobsCount(definition);

    if (createdJobsCount === undefined) {
      return this.translateService.instant(
        'coding-job-definitions.actions.jobs-count-unavailable'
      );
    }

    if (createdJobsCount > 0) {
      return this.translateService.instant(
        'coding-job-definitions.actions.jobs-already-created',
        { count: createdJobsCount }
      );
    }

    return this.translateService.instant('coding-job-definitions.actions.create-coding-jobs');
  }

  getCreateCodingJobsActionLabel(definition: JobDefinition): string {
    const createdJobsCount = this.getCreatedJobsCount(definition);

    if (createdJobsCount === undefined) {
      return this.translateService.instant(
        'coding-job-definitions.actions.jobs-count-unavailable-short'
      );
    }

    return this.translateService.instant(
      'coding-job-definitions.actions.jobs-created-short',
      { count: createdJobsCount }
    );
  }

  getDeleteDefinitionTooltip(definition: JobDefinition): string {
    if (this.canDeleteDefinition(definition)) {
      return this.translateService.instant('coding-job-definitions.actions.delete');
    }

    const blockingCreatedJobsCount = this.getBlockingCreatedJobsCount(definition);
    if (blockingCreatedJobsCount === undefined) {
      return this.translateService.instant(
        'coding-job-definitions.actions.jobs-count-unavailable'
      );
    }

    return this.translateService.instant(
      'coding-job-definitions.actions.jobs-still-blocking',
      { count: blockingCreatedJobsCount }
    );
  }

  createDefinition(): void {
    const dialogData: CodingJobDefinitionDialogData = {
      isEdit: false,
      mode: 'definition'
    };

    const dialogRef = this.dialog.open(CodingJobDefinitionDialogComponent, {
      width: '95vw',
      maxWidth: '1600px',
      height: '90vh',
      data: dialogData,
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadJobDefinitions();
        this.jobDefinitionChanged.emit();
      }
    });
  }

  selectDefinition(definition: JobDefinition): void {
    if (this.selectionMode) {
      this.definitionSelected.emit(definition);
    }
  }

  editDefinition(definition: JobDefinition): void {
    const workspaceId = this.appService.selectedWorkspaceId!;
    const dialogData: CodingJobDefinitionDialogData = {
      isEdit: true,
      mode: 'definition',
      jobDefinitionId: definition.id,
      readOnly: !this.canModifyDefinition(definition),
      codingJob: {
        id: definition.id!,
        workspace_id: workspaceId,
        name: `Definition ${definition.id!}`,
        status: definition.status!,
        assignedVariables: definition.assignedVariables,
        assignedVariableBundles: definition.assignedVariableBundles,
        assignedCoders: definition.assignedCoders!,
        assignedCoderConfigs: definition.assignedCoderConfigs,
        durationSeconds: definition.durationSeconds,
        maxCodingCases: definition.maxCodingCases,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage,
        caseOrderingMode: definition.caseOrderingMode,
        showScore: definition.showScore,
        allowComments: definition.allowComments,
        suppressGeneralInstructions: definition.suppressGeneralInstructions,
        created_at: definition.created_at!,
        updated_at: definition.updated_at!
      }
    };

    const dialogRef = this.dialog.open(CodingJobDefinitionDialogComponent, {
      width: '95vw',
      maxWidth: '1600px',
      height: '90vh',
      data: dialogData,
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadJobDefinitions();
        this.jobDefinitionChanged.emit();
      }
    });
  }

  submitForReview(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      return;
    }

    this.codingJobBackendService
      .updateJobDefinition(workspaceId, definition.id, {
        status: 'pending_review'
      })
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.submitted-for-review'
            ),
            this.translateService.instant('common.close'),
            { duration: 3000 }
          );
          this.loadJobDefinitions();
          this.jobDefinitionChanged.emit();
        },
        error: error => {
          this.showError(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.submit-failed',
              { error: error.message }
            )
          );
        }
      });
  }

  approveDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      return;
    }

    this.codingJobBackendService
      .approveJobDefinition(workspaceId, definition.id, 'approved')
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.approved'
            ),
            this.translateService.instant('common.close'),
            { duration: 3000 }
          );
          this.loadJobDefinitions();
          this.jobDefinitionChanged.emit();
        },
        error: error => {
          this.showError(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.approve-failed',
              { error: error.message }
            )
          );
        }
      });
  }

  rejectDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      return;
    }

    this.codingJobBackendService
      .updateJobDefinition(workspaceId, definition.id, { status: 'draft' })
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.rejected'
            ),
            this.translateService.instant('common.close'),
            { duration: 3000 }
          );
          this.loadJobDefinitions();
          this.jobDefinitionChanged.emit();
        },
        error: error => {
          this.showError(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.reject-failed',
              { error: error.message }
            )
          );
        }
      });
  }

  deleteDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    if (!this.canDeleteDefinition(definition)) {
      this.showError(this.getDeleteDefinitionTooltip(definition));
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      return;
    }

    this.codingJobBackendService
      .deleteJobDefinition(workspaceId, definition.id)
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.deleted'
            ),
            this.translateService.instant('common.close'),
            { duration: 3000 }
          );
          this.loadJobDefinitions();
          this.jobDefinitionChanged.emit();
        },
        error: error => {
          this.showError(
            this.translateService.instant(
              'coding-job-definitions.messages.snackbar.delete-failed',
              { error: error.message }
            )
          );
        }
      });
  }

  async createCodingJobFromDefinition(
    definition: JobDefinition
  ): Promise<void> {
    if (!definition.id || !definition.assignedCoders) {
      return;
    }

    if (!this.canCreateCodingJobs(definition)) {
      this.snackBar.open(
        this.getCreateCodingJobsTooltip(definition),
        this.translateService.instant('common.close'),
        { duration: 4000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.no-workspace'
        )
      );
      return;
    }

    try {
      const allCoders = await firstValueFrom(this.coderService.getCoders());
      const capacityByCoderId = new Map(
        (definition.assignedCoderConfigs || [])
          .map(config => [config.coderId, config.capacityPercent])
      );
      const selectedCoders =
        allCoders?.filter(coder => definition.assignedCoders!.includes(coder.id)
        )
          .map(coder => ({
            ...coder,
            capacityPercent: capacityByCoderId.get(coder.id) ?? 100
          })) || [];

      const dialogData: BulkCreationData = {
        selectedVariables: definition.assignedVariables || [],
        selectedVariableBundles: definition.assignedVariableBundles || [],
        selectedCoders: selectedCoders,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage,
        caseOrderingMode: definition.caseOrderingMode || 'continuous',
        maxCodingCases: definition.maxCodingCases,
        distributionSeed: definition.distributionSeed,
        displayOptions: {
          showScore: definition.showScore ?? false,
          allowComments: definition.allowComments ?? true,
          suppressGeneralInstructions: definition.suppressGeneralInstructions ?? false
        },
        displayOptionsLocked: true
      };
      const dialogRef = this.dialog.open(CodingJobBulkCreationDialogComponent, {
        width: '1200px',
        data: dialogData
      });

      const result = await firstValueFrom(dialogRef.afterClosed());

      if (result && result.confirmed) {
        await this.createBulkJobsFromDefinition(
          workspaceId,
          definition.id
        );
      }
    } catch (error) {
      this.showError(
        this.translateService.instant(
          'coding-job-definitions.messages.snackbar.coders-loading-failed',
          { error: (error as Error).message }
        )
      );
    }
  }

  private async createBulkJobsFromDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<void> {
    this.isBulkCreating = true;
    try {
      const result = await firstValueFrom(
        this.codingJobBackendService.createCodingJobFromDefinition(
          workspaceId,
          jobDefinitionId
        )
      );

      if (result && result.success) {
        this.snackBar.open(
          this.translateService.instant(
            'coding-job-definitions.messages.snackbar.jobs-created',
            { count: result.jobsCreated }
          ),
          this.translateService.instant('common.close'),
          { duration: 3000 }
        );
      } else if (result) {
        this.snackBar.open(
          this.translateService.instant(
            'coding-job-definition-dialog.snackbars.bulk-creation-failed-with-message',
            { message: result.message }
          ),
          this.translateService.instant('common.close'),
          { duration: 5000 }
        );
      } else {
        this.snackBar.open(
          this.translateService.instant(
            'coding-job-definition-dialog.snackbars.bulk-creation-no-response'
          ),
          this.translateService.instant('common.close'),
          { duration: 5000 }
        );
      }
    } catch (error) {
      this.snackBar.open(
        this.translateService.instant(
          'coding-job-definition-dialog.snackbars.bulk-creation-failed',
          { error: error instanceof Error ? error.message : error }
        ),
        this.translateService.instant('common.close'),
        { duration: 5000 }
      );
    } finally {
      this.isBulkCreating = false;
    }

    this.loadJobDefinitions();
    this.bulkCreationCompleted.emit();
    // Emit event for auto-refresh in dialog
    this.codingJobService.jobsCreatedEvent.emit();
  }

  private showError(message: string): void {
    this.snackBar.open(message, this.translateService.instant('common.close'), {
      duration: 5000
    });
  }
}
