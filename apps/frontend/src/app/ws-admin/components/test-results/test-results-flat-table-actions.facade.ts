import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable, Subject, of, shareReplay, finalize, tap
} from 'rxjs';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { AppService } from '../../../core/services/app.service';
import { BookletLogsForUnitResponse, TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { FlatResponseRow, BookletFromPersonTestResults } from './test-results-flat-table.models';

/** Coordinates row actions, with requests and dialogs bound to their workspace. */
@Injectable()
export class TestResultsFlatTableActionsFacade {
  private readonly destroyRef = inject(DestroyRef);

  private fileService = inject(FileService);

  private unitNoteService = inject(UnitNoteService);

  private statisticsService = inject(CodingStatisticsService);

  private responseService = inject(ResponseService);

  private appService = inject(AppService);

  private testResultService = inject(TestResultService);

  private snackBar = inject(MatSnackBar);

  private dialog = inject(MatDialog);

  private translateService = inject(TranslateService);

  private personTestResultsCache = new Map<
    number,
    Observable<BookletFromPersonTestResults[]>
  >();

  private personTestResultsCacheOrder: number[] = [];

  private readonly PERSON_TEST_RESULTS_CACHE_MAX = 5;
  private readonly ownedDialogs = new Set<MatDialogRef<unknown>>();
  private readonly deleted = new Subject<void>();
  readonly deleted$ = this.deleted.asObservable();

  constructor() {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.closeDialogs();
      this.personTestResultsCache.clear();
      this.personTestResultsCacheOrder = [];
    });
    this.destroyRef.onDestroy(() => {
      this.closeDialogs();
      this.deleted.complete();
    });
  }

  openBookletInfoFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId || !row.booklet) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    const normalizedBookletId = String(row.booklet).toUpperCase();

    const loadingSnackBar = this.snackBar.open(
      this.translateService.instant('test-results-table.loading-booklet'),
      '',
      { duration: 3000 }
    );

    this.fileService
      .getBookletInfo(workspaceId, normalizedBookletId)
      .pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
      .subscribe({
        next: bookletInfo => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();

          this.ownDialog(this.dialog.open(BookletInfoDialogComponent, {
            width: 'min(96vw, 1400px)',
            maxWidth: '96vw',
            height: '92vh',
            maxHeight: '92vh',
            data: {
              bookletInfo,
              bookletId: normalizedBookletId
            }
          }));
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();
          this.snackBar.open(
            this.translateService.instant('test-results-table.booklet-error'),
            this.translateService.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  openUnitInfoFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.getPersonTestResults(row.personId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: booklets => {
        if (this.appService.selectedWorkspaceId !== workspaceId) return;
        const booklet = (booklets || []).find(b => b.name === row.booklet);
        if (!booklet) {
          this.snackBar.open(this.translateService.instant('test-results-table.booklet-not-found'), this.translateService.instant('common.info'), {
            duration: 3000
          });
          return;
        }

        const unit = (booklet.units || []).find(u => u.id === row.unitId);
        const unitFileIdRaw = unit?.name || '';
        const unitFileId = String(unitFileIdRaw).trim().toUpperCase();
        if (!unitFileId) {
          this.snackBar.open(this.translateService.instant('test-results-table.unit-not-found'), this.translateService.instant('common.info'), {
            duration: 3000
          });
          return;
        }

        const loadingSnackBar = this.snackBar.open(
          this.translateService.instant('test-results-table.loading-unit'),
          '',
          { duration: 3000 }
        );

        this.fileService
          .getUnitInfo(workspaceId, unitFileId)
          .pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
          .subscribe({
            next: unitInfo => {
              if (this.appService.selectedWorkspaceId !== workspaceId) return;
              loadingSnackBar.dismiss();

              this.ownDialog(this.dialog.open(UnitInfoDialogComponent, {
                width: 'min(96vw, 1400px)',
                maxWidth: '96vw',
                height: '92vh',
                maxHeight: '92vh',
                data: {
                  unitInfo,
                  unitId: unitFileId
                }
              }));
            },
            error: () => {
              if (this.appService.selectedWorkspaceId !== workspaceId) return;
              loadingSnackBar.dismiss();
              this.snackBar.open(
                this.translateService.instant('test-results-table.unit-error'),
                this.translateService.instant('error.error_title'),
                { duration: 3000 }
              );
            }
          });
      },
      error: () => {
        if (this.appService.selectedWorkspaceId !== workspaceId) return;
        this.snackBar.open(
          this.translateService.instant('test-results-table.unit-error'),
          this.translateService.instant('error.error_title'),
          { duration: 3000 }
        );
      }
    });
  }

  openBookletLogsFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getBookletLogsForUnit(workspaceId, row.unitId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: BookletLogsForUnitResponse | null) => {
          if (!result || !result.logs || result.logs.length === 0) {
            this.snackBar.open(
              this.translateService.instant('test-results-table.no-booklet-logs'),
              this.translateService.instant('common.info'),
              { duration: 3000 }
            );
            return;
          }

          this.ownDialog(this.dialog.open(LogDialogComponent, {
            width: '700px',
            data: {
              logs: result.logs,
              sessions: result.sessions,
              units: (result.units || []).map((u: BookletLogsForUnitResponse['units'][number]) => ({
                ...u,
                results: []
              }))
            }
          }));
        },
        error: () => {
          this.snackBar.open(this.translateService.instant('test-results-table.booklet-logs-error'), this.translateService.instant('error.error_title'), {
            duration: 3000
          });
        }
      });
  }

  openNotesFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(this.translateService.instant('test-results-table.loading-notes'), '', {
      duration: 3000
    });

    this.unitNoteService
      .getUnitNotes(workspaceId, row.unitId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
      .subscribe({
        next: notes => {
          loadingSnackBar.dismiss();

          this.ownDialog(this.dialog.open(NoteDialogComponent, {
            width: '600px',
            data: {
              unitId: row.unitId,
              notes: (notes || []) as UnitNoteDto[],
              title: this.translateService.instant('test-results-table.notes-title', { unit: row.unit || row.unitId })
            }
          }));
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(this.translateService.instant('test-results-table.notes-error'), this.translateService.instant('error.error_title'), {
            duration: 3000
          });
        }
      });
  }

  openUnitLogsFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getUnitLogs(workspaceId, row.unitId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: logs => {
          if (!logs || logs.length === 0) {
            this.snackBar.open(
              this.translateService.instant('test-results-table.no-unit-logs'),
              this.translateService.instant('common.info'),
              { duration: 3000 }
            );
            return;
          }

          this.ownDialog(this.dialog.open(UnitLogsDialogComponent, {
            width: '700px',
            data: {
              logs,
              title: this.translateService.instant('test-results-table.logs-title', { unit: row.unit || row.unitId })
            }
          }));
        },
        error: () => {
          this.snackBar.open(this.translateService.instant('test-results-table.unit-logs-error'), this.translateService.instant('error.error_title'), {
            duration: 3000
          });
        }
      });
  }

  private getPersonTestResults(
    personId: number
  ): Observable<BookletFromPersonTestResults[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of([]);
    }

    if (this.personTestResultsCache.has(personId)) {
      return this.personTestResultsCache.get(personId)!;
    }

    const req$ = (
      this.testResultService.getPersonTestResults(
        workspaceId,
        personId
      ) as unknown as Observable<BookletFromPersonTestResults[]>
    ).pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef),
      tap({
        error: () => {
          this.personTestResultsCache.delete(personId);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.personTestResultsCache.set(personId, req$);
    this.personTestResultsCacheOrder = this.personTestResultsCacheOrder.filter(
      id => id !== personId
    );
    this.personTestResultsCacheOrder.push(personId);
    if (
      this.personTestResultsCacheOrder.length >
      this.PERSON_TEST_RESULTS_CACHE_MAX
    ) {
      const evictId = this.personTestResultsCacheOrder.shift();
      if (evictId !== undefined) {
        this.personTestResultsCache.delete(evictId);
      }
    }
    return req$;
  }

  replayFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(this.translateService.instant('test-results-table.loading-replay'), '', {
      duration: 3000
    });

    this.statisticsService
      .getReplayUrl(workspaceId, row.responseId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
      .subscribe({
        next: result => {
          loadingSnackBar.dismiss();
          if (result && result.replayUrl) {
            window.open(result.replayUrl, '_blank');
          } else {
            this.snackBar.open(
              this.translateService.instant('test-results-table.replay-url-error'),
              this.translateService.instant('error.error_title'),
              { duration: 3000 }
            );
          }
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            this.translateService.instant('test-results-table.replay-error'),
            this.translateService.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  deleteFromFlatRow(row: FlatResponseRow): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    const dialogRef = this.ownDialog(this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: this.translateService.instant('test-results-table.delete-title'),
        content: this.translateService.instant('test-results-table.delete-confirmation', { response: row.response }),
        confirmButtonLabel: this.translateService.instant('common.delete'),
        showCancel: true
      }
    }));

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.responseService
          .deleteResponse(workspaceId, row.responseId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: result => {
              if (result.success) {
                this.snackBar.open(
                  this.translateService.instant('test-results-table.delete-success', { response: row.response }),
                  this.translateService.instant('test-results-table.success'),
                  { duration: 3000 }
                );
                this.deleted.next();
              } else {
                this.snackBar.open(
                  this.translateService.instant('test-results-table.delete-warning', { warnings: result.report.warnings.join(', ') }),
                  this.translateService.instant('error.error_title'),
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                this.translateService.instant('test-results-table.delete-error'),
                this.translateService.instant('error.error_title'),
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  private ownDialog<C>(ref: MatDialogRef<C>): MatDialogRef<C> {
    this.ownedDialogs.add(ref);
    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.ownedDialogs.delete(ref));
    return ref;
  }

  private closeDialogs(): void {
    this.ownedDialogs.forEach(ref => ref.close());
    this.ownedDialogs.clear();
  }
}
