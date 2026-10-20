import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  Subject, Subscription, exhaustMap, takeWhile, timer as rxjsTimer, finalize
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import {
  TestResultsDeletePreviewDto, TestResultsDeleteRequestDto, TestResultsDeleteResultDto, TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { TestResultsDeletePreviewDialogComponent } from './test-results-delete-preview-dialog.component';

@Injectable()
export class TestResultsDeletionFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly testResultService = inject(TestResultService);
  private readonly validationService = inject(ValidationService);
  private readonly validationTaskStateService = inject(ValidationTaskStateService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  readonly resetDetails$ = new Subject<void>();
  readonly selectionCleared$ = new Subject<void>();
  readonly changed$ = new Subject<void>();
  readonly activeDeleteTask = signal<ValidationTaskDto | null>(null);

  readonly isDeletingTestPersons = signal<boolean>(false);

  readonly deleteProgress = signal<number>(0);

  readonly deleteProgressMessage = signal<string>('');

  deleteTaskSubscription: Subscription | null = null;

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) {
        this.deleteTaskSubscription?.unsubscribe();
        this.isDeletingTestPersons.set(false); this.activeDeleteTask.set(null);
        workspaceId = id;
      }
    });
    this.destroyRef.onDestroy(() => {
      this.deleteTaskSubscription?.unsubscribe();
      this.resetDetails$.complete(); this.selectionCleared$.complete(); this.changed$.complete();
    });
  }

  isDeleteJobRunning(): boolean {
    return this.activeDeleteTask()?.status === 'pending' ||
      this.activeDeleteTask()?.status === 'processing' ||
      this.isDeletingTestPersons();
  }

  confirmAndStartDelete(request: TestResultsDeleteRequestDto): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    this.isDeletingTestPersons.set(true);

    this.testResultService
      .previewDeleteTestResults(this.appService.selectedWorkspaceId, request).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons.set(false);
          if (!preview) {
            this.snackBar.open(
              'Die Löschvorschau konnte nicht berechnet werden.',
              'Fehler',
              { duration: 4000 }
            );
            return;
          }

          this.openDeletePreviewDialog(request, preview);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.snackBar.open(
            'Die Löschvorschau konnte nicht berechnet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  confirmAndStartResponseCleanup(
    request: TestResultsResponseCleanupRequestDto
  ): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    this.isDeletingTestPersons.set(true);

    this.testResultService
      .previewDeleteTestResultResponses(
        this.appService.selectedWorkspaceId,
        request
      ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons.set(false);
          if (!preview) {
            this.snackBar.open(
              'Die Löschvorschau konnte nicht berechnet werden.',
              'Fehler',
              { duration: 4000 }
            );
            return;
          }

          this.openResponseCleanupPreviewDialog(request, preview);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.snackBar.open(
            'Die Löschvorschau konnte nicht berechnet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  openDeletePreviewDialog(
    request: TestResultsDeleteRequestDto,
    preview: TestResultsDeletePreviewDto
  ): void {
    const dialogRef = this.dialog.open(TestResultsDeletePreviewDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      data: {
        preview
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => dialogRef.close?.())).subscribe(confirmed => {
      if (confirmed) {
        this.startDeleteJob(request);
      }
    });
  }

  openResponseCleanupPreviewDialog(
    request: TestResultsResponseCleanupRequestDto,
    preview: TestResultsDeletePreviewDto
  ): void {
    const dialogRef = this.dialog.open(TestResultsDeletePreviewDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      data: {
        preview
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => dialogRef.close?.())).subscribe(confirmed => {
      if (confirmed) {
        this.startResponseCleanupJob(request);
      }
    });
  }

  startDeleteJob(request: TestResultsDeleteRequestDto): void {
    this.resetDetails$.next();
    this.isDeletingTestPersons.set(true);
    this.deleteProgress.set(0);
    this.deleteProgressMessage.set('Löschung wird gestartet...');

    this.testResultService
      .createDeleteTestResultsJob(this.appService.selectedWorkspaceId, request).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung konnte nicht gestartet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  startResponseCleanupJob(
    request: TestResultsResponseCleanupRequestDto
  ): void {
    this.resetDetails$.next();
    this.isDeletingTestPersons.set(true);
    this.deleteProgress.set(0);
    this.deleteProgressMessage.set('Antwort-Löschung wird gestartet...');

    this.testResultService
      .createDeleteTestResultResponsesJob(
        this.appService.selectedWorkspaceId,
        request
      ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung konnte nicht gestartet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  pollDeleteTask(taskId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (this.deleteTaskSubscription) {
      this.deleteTaskSubscription.unsubscribe();
    }

    this.deleteTaskSubscription = rxjsTimer(0, 1000)
      .pipe(
        exhaustMap(() => this.validationService.getValidationTask(
          workspaceId,
          taskId
        )),
        takeWhile(
          task => task.status === 'pending' || task.status === 'processing',
          true
        ),
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.deleteProgress.set(task.progress || 0);
          this.deleteProgressMessage.set(task.progress_message || 'Löschung läuft...');

          if (task.status === 'completed') {
            this.finishDeleteTask(task.id);
          } else if (task.status === 'failed') {
            this.isDeletingTestPersons.set(false);
            this.activeDeleteTask.set(null);
            this.snackBar.open(
              task.error || 'Die Löschung ist fehlgeschlagen.',
              'Fehler',
              { duration: 5000 }
            );
          }
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Der Fortschritt der Löschung konnte nicht gelesen werden.',
            'Fehler',
            { duration: 5000 }
          );
        }
      });
  }

  finishDeleteTask(taskId: number): void {
    this.validationService
      .getValidationResults(this.appService.selectedWorkspaceId, taskId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          const deleteResult = result as TestResultsDeleteResultDto;
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.deleteProgress.set(100);
          this.selectionCleared$.next();
          this.testResultService.invalidateCache(
            this.appService.selectedWorkspaceId
          );
          this.validationTaskStateService.invalidateWorkspace(
            this.appService.selectedWorkspaceId
          );
          this.changed$.next();
          this.testPersonCodingService.notifyTestResultsChanged();

          this.snackBar.open(
            `Löschung abgeschlossen: ${deleteResult.deletedTargetCount} Datensätze verarbeitet. Betroffene Kodierungen wurden mit entfernt.`,
            'OK',
            { duration: 4000 }
          );
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung wurde abgeschlossen, das Ergebnis konnte aber nicht geladen werden.',
            'Info',
            { duration: 5000 }
          );
          this.changed$.next();
          this.testPersonCodingService.notifyTestResultsChanged();
        }
      });
  }
}
