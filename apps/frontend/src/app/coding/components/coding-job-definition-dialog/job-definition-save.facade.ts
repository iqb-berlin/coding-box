import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  EmptyError, Observable, finalize, firstValueFrom
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { SessionRecoveryService } from '../../../core/services/session-recovery.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingJob } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { DistributedCodingService, DistributionPreviewCoder } from '../../services/distributed-coding.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import {
  BulkCreationData, BulkCreationResult, CodingJobBulkCreationDialogComponent
} from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';
import { JobDefinitionRefreshDialogComponent } from '../coding-job-definitions/job-definition-refresh-dialog.component';
import { CodingJobDefinitionPersistence } from './coding-job-definition-persistence.service';
import { CodingJobDefinitionRules } from './coding-job-definition-rules';
import {
  CODING_JOB_DEFINITION_RECOVERY_KEY, CodingJobDefinitionDialogData, JobDefinition
} from './coding-job-definition.models';

/** Dialog-local owner of writes, confirmation dialogs, feedback and recovery cleanup. */
@Injectable()
export class JobDefinitionSaveFacade {
  private readonly saving = signal(false);
  readonly isSaving = this.saving.asReadonly();

  private readonly backend = inject(CodingJobBackendService);
  private readonly persistence = inject(CodingJobDefinitionPersistence);
  private readonly distribution = inject(DistributedCodingService);
  private readonly app = inject(AppService);
  private readonly dialogs = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<unknown>);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly recovery = inject(SessionRecoveryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rules = new CodingJobDefinitionRules();
  private workspaceGeneration = 0;

  constructor() {
    let workspaceId = this.app.selectedWorkspaceId;
    this.app.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) {
        workspaceId = id;
        this.workspaceGeneration += 1;
      }
    });
  }

  saveJob(job: CodingJob, coderIds: number[], isEdit: boolean): void {
    const workspaceId = this.beginSave();
    if (!workspaceId) return;
    const request = isEdit ? this.persistence.updateJob(workspaceId, job.id!, job, coderIds) :
      this.persistence.createJob(workspaceId, job, coderIds);
    this.watch(request, workspaceId).subscribe({
      next: ({ job: savedJob, assignmentFailed }) => {
        this.saving.set(false);
        this.notify(`job-${isEdit ? 'updated' : 'created'}-${assignmentFailed ? 'coder-failed' : 'success'}`,
          undefined,
          assignmentFailed ? 5000 : 3000);
        this.dialogRef.close(savedJob);
      },
      error: error => this.notify(isEdit ? 'error-updating-job' : 'error-creating-job', { error: error.message }, 5000)
    });
  }

  createDefinition(definition: JobDefinition, forReview = false): void {
    const workspaceId = this.beginSave();
    if (!workspaceId) return;
    this.watch(this.backend.createJobDefinition(workspaceId, definition), workspaceId).subscribe({
      next: saved => {
        this.notify(forReview ? 'definition-submitted-review' : 'definition-created-success');
        this.finishDefinition(saved);
      },
      error: error => this.notify(forReview ? 'error-submitting-review' : 'error-creating-definition',
        { error: this.errorMessage(error) },
        5000)
    });
  }

  async updateDefinition(definition: Partial<JobDefinition>, data: CodingJobDefinitionDialogData): Promise<void> {
    const workspaceId = this.beginSave();
    if (!workspaceId) return;
    const id = data.jobDefinitionId!;
    const hasJobs = (data.createdJobsCount ?? 0) > 0;
    if (hasJobs && this.rules.hasRefreshRelevantDefinitionChanges(data.codingJob, definition)) {
      await this.refreshDefinition(workspaceId, id, definition);
      return;
    }
    const payload = hasJobs ? this.rules.buildExistingJobsDirectUpdatePayload(definition) : definition;
    this.watch(this.backend.updateJobDefinition(workspaceId, id, payload), workspaceId).subscribe({
      next: saved => {
        this.notify('definition-updated-success');
        this.finishDefinition(saved);
      },
      error: error => this.notify('error-updating-definition', { error: this.errorMessage(error) }, 5000)
    });
  }

  async createBulkJobs(data: BulkCreationData, coders: DistributionPreviewCoder[]): Promise<void> {
    const workspaceId = this.beginSave();
    if (!workspaceId) return;
    try {
      const confirmation = this.dialogs.open(CodingJobBulkCreationDialogComponent, { width: '1200px', data });
      const options = await this.dialogResult<BulkCreationResult | false>(confirmation, workspaceId);
      if (!options || !options.confirmed) return;
      const result = await this.awaitInContext(this.distribution.createDistributedCodingJobs(
        workspaceId, data.selectedVariables, coders, data.doubleCodingAbsolute, data.doubleCodingPercentage, data.selectedVariableBundles, data.caseOrderingMode, data.maxCodingCases ?? undefined, {
          showScore: options.showScore,
          allowComments: options.allowComments,
          suppressGeneralInstructions: options.suppressGeneralInstructions
        }, data.distributionSeed
      ), workspaceId);
      if (!result) {
        this.notify('bulk-creation-no-response', undefined, 5000);
      } else if (!result.success) {
        this.notify('bulk-creation-failed-with-message', { message: result.message }, 5000);
      } else {
        this.snackBar.open(result.message, this.translate.instant('common.close'), { duration: 3000 });
        const results = this.dialogs.open(CodingJobBulkCreationDialogComponent, {
          width: '1200px',
          disableClose: false,
          data: {
            ...data,
            creationResults: {
              doubleCodingInfo: result.doubleCodingInfo,
              distributionByCoderId: result.distributionByCoderId,
              jobs: result.jobs
            }
          }
        });
        await this.dialogResult(results, workspaceId);
        this.dialogRef.close({ bulkJobCreation: true, distributedJobs: result.jobs });
      }
    } catch (error) {
      if (!this.wasCancelled(error)) {
        this.notify('bulk-creation-failed', { error: error instanceof Error ? error.message : String(error) }, 5000);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private async refreshDefinition(workspaceId: number, id: number, definition: Partial<JobDefinition>): Promise<void> {
    try {
      const preview = await this.awaitInContext(
        this.backend.previewJobDefinitionUpdateRefresh(workspaceId, id, definition), workspaceId
      );
      const confirmation = this.dialogs.open(JobDefinitionRefreshDialogComponent, {
        width: '640px',
        maxWidth: '95vw',
        autoFocus: false,
        data: {
          definitionId: id,
          definitionLabel: getJobDefinitionDisplayLabel({ id, name: definition.name }),
          preview,
          mode: 'update'
        }
      });
      if (!await this.dialogResult(confirmation, workspaceId)) return;
      const result = await this.awaitInContext(
        this.backend.applyJobDefinitionUpdateRefresh(workspaceId, id, definition), workspaceId
      );
      this.notify('definition-update-refresh-applied', { count: result.jobsCreated }, 4000);
      this.finishDefinition(result);
    } catch (error) {
      if (!this.wasCancelled(error)) this.notify('update-refresh-failed', { error: this.errorMessage(error) }, 5000);
    } finally {
      this.saving.set(false);
    }
  }

  private beginSave(): number | undefined {
    if (this.isSaving() || this.destroyRef.destroyed) return undefined;
    const workspaceId = this.app.selectedWorkspaceId;
    if (!workspaceId) {
      this.notify('no-workspace-selected');
      return undefined;
    }
    this.saving.set(true);
    return workspaceId;
  }

  private inContext<T>(request: Observable<T>, workspaceId: number): Observable<T> {
    return request.pipe(takeUntilWorkspaceChanged(this.app, workspaceId), takeUntilDestroyed(this.destroyRef));
  }

  private watch<T>(request: Observable<T>, workspaceId: number): Observable<T> {
    return this.inContext(request, workspaceId).pipe(finalize(() => this.saving.set(false)));
  }

  private async awaitInContext<T>(request: Observable<T>, workspaceId: number): Promise<T> {
    const generation = this.workspaceGeneration;
    const result = await firstValueFrom(this.inContext(request, workspaceId));
    // A context can change after a synchronous emission but before await resumes.
    if (this.destroyRef.destroyed || generation !== this.workspaceGeneration || this.app.selectedWorkspaceId !== workspaceId) {
      throw new EmptyError();
    }
    return result;
  }

  private async dialogResult<T>(dialog: MatDialogRef<unknown, T>, workspaceId: number): Promise<T | undefined> {
    try {
      return await this.awaitInContext(dialog.afterClosed(), workspaceId);
    } catch (error) {
      if (this.wasCancelled(error)) dialog.close();
      throw error;
    }
  }

  private wasCancelled(error: unknown): boolean {
    return error instanceof EmptyError || this.destroyRef.destroyed;
  }

  private finishDefinition(result: unknown): void {
    this.saving.set(false);
    this.recovery.clearDraft(CODING_JOB_DEFINITION_RECOVERY_KEY);
    this.dialogRef.close(result);
  }

  private notify(key: string, params?: Record<string, unknown>, duration = 3000): void {
    this.snackBar.open(this.translate.instant(`coding-job-definition-dialog.snackbars.${key}`, params),
      this.translate.instant('common.close'),
      { duration });
  }

  private errorMessage(error: unknown): string {
    const err = error as { error?: { message?: string } | string; message?: string } | null;
    if (err?.error) return typeof err.error === 'object' ? err.error.message || JSON.stringify(err.error) : err.error;
    return err?.message || this.translate.instant('common.unknown-error');
  }
}
