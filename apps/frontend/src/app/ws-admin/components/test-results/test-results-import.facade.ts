import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import {
  BehaviorSubject, ReplaySubject, Subject, Subscription, firstValueFrom, takeUntil, timeout, timer as rxjsTimer
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService, TestResultsOverviewResponse } from '../../../shared/services/test-result/test-result.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { TestResultsUploadStateService } from '../../services/test-results-upload-state.service';
import { ImportResultDto } from '../../../../../../../api-dto/files/import-options.dto';
import { TestResultsUploadIssueDto, TestResultsUploadResultDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsImportProgressDialogComponent, TestResultsImportProgressState } from './test-results-import-progress-dialog.component';
import { TestResultsUploadResultDialogComponent } from './test-results-upload-result-dialog.component';
import {
  OverwriteMode, TestResultsUploadOptionsDialogComponent, TestResultsUploadOptionsDialogData, TestResultsUploadOptionsDialogResult
} from './test-results-upload-options-dialog.component';
import { TestResultsStatisticsFacade } from './test-results-statistics.facade';

/** Import attempt orchestration; chunked uploads retain their existing workspace service. */
@Injectable()
export class TestResultsImportFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testResultService = inject(TestResultService);
  private readonly dialog = inject(MatDialog);
  private readonly translateService = inject(TranslateService);
  private readonly uploadStateService = inject(TestResultsUploadStateService);
  private readonly statistics = inject(TestResultsStatisticsFacade);
  private cancelTestCenterImport: (() => void) | null = null;
  readonly imported$ = new Subject<void>();
  readonly loadingChanged$ = new Subject<boolean>();
  private readonly isUploadingResultsState = signal<boolean>(false);
  readonly isUploadingResults = this.isUploadingResultsState.asReadonly();

  private readonly uploadingMessageState = signal('Ergebnisse werden hochgeladen...');
  readonly uploadingMessage = this.uploadingMessageState.asReadonly();
  private readonly overview = this.statistics.overview;
  private readonly manualAppliedResultsOverview = this.statistics.manualAppliedResultsOverview;
  private readonly manualAppliedResultsOverviewLoadFailed = this.statistics.manualAppliedResultsOverviewLoadFailed;

  updateUploadProgress(uploading: boolean, message?: string): void {
    this.isUploadingResultsState.set(uploading);
    if (message !== undefined) this.uploadingMessageState.set(message);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cancelTestCenterImport?.();
      this.imported$.complete(); this.loadingChanged$.complete();
    });
  }

  async testCenterImport(): Promise<void> {
    if (this.destroyRef.destroyed) return;
    this.cancelTestCenterImport?.();
    const workspaceId = this.appService.selectedWorkspaceId;
    const cancellation = new ReplaySubject<void>(1);
    const ownedDialogs = new Set<MatDialogRef<unknown>>();
    let cancelled = false;
    let workspaceChanges: Subscription | undefined;
    let unregisterDestroy = () => {};
    const cancel = (): void => {
      if (cancelled) return;
      cancelled = true;
      cancellation.next();
      cancellation.complete();
      workspaceChanges?.unsubscribe();
      unregisterDestroy();
      ownedDialogs.forEach(ref => ref.close());
      ownedDialogs.clear();
      if (this.cancelTestCenterImport === cancel) this.cancelTestCenterImport = null;
    };
    this.cancelTestCenterImport = cancel;
    unregisterDestroy = this.destroyRef.onDestroy(cancel);
    workspaceChanges = this.appService.selectedWorkspaceId$.subscribe(id => {
      if (id !== workspaceId) cancel();
    });
    const fallbackOverview: TestResultsOverviewResponse = {
      testPersons: 0,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 0,
      responseStatusCounts: {},
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };

    let loadedBeforeOverview: TestResultsOverviewResponse | null = null;
    if (workspaceId) {
      try {
        loadedBeforeOverview = await firstValueFrom(
          this.testResultService.getWorkspaceOverview(workspaceId).pipe(timeout(5000), takeUntil(cancellation)),
          { defaultValue: null }
        );
      } catch {
        loadedBeforeOverview = null;
      }
    }
    if (cancelled) return;
    const beforeOverview =
      loadedBeforeOverview || this.overview() || fallbackOverview;

    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1200px',
      maxWidth: '95vw',
      minHeight: '800px',
      disableClose: true,
      data: {
        importType: 'testResults'
      }
    });
    ownedDialogs.add(dialogRef);

    const sleep = (ms: number) => firstValueFrom(rxjsTimer(ms).pipe(takeUntil(cancellation)), { defaultValue: null });

    const hasOverviewChanged = (current: TestResultsOverviewResponse) => (
      current.testPersons !== beforeOverview.testPersons ||
      current.testGroups !== beforeOverview.testGroups ||
      current.uniqueBooklets !== beforeOverview.uniqueBooklets ||
      current.uniqueUnits !== beforeOverview.uniqueUnits ||
      current.uniqueResponses !== beforeOverview.uniqueResponses
    );

    const pollOverviewAfterImport =
      async (progressState$?: BehaviorSubject<TestResultsImportProgressState>): Promise<{
        overview: TestResultsOverviewResponse;
        loaded: boolean;
        changed: boolean;
      }> => {
        if (!workspaceId) {
          return {
            overview: this.overview() || fallbackOverview,
            loaded: false,
            changed: false
          };
        }

        // A loaded overview is the reliable result. It may legitimately be unchanged
        // when an import only confirms already existing data.
        const deadline = Date.now() + 20000;
        for (let i = 0; i < 4 && Date.now() < deadline; i += 1) {
          if (cancelled) return { overview: beforeOverview, loaded: false, changed: false };
          progressState$?.next({
            title: 'Testcenter-Import',
            icon: 'upload_file',
            phase: 'refreshingOverview',
            phaseLabel: 'Übersicht wird aktualisiert',
            message: 'Der Import ist abgeschlossen. Lade die aktualisierten Ergebniszahlen.',
            mode: 'indeterminate'
          });

          let current: TestResultsOverviewResponse | null = null;
          try {
            current = await firstValueFrom(
              this.testResultService.getWorkspaceOverview(workspaceId).pipe(timeout(Math.min(5000, Math.max(1, deadline - Date.now()))), takeUntil(cancellation)),
              { defaultValue: null }
            );
          } catch {
            current = null;
          }
          if (!current) {
            if (Date.now() < deadline) await sleep(Math.min(1000, deadline - Date.now()));
            continue;
          }
          return { overview: current, loaded: true, changed: hasOverviewChanged(current) };
        }
        return {
          overview: this.overview() || beforeOverview,
          loaded: false,
          changed: false
        };
      };

    dialogRef.afterClosed().pipe(takeUntil(cancellation), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      ownedDialogs.delete(dialogRef);
      let awaitingOverview = false;
      const maybePayload = result as
        | {
          didImport?: boolean;
          resultType?: 'logs' | 'responses';
        }
        | boolean
        | undefined;

      if (
        maybePayload &&
        typeof maybePayload === 'object' &&
        'didImport' in maybePayload &&
        (maybePayload as { didImport?: boolean }).didImport
      ) {
        awaitingOverview = true;
        (async () => {
          const progressState$ = new BehaviorSubject<TestResultsImportProgressState>({
            title: 'Testcenter-Import',
            icon: 'upload_file',
            phase: 'refreshingOverview',
            phaseLabel: 'Übersicht wird aktualisiert',
            message: 'Der Import ist abgeschlossen. Lade die aktualisierten Ergebniszahlen.',
            mode: 'indeterminate'
          });
          const progressDialogRef = this.dialog.open(
            TestResultsImportProgressDialogComponent,
            {
              width: '560px',
              maxWidth: '95vw',
              disableClose: true,
              data: { state$: progressState$ }
            }
          );
          ownedDialogs.add(progressDialogRef);

          let overviewResult: {
            overview: TestResultsOverviewResponse;
            loaded: boolean;
            changed: boolean;
          } = {
            overview: this.overview() || beforeOverview,
            loaded: false,
            changed: false
          };

          try {
            if (workspaceId) {
              this.testResultService.invalidateCache(workspaceId);
            }

            overviewResult = await pollOverviewAfterImport(progressState$);
            if (cancelled) return;

            progressState$.next({
              title: 'Testcenter-Import',
              icon: 'upload_file',
              phase: 'completed',
              phaseLabel: 'Ergebnis bereit',
              message: 'Die Ergebnisübersicht wurde geladen.',
              percent: 100,
              mode: 'determinate'
            });
          } finally {
            if (ownedDialogs.delete(progressDialogRef)) progressDialogRef.close();
            progressState$.complete();
          }

          const afterOverview = overviewResult.overview;

          const delta = {
            testPersons: afterOverview.testPersons - beforeOverview.testPersons,
            testGroups: afterOverview.testGroups - beforeOverview.testGroups,
            uniqueBooklets:
              afterOverview.uniqueBooklets - beforeOverview.uniqueBooklets,
            uniqueUnits: afterOverview.uniqueUnits - beforeOverview.uniqueUnits,
            uniqueResponses:
              afterOverview.uniqueResponses - beforeOverview.uniqueResponses
          };

          const payload = maybePayload as {
            resultType?: 'logs' | 'responses';
            importedLogs?: boolean;
            importedResponses?: boolean;
            uploadResult?: ImportResultDto;
            // Legacy/Fallback properties
            issues?: TestResultsUploadIssueDto[];
            logMetrics?: {
              bookletsWithLogs: number;
              totalBooklets: number;
              unitsWithLogs: number;
              totalUnits: number;
              bookletDetails?: { name: string; hasLog: boolean }[];
              unitDetails?: {
                bookletName: string;
                unitKey: string;
                hasLog: boolean;
              }[];
            };
          };

          const logMetrics = payload.uploadResult ?
            {
              bookletsWithLogs: payload.uploadResult.bookletsWithLogs ?? 0,
              totalBooklets: payload.uploadResult.totalBooklets ?? 0,
              unitsWithLogs: payload.uploadResult.unitsWithLogs ?? 0,
              totalUnits: payload.uploadResult.totalUnits ?? 0,
              bookletDetails: payload.uploadResult.bookletDetails || [],
              unitDetails: payload.uploadResult.unitDetails || []
            } :
            payload.logMetrics;

          const overviewPending = !overviewResult.loaded;
          let codingFreshness = payload.uploadResult?.codingFreshness || null;
          if (!codingFreshness && workspaceId) {
            codingFreshness = await this.statistics.fetchCodingFreshnessSummary(workspaceId);
          }
          if (cancelled) return;
          if (codingFreshness) {
            this.statistics.acceptImportedFreshness(codingFreshness);
          }
          const manualOverviewResult = workspaceId ?
            await this.statistics.fetchManualAppliedResultsOverview(workspaceId) :
            {
              overview: this.manualAppliedResultsOverview(),
              loadFailed: this.manualAppliedResultsOverviewLoadFailed()
            };
          if (cancelled) return;
          this.statistics.acceptImportedManualOverview(manualOverviewResult);

          const dialogResult: TestResultsUploadResultDto = {
            expected: { ...delta },
            before: {
              testPersons: beforeOverview.testPersons,
              testGroups: beforeOverview.testGroups,
              uniqueBooklets: beforeOverview.uniqueBooklets,
              uniqueUnits: beforeOverview.uniqueUnits,
              uniqueResponses: beforeOverview.uniqueResponses
            },
            after: {
              testPersons: afterOverview.testPersons,
              testGroups: afterOverview.testGroups,
              uniqueBooklets: afterOverview.uniqueBooklets,
              uniqueUnits: afterOverview.uniqueUnits,
              uniqueResponses: afterOverview.uniqueResponses
            },
            delta,
            responseStatusCounts: afterOverview.responseStatusCounts,
            issues: payload.uploadResult?.issues || payload.issues || [],
            logMetrics: logMetrics,
            importedLogs: payload.importedLogs,
            importedResponses: payload.importedResponses,
            overviewPending,
            overviewMessage: overviewPending ?
              this.translateService.instant('testcenter-import.overview-pending') :
              undefined,
            codingFreshness: codingFreshness || undefined
          };

          this.dialog.open(TestResultsUploadResultDialogComponent, {
            width: '1040px',
            maxWidth: '95vw',
            data: {
              resultType: payload.resultType || 'responses',
              result: dialogResult,
              manualAppliedResultsOverview: manualOverviewResult.overview,
              manualAppliedResultsOverviewLoadFailed: manualOverviewResult.loadFailed
            }
          });
        })().finally(cancel);
      }

      if (result) {
        if (workspaceId) {
          this.testResultService.invalidateCache(workspaceId);
        }
        this.imported$.next();
      }
      if (!awaitingOverview) cancel();
    });
  }

  onFileSelected(
    targetElement: EventTarget | null,
    resultType: 'logs' | 'responses'
  ) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        const optionsRef = this.dialog.open<
          TestResultsUploadOptionsDialogComponent,
          TestResultsUploadOptionsDialogData,
        TestResultsUploadOptionsDialogResult | undefined
        >(TestResultsUploadOptionsDialogComponent, {
          width: '600px',
          data: {
            resultType,
            defaultOverwriteMode: 'skip',
            defaultScope: 'person'
          }
        });

        optionsRef
          .afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe(
            (options: TestResultsUploadOptionsDialogResult | undefined) => {
              if (!options) {
                return;
              }

              const overwriteMode: OverwriteMode = options.overwriteMode;
              const scope = options.scope;
              const filters = {
                groupName: options.groupName,
                bookletName: options.bookletName,
                unitNameOrAlias: options.unitNameOrAlias,
                variableId: options.variableId,
                subform: options.subform
              };

              const overwriteExisting = overwriteMode !== 'skip';
              const workspaceId = this.appService.selectedWorkspaceId;
              const beforeOverview = this.overview() || {
                testPersons: 0,
                testGroups: 0,
                uniqueBooklets: 0,
                uniqueUnits: 0,
                uniqueResponses: 0,
                responseStatusCounts: {},
                sessionBrowserCounts: {},
                sessionOsCounts: {},
                sessionScreenCounts: {}
              };
              this.loadingChanged$.next(true);
              this.isUploadingResultsState.set(true);
              this.uploadingMessageState.set(resultType === 'responses' ?
                'Importiere Antworten... (0%)' : 'Importiere Logs... (0%)');
              this.uploadStateService.startChunkedUpload(
                workspaceId,
                inputElement.files![0],
                resultType,
                {
                  overwriteExisting, overwriteMode, scope, filters
                },
                beforeOverview
              ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                error: () => {
                  this.loadingChanged$.next(false);
                  this.isUploadingResultsState.set(false);
                }
              });
            }
          );
      }
    }
  }
}
