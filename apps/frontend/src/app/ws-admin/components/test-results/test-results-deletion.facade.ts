import {
  DestroyRef, Injectable, computed, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, Subject, Subscription, exhaustMap, finalize, take, takeUntil, takeWhile, timer
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestResultsDeleteRequestDto, TestResultsResponseCleanupRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';
import { TestResultsDeletePreviewDialogComponent } from './test-results-delete-preview-dialog.component';
import { TestResultsResponseCleanupDialogComponent } from './test-results-response-cleanup-dialog.component';
import { Response, Unit, TestResultsDeleteCommand as DeleteCommand } from './test-results.models';
import { TestResultsDeletionTaskStore } from './test-results-deletion-task.store';

type DeleteFailure = 'preview' | 'start' | 'poll' | 'result' | 'job';
export type TestResultsDeletionChange = { scope: 'workspace' } |
{ scope: 'unit'; unitId: number; bookletId: number } |
{ scope: 'response'; responseId: number };
interface DeleteOperation {
  workspaceId: number;
  command?: DeleteCommand;
  taskId?: number;
  terminalChangeEmitted: boolean;
  mutationStarted?: boolean;
}

@Injectable()
export class TestResultsDeletionFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly jobs = inject(TestResultsDeletionTaskStore);
  private readonly appService = inject(AppService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly testResultService = inject(TestResultService);
  private readonly responseService = inject(ResponseService);
  private readonly unitService = inject(UnitService);
  private readonly validationService = inject(ValidationService);
  private readonly validationTaskStateService = inject(ValidationTaskStateService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly resetDetailsSubject = new Subject<void>();
  readonly resetDetails$ = this.resetDetailsSubject.asObservable();
  private readonly selectionClearedSubject = new Subject<void>();
  readonly selectionCleared$ = this.selectionClearedSubject.asObservable();
  private readonly changedSubject = new Subject<TestResultsDeletionChange>();
  readonly changed$ = this.changedSubject.asObservable();
  private readonly cancelled = new Subject<void>();
  private operation?: DeleteOperation;
  private polling?: Subscription;
  private readonly activeDeleteTaskState = signal<ValidationTaskDto | null>(null);
  readonly activeDeleteTask = this.activeDeleteTaskState.asReadonly();
  private readonly isDeletingTestPersonsState = signal(false);
  readonly isDeletingTestPersons = this.isDeletingTestPersonsState.asReadonly();
  private readonly deleteProgressState = signal(0);
  readonly deleteProgress = this.deleteProgressState.asReadonly();
  private readonly deleteProgressMessageState = signal('');
  readonly deleteProgressMessage = this.deleteProgressMessageState.asReadonly();
  private readonly failure = signal<DeleteFailure | null>(null);
  readonly canRetry = computed(() => this.failure() !== null);
  readonly retryLabelKey = computed(() => {
    if (this.failure() === 'poll') return 'test-results-page.deletion.retry-progress';
    if (this.failure() === 'result') return 'test-results-page.deletion.retry-result';
    return 'test-results-page.deletion.retry-preview';
  });

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { workspaceId = id; this.clearOperation(); this.recoverJob(id); }
    });
    this.recoverJob(workspaceId);
    this.destroyRef.onDestroy(() => {
      this.clearOperation(); this.cancelled.complete();
      this.resetDetailsSubject.complete(); this.selectionClearedSubject.complete(); this.changedSubject.complete();
    });
  }

  isDeleteJobRunning(): boolean {
    return this.isDeletingTestPersons() || this.failure() === 'poll' ||
      this.activeDeleteTask()?.status === 'pending' || this.activeDeleteTask()?.status === 'processing';
  }

  confirmAndStartDelete(request: TestResultsDeleteRequestDto): void {
    this.preview({ kind: 'results', request: this.snapshotRequest(request) });
  }

  confirmAndStartResponseCleanup(request: TestResultsResponseCleanupRequestDto): void {
    this.preview({ kind: 'responses', request: this.snapshotRequest(request) });
  }

  openResponseCleanupDialog(): void {
    if (this.isDeleteJobRunning() || !this.appService.selectedWorkspaceId) return;
    const operation = this.begin();
    const ref = this.dialog.open(TestResultsResponseCleanupDialogComponent, {
      width: '640px', maxWidth: '95vw', data: { workspaceId: operation.workspaceId }
    });
    this.scoped(ref.afterClosed(), operation).pipe(take(1), finalize(() => ref.close?.())).subscribe(request => {
      this.clearOperation();
      if (request) this.confirmAndStartResponseCleanup(request);
    });
  }

  retry(): void {
    const operation = this.operation;
    if (!operation || !this.canRetry() || operation.workspaceId !== this.appService.selectedWorkspaceId) return;
    if (this.failure() === 'poll' && operation.taskId !== undefined) this.monitorTask(operation, operation.taskId);
    else if (this.failure() === 'result' && operation.taskId !== undefined) this.loadResult(operation, operation.taskId);
    else if (operation.command) this.preview(operation.command);
  }

  private preview(command: DeleteCommand): void {
    if (this.isDeleteJobRunning() || !this.appService.selectedWorkspaceId) return;
    const operation = this.begin(command);
    const preview = command.kind === 'results' ?
      this.testResultService.previewDeleteTestResults(operation.workspaceId, command.request) :
      this.testResultService.previewDeleteTestResultResponses(operation.workspaceId, command.request);
    this.scoped(preview, operation).subscribe({
      next: result => {
        if (!result) { this.fail('preview', 'preview-error'); return; }
        const ref = this.dialog.open(TestResultsDeletePreviewDialogComponent, {
          width: command.kind === 'results' ? '680px' : '760px', maxWidth: '95vw', data: { preview: result }
        });
        this.scoped(ref.afterClosed(), operation).pipe(take(1), finalize(() => ref.close?.())).subscribe(confirmed => {
          if (confirmed === true) this.startJob(operation, command);
          else this.clearOperation();
        });
      },
      error: () => this.fail('preview', 'preview-error')
    });
  }

  private startJob(operation: DeleteOperation, command: DeleteCommand): void {
    if (!this.isCurrent(operation)) return;
    this.resetDetailsSubject.next();
    operation.mutationStarted = true;
    this.invalidateWorkspace(operation.workspaceId);
    this.deleteProgressMessageState.set(this.message('starting'));
    const start = command.kind === 'results' ?
      this.testResultService.createDeleteTestResultsJob(operation.workspaceId, command.request) :
      this.testResultService.createDeleteTestResultResponsesJob(operation.workspaceId, command.request);
    this.scoped(start, operation).subscribe({
      next: task => {
        this.jobs.remember(operation.workspaceId, task, command);
        this.activeDeleteTaskState.set(task); this.monitorTask(operation, task.id);
      },
      error: () => this.fail('start', 'start-error')
    });
  }

  // A known job is only read again on retry; its destructive POST is never repeated.
  pollDeleteTask(taskId: number): void {
    this.monitorTask(this.begin(), taskId);
  }

  private monitorTask(operation: DeleteOperation, taskId: number): void {
    if (!this.isCurrent(operation)) return;
    this.polling?.unsubscribe();
    operation.taskId = taskId;
    this.failure.set(null);
    this.isDeletingTestPersonsState.set(true);
    this.polling = this.scoped(timer(0, 1000).pipe(
      exhaustMap(() => this.validationService.getValidationTask(operation.workspaceId, taskId)),
      takeWhile(task => task.status === 'pending' || task.status === 'processing', true)
    ), operation).subscribe({
      next: task => {
        this.jobs.remember(operation.workspaceId, task, operation.command);
        this.activeDeleteTaskState.set(task);
        this.deleteProgressState.set(task.progress ?? 0);
        this.deleteProgressMessageState.set(task.progress_message || this.message('running'));
        if (task.status === 'completed') {
          this.emitTerminalChange(operation);
          this.loadResult(operation, taskId);
        } else if (task.status === 'failed') {
          // Each backend batch commits separately, so a failed job may already have deleted rows.
          this.emitTerminalChange(operation);
          if (this.isCurrent(operation)) this.fail(operation.command ? 'job' : null, 'job-error', { detail: task.error || '' });
        }
      },
      error: () => this.fail('poll', 'poll-error')
    });
  }

  private loadResult(operation: DeleteOperation, taskId: number): void {
    if (!this.isCurrent(operation)) return;
    this.failure.set(null);
    this.isDeletingTestPersonsState.set(true);
    this.deleteProgressState.set(100);
    this.scoped(this.validationService.getValidationResults(operation.workspaceId, taskId), operation).subscribe({
      next: result => {
        if (!result || typeof result !== 'object' || !('deletedTargetCount' in result) ||
          !Number.isSafeInteger(result.deletedTargetCount) || (result.deletedTargetCount as number) < 0) {
          this.fail('result', 'result-error'); return;
        }
        this.isDeletingTestPersonsState.set(false);
        this.activeDeleteTaskState.set(null);
        this.deleteProgressState.set(100);
        this.deleteProgressMessageState.set('');
        const warnings = 'warnings' in result && Array.isArray(result.warnings) ? result.warnings.filter(warning => typeof warning === 'string') : [];
        this.snackBar.open(this.message(warnings.length ? 'completed-with-warnings' : 'completed', {
          count: result.deletedTargetCount, warnings: warnings.join(', ')
        }), 'OK', { duration: warnings.length ? 6000 : 4000 });
      },
      error: () => this.fail('result', 'result-error')
    });
  }

  deleteUnit(unit: Unit, booklet: { id: number }): void {
    if (!unit.id) { this.snackBar.open(this.message('unit-no-id'), 'OK', { duration: 3000 }); return; }
    this.confirmSingle('unit', { label: unit.alias || unit.name || this.message('unnamed-unit') }, workspaceId => this.unitService.deleteUnit(workspaceId, unit.id), { scope: 'unit', unitId: unit.id, bookletId: booklet.id });
  }

  deleteResponse(response: Response): void {
    if (!response.id) { this.snackBar.open(this.message('response-no-id'), 'OK', { duration: 3000 }); return; }
    this.confirmSingle('response', { label: response.variableid }, workspaceId => this.responseService.deleteResponse(workspaceId, response.id), { scope: 'response', responseId: response.id });
  }

  private confirmSingle(kind: 'unit' | 'response', params: { label: string },
                        remove: (workspaceId: number) => Observable<{ success: boolean; report: { warnings: string[] } }>, change: TestResultsDeletionChange): void {
    if (this.isDeleteJobRunning() || !this.appService.selectedWorkspaceId) return;
    const operation = this.begin();
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.message(`${kind}-title`),
        content: this.message(`${kind}-confirmation`, params),
        confirmButtonLabel: this.message('confirm'),
        showCancel: true
      }
    });
    this.scoped(ref.afterClosed(), operation).pipe(take(1), finalize(() => ref.close?.())).subscribe(confirmed => {
      if (confirmed !== true) { this.clearOperation(); return; }
      operation.mutationStarted = true;
      this.invalidateWorkspace(operation.workspaceId);
      this.scoped(remove(operation.workspaceId), operation).subscribe({
        next: result => {
          this.isDeletingTestPersonsState.set(false);
          this.notifyChange(operation, result.success ? change : { scope: 'workspace' });
          this.snackBar.open(this.message(`${kind}-${result.success ? 'completed' : 'error'}`, {
            ...params, warnings: result.report.warnings.join(', ')
          }), 'OK', { duration: 4000 });
        },
        error: () => {
          this.isDeletingTestPersonsState.set(false);
          this.notifyChange(operation, { scope: 'workspace' });
          this.snackBar.open(this.message(`${kind}-error`, { ...params, warnings: '' }), 'OK', { duration: 4000 });
        }
      });
    });
  }

  private recoverJob(workspaceId: number): void {
    const known = this.jobs.get(workspaceId);
    if (!known) return;
    const operation = this.begin(known.command);
    operation.mutationStarted = true;
    this.activeDeleteTaskState.set(known.task);
    this.deleteProgressState.set(known.task.progress ?? 0);
    this.monitorTask(operation, known.task.id);
  }

  private invalidateWorkspace(workspaceId: number): void {
    this.testResultService.invalidateCache(workspaceId);
    this.validationTaskStateService.invalidateWorkspace(workspaceId);
  }

  private begin(command?: DeleteCommand): DeleteOperation {
    this.clearOperation();
    this.operation = { workspaceId: this.appService.selectedWorkspaceId, command, terminalChangeEmitted: false };
    this.isDeletingTestPersonsState.set(true);
    this.deleteProgressMessageState.set(this.message('preparing'));
    return this.operation;
  }

  private clearOperation(): void {
    if (this.operation?.mutationStarted && !this.operation.terminalChangeEmitted) this.invalidateWorkspace(this.operation.workspaceId);
    this.cancelled.next();
    this.polling?.unsubscribe();
    this.operation = undefined;
    this.failure.set(null);
    this.isDeletingTestPersonsState.set(false);
    this.activeDeleteTaskState.set(null);
    this.deleteProgressState.set(0);
    this.deleteProgressMessageState.set('');
  }

  private scoped<T>(source: Observable<T>, operation: DeleteOperation): Observable<T> {
    return source.pipe(takeUntil(this.cancelled), takeUntilWorkspaceChanged(this.appService, operation.workspaceId), takeUntilDestroyed(this.destroyRef));
  }

  private isCurrent(operation: DeleteOperation): boolean {
    return this.operation === operation && operation.workspaceId === this.appService.selectedWorkspaceId && !this.destroyRef.destroyed;
  }

  private emitTerminalChange(operation: DeleteOperation): void {
    if (operation.terminalChangeEmitted) return;
    operation.terminalChangeEmitted = true;
    this.notifyChange(operation, { scope: 'workspace' });
  }

  private notifyChange(operation: DeleteOperation, change: TestResultsDeletionChange): void {
    operation.terminalChangeEmitted = true;
    const { workspaceId } = operation;
    this.invalidateWorkspace(workspaceId);
    if (change.scope === 'workspace') { this.resetDetailsSubject.next(); this.selectionClearedSubject.next(); }
    this.testPersonCodingService.notifyTestResultsChanged({ workspaceId });
    this.changedSubject.next(change);
  }

  private fail(failure: DeleteFailure | null, key: string, params?: Record<string, unknown>): void {
    this.failure.set(failure);
    this.isDeletingTestPersonsState.set(false);
    this.deleteProgressMessageState.set(this.message(key, params));
    this.snackBar.open(this.deleteProgressMessage(), 'OK', { duration: 5000 });
  }

  private snapshotRequest<T extends DeleteCommand['request']>(request: T): T {
    return Object.fromEntries(Object.entries(request).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) as T;
  }

  private message(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(`test-results-page.deletion.${key}`, params);
  }
}
